// Web payments through Pesapal (adapter Oct 24 2026; Flutterwave's, Oct 8, declined Uganda sole
// proprietors on Oct 11). 30-day Pro / Creator passes bought on the WEBSITE, at Play's price for
// the buyer's country: Uganda in shillings (mobile money or card on Pesapal's page), everyone
// else in US dollars by card.
//
// WHY A PASS, NOT A SUBSCRIPTION: mobile money cannot be charged automatically, and most
// real users are Ugandan and pay by mobile money. A pass is paid once, lasts 30 days and
// never renews by itself, so nobody is ever charged without pressing Pay.
//
// GOOGLE PLAY RULE: a plan bought here may be USED in the Android app (Play allows
// consumption of content bought elsewhere), but the app must never link to, mention or
// steer anyone to this payment. Nothing in the app may point at upgrade.html.
//
// TRUST: nothing the browser, the callback URL or an IPN call says is believed. Pesapal's
// callback and IPN carry no status and no signature (by design - its docs say to ask), so a
// payment grants a plan only after the server calls GetTransactionStatus itself and the answer
// matches what WE recorded when the checkout started: our merchant reference, COMPLETED, the
// recorded currency, amount at least the recorded price. The IPN is only a trigger for that
// same check, so a stranger calling it can at most make us ask Pesapal about our own order.
//
// ONCE ONLY: webPayments/{ref} is created at checkout and flipped to 'granted' inside a
// Firestore transaction, so the redirect page and the IPN arriving together (the normal case)
// grant the pass exactly once.
//
// OFF until PESAPAL_CONSUMER_KEY + PESAPAL_CONSUMER_SECRET are in .env. PESAPAL_ENV=live uses
// the live API; anything else is the SANDBOX, where only PESAPAL_TEST_UIDS may pay (sandbox
// payments are fake money). Pesapal's public demo keys (developer.pesapal.com/api3-demo-keys.txt)
// work in the sandbox for testing before the real account is approved.

import crypto from 'crypto';

const SITE = 'https://tonefy-ai.fitlifesolutions.site';
const IPN_URL = 'https://api.fitlifesolutions.site/pesapal-ipn';
export const PASS_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
// Buying again is allowed once the current pass is this close to its end; the new 30
// days are added after the old end, so nothing already paid for is lost.
const RENEW_WINDOW_MS = 5 * DAY_MS;

// Prices follow Google Play's price for the buyer's country (owner, Oct 8), so the web is never
// the cheaper or dearer route. Uganda pays in shillings (Pesapal's page then offers MTN/Airtel
// mobile money and cards); everywhere else pays US dollars by card, at Play's doubled price in
// the 44 high-income markets (Oct 3 2026) and the base price elsewhere. Both currencies were
// accepted by Pesapal's sandbox for a Ugandan merchant (Oct 24). Add a country to LOCAL only
// after a real checkout shows its local method (docs/web-payments.md).
export const PASSES = {
  pro: { label: 'Pro', credits: 60 },
  creator: { label: 'Creator', credits: 300 },
};
const LOCAL = {
  UG: { currency: 'UGX', pro: 30000, creator: 65000, how: 'mobile money (MTN or Airtel) or a card' },
};
// Play's doubled-price markets (Oct 3 2026, ~/ytshots/play-subs-after-2026-10-03.json).
const HIGH = new Set('AE AT AU BE BH CA CH CY CZ DE DK EE ES FI FR GB HK HR IE IL IS IT JP KR KW LI LT LU LV MO MT NL NO NZ OM PT QA SA SE SG SI SK TW US'.split(' '));
const USD_HIGH = { pro: 13.99, creator: 29.99 };
const USD_BASE = { pro: 8.25, creator: 17.69 };

// Profile countries are stored as English names ("Uganda"); Cloudflare gives ISO codes.
const NAME_TO_CODE = (() => {
  const dn = new Intl.DisplayNames(['en'], { type: 'region' }); const m = {};
  // Retired or non-country codes ICU still names (DD = East Germany would take "Germany").
  const skip = new Set('AN BU CS DD DY EU EZ FX HV NH NT QO QU RH SU TP UK UN VD YD YU ZR'.split(' '));
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b);
    if (skip.has(code)) continue;
    try { const n = dn.of(code); if (n && n !== code && !m[n.toLowerCase()]) m[n.toLowerCase()] = code; } catch { /* not a region */ }
  }
  return m;
})();

