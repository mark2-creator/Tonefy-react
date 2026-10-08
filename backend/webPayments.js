// Web payments through Flutterwave (Oct 8 2026): 30-day Pro / Creator passes bought on
// the WEBSITE in Ugandan shillings, by card or MTN / Airtel mobile money.
//
// WHY A PASS, NOT A SUBSCRIPTION: mobile money cannot be charged automatically, and most
// real users are Ugandan and pay by mobile money. A pass is paid once, lasts 30 days and
// never renews by itself, so nobody is ever charged without pressing Pay.
//
// GOOGLE PLAY RULE: a plan bought here may be USED in the Android app (Play allows
// consumption of content bought elsewhere), but the app must never link to, mention or
// steer anyone to this payment. Nothing in the app may point at upgrade.html.
//
// TRUST: nothing the browser or Flutterwave's redirect says is believed. A payment
// grants a plan only after the server asks Flutterwave itself (GET
// /v3/transactions/{id}/verify) and the answer matches what WE recorded when the
// checkout started: our tx_ref, status successful, currency UGX, amount at least the
// price. The webhook is only a trigger for that same check (its verif-hash header is
// still compared, so strangers cannot make us call Flutterwave in a loop).
//
// ONCE ONLY: webPayments/{tx_ref} is created at checkout and flipped to 'granted' inside
// a Firestore transaction, so the redirect page and the webhook arriving together (the
// normal case) grant the pass exactly once.
//
// OFF until FLW_SECRET_KEY is in .env: /config says enabled:false and /start refuses.

import crypto from 'crypto';

const FLW_API = 'https://api.flutterwave.com/v3';
const SITE = 'https://tonefy-ai.fitlifesolutions.site';
export const PASS_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
// Buying again is allowed once the current pass is this close to its end; the new 30
// days are added after the old end, so nothing already paid for is lost.
const RENEW_WINDOW_MS = 5 * DAY_MS;

// UGX, whole shillings. Matches the Uganda Google Play prices (Pro $8.25, Creator
// $17.69 at ~3,700 UGX/$, rounded down) so neither route is the cheaper one.
export const PASSES = {
  pro: { amount: 30000, label: 'Pro', credits: 60 },
  creator: { amount: 65000, label: 'Creator', credits: 300 },
};

function secret() { return process.env.FLW_SECRET_KEY || ''; }
export function webPaymentsEnabled() { return !!secret(); }