// Where the buyer is: Cloudflare's location (`loc` from the website's /cdn-cgi/trace) first,
// else the profile country. Both are claims - someone on a VPN sees another country's price,
// exactly as on Play. confirm() checks against what start() recorded, never against this.
export function regionFor(user, loc) {
  const l = String(loc || '').toUpperCase();
  if (/^[A-Z]{2}$/.test(l) && l !== 'XX' && l !== 'T1') return l;
  return NAME_TO_CODE[String(user?.country || '').trim().toLowerCase()] || '';
}
// What this buyer pays for a plan: { currency, amount, how, display }.
export function offerFor(region, plan) {
  const local = LOCAL[region];
  if (local) {
    const amount = local[plan];
    return { currency: local.currency, amount, how: local.how,
      display: `${local.currency} ${amount.toLocaleString('en-US')}` };
  }
  const amount = (HIGH.has(region) ? USD_HIGH : USD_BASE)[plan];
  return { currency: 'USD', amount, how: 'a card', display: `$${amount.toFixed(2)}` };
}

const env = (k) => process.env[k] || '';
export function webPaymentsEnabled() { return !!(env('PESAPAL_CONSUMER_KEY') && env('PESAPAL_CONSUMER_SECRET')); }
function liveMode() { return env('PESAPAL_ENV') === 'live'; }
function apiBase() { return liveMode() ? 'https://pay.pesapal.com/v3/api' : 'https://cybqa.pesapal.com/pesapalv3/api'; }
// The sandbox takes fake money, so there only the accounts in PESAPAL_TEST_UIDS may start a
// payment - otherwise anyone could get a real plan for nothing. Grants need the pending record
// that start() writes, so gating start is enough.
function canPay(uid) {
  if (!webPaymentsEnabled()) return false;
  if (liveMode()) return true;
  return env('PESAPAL_TEST_UIDS').split(',').map((x) => x.trim()).filter(Boolean).includes(uid);
}

// Bearer tokens last 5 minutes; reused until 30 s before expiry. Cached per base URL AND
// consumer key, so new keys or a switch from sandbox to live never reuse an old token (the
// test caught exactly that: "Invalid Access Token" after the keys changed).
let tokenCache = { id: '', token: '', until: 0 };
async function pesapal(path, init = {}) {
  const base = apiBase();
  const id = `${base}|${env('PESAPAL_CONSUMER_KEY')}`;
  if (!(tokenCache.id === id && tokenCache.until > Date.now() + 30000)) {
    const t = await rawCall(base, '/Auth/RequestToken', { method: 'POST',
      body: JSON.stringify({ consumer_key: env('PESAPAL_CONSUMER_KEY'), consumer_secret: env('PESAPAL_CONSUMER_SECRET') }) });
    if (!t.token) throw new Error(`pesapal auth: ${String(t.error?.message || t.message || 'no token').slice(0, 120)}`);
    tokenCache = { id, token: t.token, until: Date.parse(t.expiryDate) || Date.now() + 4 * 60 * 1000 };
  }
  return rawCall(base, path, { ...init, headers: { Authorization: `Bearer ${tokenCache.token}`, ...(init.headers || {}) } });
}
async function rawCall(base, path, { allowErrorCodes = [], ...init }) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.json().catch(() => ({}));
  // Pesapal reports most failures as HTTP 200 with an `error` object - and some answers too:
  // an order nobody has paid yet comes back with its full details AND error
  // payment_details_not_found "Pending Payment" (sandbox, Oct 24). Callers name those codes.
  const softError = body.error && allowErrorCodes.includes(body.error.code);
  if (!res.ok || (body.error && (body.error.code || body.error.message) && !softError)) {
    const err = new Error(`pesapal ${path.split('?')[0]} ${res.status}: ${String(body.error?.message || body.message || '').slice(0, 120)}`);
    err.pesapalStatus = res.status;
    throw err;
  }
  return body;
}

// The IPN id every order names. PESAPAL_IPN_ID if set (register once in the dashboard or let
// this do it); otherwise registered on first use and kept for the life of the process -
// registering the same URL again returns a fresh id, which is harmless.
let ipnCache = { base: '', key: '', id: '' };
async function ipnId() {
  if (env('PESAPAL_IPN_ID')) return env('PESAPAL_IPN_ID');
  if (ipnCache.base === apiBase() && ipnCache.key === env('PESAPAL_CONSUMER_KEY') && ipnCache.id) return ipnCache.id;
  const r = await pesapal('/URLSetup/RegisterIPN', { method: 'POST', body: JSON.stringify({ url: IPN_URL, ipn_notification_type: 'GET' }) });
  if (!r.ipn_id) throw new Error('pesapal: IPN registration returned no id');
  ipnCache = { base: apiBase(), key: env('PESAPAL_CONSUMER_KEY'), id: r.ipn_id };
  console.log(`[web-pay] Pesapal IPN registered (${liveMode() ? 'live' : 'sandbox'}): ${r.ipn_id} - set PESAPAL_IPN_ID to reuse it`);
  return r.ipn_id;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF = /^tfy-[\w-]{8,45}$/;

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

  async function config(uid, loc) {
    const user = uid ? (await adminDb.collection('users').doc(uid).get()).data() || {} : {};
    const region = regionFor(user, loc);
    const out = { enabled: uid ? canPay(uid) : webPaymentsEnabled() && liveMode(), days: PASS_DAYS, region,
      how: offerFor(region, 'pro').how,
      passes: Object.fromEntries(Object.entries(PASSES).map(([k, v]) => {
        const o = offerFor(region, k);
        return [k, { label: v.label, credits: v.credits, currency: o.currency, amount: o.amount, display: o.display }];
      })) };
    if (uid) {
      out.plan = isAdminUid(uid) ? 'creator' : (user.plan || 'free');
      out.passUntil = user.webPassUntil || null;
      out.blocked = isAdminUid(uid) ? 'Admins are already on Creator.' : blockReason(user, Date.now());
    }
    return out;
  }

  // Creates the pending record and Pesapal's hosted payment page.
  async function start(uid, plan, loc) {
    if (!canPay(uid)) return { status: 503, error: 'Paying on the website is not available yet.' };
    const pass = PASSES[plan];
    if (!pass) return { status: 400, error: 'Please choose Pro or Creator.' };
    if (isAdminUid(uid)) return { status: 409, error: 'Admins are already on Creator.' };
    const user = (await adminDb.collection('users').doc(uid).get()).data() || {};
    const blocked = blockReason(user, Date.now());
    if (blocked) return { status: 409, error: blocked };

    const authUser = await getAuth().getUser(uid);
    if (!authUser.email) return { status: 400, error: 'Your account needs an email address to pay. Please sign in with email or Google.' };

    // Pesapal's merchant reference: max 50 chars of [A-Za-z0-9-_.:].
    const ref = `tfy-${uid.slice(0, 8)}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
    const region = regionFor(user, loc);
    const { currency, amount } = offerFor(region, plan);
    await payments.doc(ref).create({
      uid, plan, amount, currency, status: 'pending', provider: 'pesapal', env: liveMode() ? 'live' : 'sandbox',
      createdAt: new Date().toISOString(),
    });
    let order;
    try {
    order = await pesapal('/Transactions/SubmitOrderRequest', {
      method: 'POST',
      body: JSON.stringify({
        id: ref,
        currency,
        amount,
        description: `Tonefy AI ${pass.label} pass - ${PASS_DAYS} days, does not renew by itself`.slice(0, 100),
        callback_url: `${SITE}/payment-done.html`,
        cancellation_url: `${SITE}/payment-done.html?status=cancelled`,
        notification_id: await ipnId(),
        billing_address: {
          email_address: authUser.email,
          first_name: (authUser.displayName || '').split(' ')[0] || undefined,
          country_code: /^[A-Z]{2}$/.test(region) ? region : undefined,
        },
      }),
    });
    if (!order.redirect_url || !order.order_tracking_id) throw new Error('pesapal: order returned no payment page');
    } catch (e) {
      // A record without a tracking id can never be granted (confirm requires a match), and
      // this marks it dead so nothing tries.
      await payments.doc(ref).set({ status: 'start-failed', failedAt: new Date().toISOString() }, { merge: true }).catch(() => {});
      throw e;
    }
    await payments.doc(ref).set({ orderTrackingId: order.order_tracking_id }, { merge: true });
    return { status: 200, link: order.redirect_url, txRef: ref };
  }

  // Asks Pesapal about one order and, if it is a real, complete payment for a checkout we
  // started, grants the pass. Safe to call any number of times. Either id works: the page has
  // both; the IPN has both; a record alone (txRef) is enough because start() stored the other.
  async function confirm({ orderTrackingId, txRef, uid = null }) {
    if (!webPaymentsEnabled()) return { status: 503, error: 'Paying on the website is not available yet.' };
    if (txRef && !REF.test(String(txRef))) return { status: 400, error: 'Missing payment reference.' };
    let tracking = GUID.test(String(orderTrackingId || '')) ? String(orderTrackingId) : '';
    if (!tracking && txRef) tracking = (await payments.doc(String(txRef)).get()).data()?.orderTrackingId || '';
    if (!tracking) return { status: 400, error: 'Missing payment reference.' };

    const tx = await pesapal(`/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(tracking)}`,
      { allowErrorCodes: ['payment_details_not_found'] });
    const ref = String(tx.merchant_reference || '');
    if (txRef && ref !== txRef) return { status: 400, error: 'That payment does not match this checkout.' };
    if (!REF.test(ref)) return { status: 404, error: 'We could not find that payment.' };

    const payRef = payments.doc(ref);
    const userRefFor = (u) => adminDb.collection('users').doc(u);
    // 1 COMPLETED, 2 FAILED, 3 REVERSED, 0 INVALID - which is also what an order nobody has
    // paid yet reads as (sandbox, Oct 24), so 0 means "still waiting", never "failed".
    const code = Number(tx.status_code);

    // Logged after the commit: a transaction body can run more than once under contention.
    const out = await adminDb.runTransaction(async (t) => {
      const pay = await t.get(payRef);
      if (!pay.exists) return { status: 404, error: 'We could not find that payment.' };
      const p = pay.data();
      if (uid && p.uid !== uid) return { status: 403, error: 'This payment belongs to another account.' };
      // FAIL CLOSED (automated review, Oct 24 2026): the order must be the one start() made -
      // its tracking id stored and equal - and from the mode we are in now. Otherwise, in the
      // sandbox (Pesapal's demo keys are PUBLIC), anyone could make an order carrying one of our
      // references and pay it with test money.
      if (p.provider !== 'pesapal' || !p.orderTrackingId || p.orderTrackingId !== tracking
        || p.env !== (liveMode() ? 'live' : 'sandbox')) {
        return { status: 400, error: 'That payment does not match this checkout.' };
      }
      const seen = { pesapalCode: code, pesapalMethod: tx.payment_method || null, checkedAt: new Date().toISOString() };
      if (code === 3) {
        // Money went back (a card chargeback or a reversed mobile-money payment). Recorded and
        // shouted about, not silently undone: the owner decides what happens to the pass.
        const wasGranted = p.status === 'granted' || p.status === 'reversed-after-grant' || !!p.grantedAt;
        t.set(payRef, { ...seen, status: wasGranted ? 'reversed-after-grant' : 'reversed' }, { merge: true });
        return { status: 200, granted: false, state: 'reversed', reversedGrant: p.status === 'granted' ? p.uid : null };
      }
      if (p.status === 'granted') return { status: 200, granted: true, plan: p.plan, until: p.passUntil };
      // Final states. A reversal is never overwritten and nothing is ever granted twice:
      // grantedAt survives a later status change, so a "completed" read after a reversal
      // cannot grant the pass again (automated review, Oct 24 2026).
      if (String(p.status).startsWith('reversed') || p.grantedAt || p.status === 'start-failed') {
        return { status: 200, granted: false, state: String(p.status).startsWith('reversed') ? 'reversed' : 'closed' };
      }

      if (code !== 1) {
        const next = code === 2 ? 'failed' : 'pending';
        t.set(payRef, { ...seen, status: next }, { merge: true });
        return { status: 200, granted: false, state: next };
      }
      if (tx.currency !== p.currency || !(Number(tx.amount) >= p.amount)) {
        t.set(payRef, { ...seen, status: 'mismatch', paidAmount: tx.amount, paidCurrency: tx.currency }, { merge: true });
        console.error(`[web-pay] ${ref}: amount/currency mismatch ${tx.amount} ${tx.currency} vs ${p.amount} ${p.currency}`);
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
      t.set(payRef, { ...seen, status: 'granted', paidAmount: tx.amount, confirmationCode: tx.confirmation_code || null,
        grantedAt: new Date().toISOString(), passUntil: until }, { merge: true });
      return { status: 200, granted: true, plan: p.plan, until, justGranted: p.uid };
    });
    if (out.justGranted) {
      console.log(`[web-pay] ${out.justGranted}: ${out.plan} pass until ${out.until} (${ref})`);
      delete out.justGranted;
    }
    if (out.reversedGrant) {
      console.error(`[web-pay] REVERSED after the pass was granted: ${ref} (user ${out.reversedGrant}) - check it in the Pesapal dashboard`);
      delete out.reversedGrant;
    }
    return out;
  }

  // Pesapal's IPN (registered as GET): OrderTrackingId, OrderMerchantReference,
  // OrderNotificationType in the query. Unsigned by design, so it only triggers confirm(),
  // which asks Pesapal. Pesapal wants this JSON back, status 200 = handled, 500 = retry later.
  async function ipn(req, res) {
    const q = { ...(req.query || {}), ...(req.body || {}) };
    const orderTrackingId = String(q.OrderTrackingId || '');
    const txRef = String(q.OrderMerchantReference || '');
    const reply = (status) => res.json({ orderNotificationType: String(q.OrderNotificationType || 'IPNCHANGE'),
      orderTrackingId, orderMerchantReference: txRef, status });
    if (!GUID.test(orderTrackingId) || !REF.test(txRef)) return reply(500);
    try {
      const out = await confirm({ orderTrackingId, txRef });
      console.log(`[web-pay] ipn ${txRef}: ${out.granted ? 'granted' : (out.state || out.error)}`);
      reply(out.error && out.status >= 500 ? 500 : 200);
    } catch (e) {
      console.error('[web-pay] ipn failed:', e.message);
      reply(500);
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

  return { config, start, confirm, ipn, expireSweep };
}