async function flw(path, init = {}) {
  const res = await fetch(`${FLW_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${secret()}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.status !== 'success') {
    const err = new Error(`flutterwave ${path.split('?')[0]} ${res.status}: ${String(body.message || '').slice(0, 120)}`);
    err.flwStatus = res.status;
    throw err;
  }
  return body.data;
}

function sameText(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * deps: { adminDb, getAuth, isAdminUid, tierConfig }
 */
export function createWebPayments({ adminDb, getAuth, isAdminUid, tierConfig }) {
  const payments = adminDb.collection('webPayments');

  // Why a purchase would be refused before any money moves. null = fine.
  function blockReason(user, now) {
    const paidPlan = user.plan === 'pro' || user.plan === 'creator';
    // An active Google Play subscription already pays for a plan; a pass on top would
    // charge the same person twice for overlapping months.
    if (user.subscriptionPurchaseToken && paidPlan && user.subscriptionStatus !== 'expired') {
      return 'You already have a plan through Google Play, so there is nothing to pay for here.';
    }
    const until = Date.parse(user.webPassUntil || '') || 0;
    if (paidPlan && until > now + RENEW_WINDOW_MS) {
      const when = new Date(until).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
      return `Your ${PASSES[user.plan].label} pass is active until ${when}. You can renew it in its last 5 days.`;
    }
    if (paidPlan && !user.webPassUntil && !user.subscriptionPurchaseToken) {
      return 'Your account already has a paid plan.';
    }
    return null;
  }

  async function config(uid) {
    const out = { enabled: webPaymentsEnabled(), currency: 'UGX', days: PASS_DAYS,
      passes: Object.fromEntries(Object.entries(PASSES).map(([k, v]) => [k, { amount: v.amount, label: v.label, credits: v.credits }])) };
    if (uid) {
      const user = (await adminDb.collection('users').doc(uid).get()).data() || {};
      out.plan = isAdminUid(uid) ? 'creator' : (user.plan || 'free');
      out.passUntil = user.webPassUntil || null;
      out.blocked = isAdminUid(uid) ? 'Admins are already on Creator.' : blockReason(user, Date.now());
    }
    return out;
  }

  // Creates the pending record and Flutterwave's hosted checkout link.
  async function start(uid, plan) {
    if (!webPaymentsEnabled()) return { status: 503, error: 'Paying on the website is not available yet.' };
    const pass = PASSES[plan];
    if (!pass) return { status: 400, error: 'Please choose Pro or Creator.' };
    if (isAdminUid(uid)) return { status: 409, error: 'Admins are already on Creator.' };
    const user = (await adminDb.collection('users').doc(uid).get()).data() || {};
    const blocked = blockReason(user, Date.now());
    if (blocked) return { status: 409, error: blocked };

    const authUser = await getAuth().getUser(uid);
    if (!authUser.email) return { status: 400, error: 'Your account needs an email address to pay. Please sign in with email or Google.' };

    const txRef = `tfy-${uid.slice(0, 8)}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
    await payments.doc(txRef).create({
      uid, plan, amount: pass.amount, currency: 'UGX', status: 'pending',
      createdAt: new Date().toISOString(),
    });
    const data = await flw('/payments', {
      method: 'POST',
      body: JSON.stringify({
        tx_ref: txRef,
        amount: pass.amount,
        currency: 'UGX',
        redirect_url: `${SITE}/payment-done.html`,
        payment_options: 'mobilemoneyuganda,card',
        customer: { email: authUser.email, name: authUser.displayName || undefined },
        customizations: {
          title: 'Tonefy AI',
          description: `${pass.label} pass - ${PASS_DAYS} days, does not renew by itself`,
          logo: `${SITE}/app-icon-meta.png`,
        },
        meta: { uid, plan },
      }),
    });
    return { status: 200, link: data.link, txRef };
  }

  // Asks Flutterwave about one transaction and, if it is a real, complete payment for
  // a checkout we started, grants the pass. Safe to call any number of times.
  async function confirm({ transactionId, txRef, uid = null }) {
    if (!webPaymentsEnabled()) return { status: 503, error: 'Paying on the website is not available yet.' };
    let tx;
    if (transactionId && /^\d{1,20}$/.test(String(transactionId))) {
      tx = await flw(`/transactions/${transactionId}/verify`);
    } else if (txRef && /^tfy-[\w-]{8,60}$/.test(String(txRef))) {
      tx = await flw(`/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`);
    } else {
      return { status: 400, error: 'Missing payment reference.' };
    }
    const ref = String(tx.tx_ref || '');
    if (txRef && ref !== txRef) return { status: 400, error: 'That payment does not match this checkout.' };
    if (!/^tfy-/.test(ref)) return { status: 404, error: 'We could not find that payment.' };

    const payRef = payments.doc(ref);
    const userRefFor = (u) => adminDb.collection('users').doc(u);

    // Logged after the commit: a transaction body can run more than once under contention.
    const out = await adminDb.runTransaction(async (t) => {
      const pay = await t.get(payRef);
      if (!pay.exists) return { status: 404, error: 'We could not find that payment.' };
      const p = pay.data();
      if (uid && p.uid !== uid) return { status: 403, error: 'This payment belongs to another account.' };
      if (p.status === 'granted') return { status: 200, granted: true, plan: p.plan, until: p.passUntil };

      if (tx.status !== 'successful') {
        const next = tx.status === 'failed' ? 'failed' : 'pending';
        t.set(payRef, { status: next, flwId: tx.id, checkedAt: new Date().toISOString() }, { merge: true });
        return { status: 200, granted: false, state: next };
      }
      if (tx.currency !== 'UGX' || !(Number(tx.amount) >= p.amount)) {
        t.set(payRef, { status: 'mismatch', flwId: tx.id, flwAmount: tx.amount, flwCurrency: tx.currency,
          checkedAt: new Date().toISOString() }, { merge: true });
        console.error(`[web-pay] ${ref}: amount/currency mismatch ${tx.amount} ${tx.currency} vs ${p.amount} UGX`);
        return { status: 400, error: 'The amount paid does not match the price. Please contact us and we will sort it out.' };
      }

      const uref = userRefFor(p.uid);
      const user = (await t.get(uref)).data() || {};
      const now = Date.now();
      const oldUntil = Date.parse(user.webPassUntil || '') || 0;
      const base = oldUntil > now ? oldUntil : now;
      const until = new Date(base + PASS_DAYS * DAY_MS).toISOString();
      const carry = oldUntil > now && user.plan === p.plan ? Math.max(0, Number(user.creditsRemaining) || 0) : 0;
      t.set(uref, {
        plan: p.plan,
        creditsRemaining: tierConfig(p.plan).creditsPerCycle + carry,
        // The credit sweep refills paid plans at creditsResetAt; the pass sweep ends the
        // plan at webPassUntil. Same moment, and the pass sweep runs first.
        creditsResetAt: until,
        webPassUntil: until,
        webPassPlan: p.plan,
        webPassTxRef: ref,
        webPassStatus: 'active',
      }, { merge: true });
      t.set(payRef, { status: 'granted', flwId: tx.id, paidAmount: tx.amount, paymentType: tx.payment_type || null,
        grantedAt: new Date().toISOString(), passUntil: until }, { merge: true });
      return { status: 200, granted: true, plan: p.plan, until, justGranted: p.uid };
    });
    if (out.justGranted) {
      console.log(`[web-pay] ${out.justGranted}: ${out.plan} pass until ${out.until} (${ref})`);
      delete out.justGranted;
    }
    return out;
  }

  // Flutterwave's webhook. Answered 200 at once; the work is the same confirm().
  async function webhook(req, res) {
    const hash = process.env.FLW_WEBHOOK_HASH || '';
    if (!hash || !sameText(req.get('verif-hash') || '', hash)) return res.status(401).end();
    res.status(200).end();
    try {
      const d = req.body?.data || {};
      if (!d.id && !d.tx_ref) return;
      const out = await confirm({ transactionId: d.id, txRef: d.tx_ref });
      console.log(`[web-pay] webhook ${d.tx_ref}: ${out.granted ? 'granted' : (out.state || out.error)}`);
    } catch (e) {
      console.error('[web-pay] webhook failed:', e.message);
    }
  }

  // Ends passes whose 30 days are over. Runs before the credit sweep in the same tick.
  async function expireSweep() {
    const nowIso = new Date().toISOString();
    let snap;
    try {
      snap = await adminDb.collection('users').where('webPassUntil', '<=', nowIso).get();
    } catch (e) { console.error('[web-pay] expire sweep read failed:', e.message); return; }
    for (const doc of snap.docs) {
      const v = doc.data();
      if (v.webPassStatus !== 'active' || isAdminUid(doc.id)) continue;
      // A Play subscription bought since then owns the plan now; only close the pass.
      const playActive = v.subscriptionPurchaseToken && v.subscriptionStatus !== 'expired';
      const patch = { webPassStatus: 'ended' };
      if (!playActive && (v.plan === 'pro' || v.plan === 'creator')) {
        patch.plan = 'free';
        patch.creditsRemaining = Math.min(Number(v.creditsRemaining) || 0, tierConfig('free').creditsPerCycle);
        patch.creditsResetAt = new Date(Date.now() + PASS_DAYS * DAY_MS).toISOString();
      }
      try {
        await doc.ref.set(patch, { merge: true });
        console.log(`[web-pay] ${doc.id}: pass ended${patch.plan ? ' -> free' : ''}`);
      } catch (e) { console.error(`[web-pay] ${doc.id}: could not end pass -`, e.message); }
    }
  }

  return { config, start, confirm, webhook, expireSweep };
}
