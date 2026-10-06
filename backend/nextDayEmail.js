// The one reminder email: "your first video is about 2 minutes away" (Oct 6 2026).
//
// WHY: of the nine strangers who installed after launch, none finished a video, and most
// made no request at all after signing in. Local push reminders only start after a first
// video, or after a day on the dashboard and a permission prompt, so someone who looked
// once and left never heard from Tonefy again. Owner approved this email on Oct 6 2026.
//
// WHO GETS IT - deliberately narrow, because it lands in a real person's inbox and
// cannot be unsent:
//   - an account created 22-48 hours ago (so only NEW signups; nobody who joined before
//     this shipped is suddenly emailed, and a server outage cannot cause a late burst)
//   - with a VERIFIED email (Google sign-ins, or an email account that confirmed). An
//     unverified address may belong to someone who never signed up - since Oct 6 an email
//     signup goes straight into the app unverified, so this matters.
//   - who has NOT made a video (no userVideos record)
//   - not an admin, not Google's test-lab robot, not disabled
//   - never sent it before, and has not unsubscribed
// Once per account, ever. The flag is written BEFORE sending, so a crash between the two
// can lose an email but never send one twice.
//
// UNSUBSCRIBE: every email carries a signed one-click link (and the List-Unsubscribe
// headers Gmail and others use for their own unsubscribe button). It sets
// emailPrefs/{uid}.optOut, which every future automated email must check too.
// emailPrefs is server-only and deleted with the account (/api/account/delete).

import crypto from 'crypto';

const WINDOW_MIN_MS = 22 * 60 * 60 * 1000;
const WINDOW_MAX_MS = 48 * 60 * 60 * 1000;
const SWEEP_MS = 60 * 60 * 1000;
const API = 'https://api.fitlifesolutions.site';
const OPEN_URL = 'https://tonefy-ai.fitlifesolutions.site/open.html';

// The names in emails come from the user's own profile; HTML-escape them.
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function sign(uid, secret) {
  return crypto.createHmac('sha256', secret).update(`unsub:${uid}`).digest('base64url').slice(0, 32);
}

export function unsubscribeUrl(uid, secret) {
  return `${API}/email/unsubscribe?u=${encodeURIComponent(uid)}&t=${sign(uid, secret)}`;
}

export function verifyUnsubscribe(uid, token, secret) {
  if (!uid || !token || !secret) return false;
  const want = Buffer.from(sign(uid, secret));
  const got = Buffer.from(String(token));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

export function nextDayEmailHtml(firstName, unsubUrl) {
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi,';
  const idea = (t) => `<li style="margin: 0 0 6px;">${t}</li>`;
  return `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background-color: #ffffff;">
  <div style="text-align: center; margin-bottom: 28px;">
    <span style="font-size: 22px; font-weight: 700; color: #111111;">Tonefy <span style="color: #2ECC71;">AI</span></span>
  </div>
  <p style="font-size: 16px; color: #111111; line-height: 1.5; margin: 0 0 12px;">${greeting}</p>
  <p style="font-size: 16px; color: #333333; line-height: 1.5; margin: 0 0 12px;">Thank you for joining Tonefy AI. Your first video is about 2 minutes away, and your free credits are ready to use.</p>
  <p style="font-size: 16px; color: #333333; line-height: 1.5; margin: 0 0 12px;">Type one sentence about anything you like. Tonefy writes the script, adds a voice and finds the video clips for you. Need an idea? Try one of these:</p>
  <ul style="font-size: 15px; color: #333333; line-height: 1.5; margin: 0 0 28px; padding-left: 20px;">
    ${idea('3 easy ways to save money')}${idea('Why sleep matters for your health')}${idea('Fun facts about Lake Victoria')}
  </ul>
  <div style="text-align: center; margin: 0 0 28px;">
    <a href="${OPEN_URL}" style="display: inline-block; background-color: #2ECC71; color: #04211f; font-weight: 700; font-size: 16px; text-decoration: none; padding: 14px 36px; border-radius: 8px;">Make my first video</a>
  </div>
  <p style="font-size: 14px; color: #333333; line-height: 1.5; margin: 0 0 28px;">If you get stuck, just reply to this email and we will help.</p>
  <p style="font-size: 14px; color: #333333; line-height: 1.5; margin: 0 0 28px;">Thanks,<br>The Tonefy AI team</p>
  <p style="font-size: 12px; color: #888888; line-height: 1.5; margin: 0;">You are getting this one-time email because you created a Tonefy AI account. <a href="${unsubUrl}" style="color: #888888;">Unsubscribe</a></p>
</div>`;
}

export function nextDayEmailText(firstName, unsubUrl) {
  return [
    firstName ? `Hi ${firstName},` : 'Hi,',
    '',
    'Thank you for joining Tonefy AI. Your first video is about 2 minutes away, and your free credits are ready to use.',
    '',
    'Type one sentence about anything you like. Tonefy writes the script, adds a voice and finds the video clips for you. Need an idea? Try one of these:',
    '- 3 easy ways to save money',
    '- Why sleep matters for your health',
    '- Fun facts about Lake Victoria',
    '',
    `Make my first video: ${OPEN_URL}`,
    '',
    'If you get stuck, just reply to this email and we will help.',
    '',
    'Thanks,',
    'The Tonefy AI team',
    '',
    `You are getting this one-time email because you created a Tonefy AI account. Unsubscribe: ${unsubUrl}`,
  ].join('\n');
}

/**
 * deps: { getAuth, adminDb, transporter, from, replyTo, secret, isExcluded(userRecord) }
 * Returns { start, sweep } - sweep({ dryRun }) reports who it would email.
 */
export function createNextDayEmail(deps) {
  const { getAuth, adminDb, transporter, from, replyTo, secret, isExcluded } = deps;
  let running = false;

  async function candidates(now) {
    const out = [];
    let pageToken;
    do {
      const page = await getAuth().listUsers(1000, pageToken);
      for (const u of page.users) {
        const age = now - Date.parse(u.metadata.creationTime);
        if (age < WINDOW_MIN_MS || age > WINDOW_MAX_MS) continue;
        if (!u.email || !u.emailVerified || u.disabled || isExcluded(u)) continue;
        out.push(u);
      }
      pageToken = page.pageToken;
    } while (pageToken);
    return out;
  }

  async function sweep({ dryRun = false } = {}) {
    if (running) return { skipped: 'already running' };
    if (!transporter || !secret) return { skipped: 'email or EMAIL_LINK_SECRET not configured' };
    running = true;
    const report = { sent: [], wouldSend: [], failed: [] };
    try {
      for (const u of await candidates(Date.now())) {
        const prefRef = adminDb.collection('emailPrefs').doc(u.uid);
        const pref = (await prefRef.get()).data() || {};
        if (pref.optOut || pref.nextDayAt) continue;
        const vids = await adminDb.collection('userVideos').where('userId', '==', u.uid).limit(1).get();
        if (!vids.empty) continue;
        if (dryRun) { report.wouldSend.push(u.uid); continue; }

        // Flag first: at most once, even if the send or the process dies mid-way.
        await prefRef.set({ nextDayAt: new Date().toISOString(), nextDayStatus: 'sending' }, { merge: true });
        const userDoc = (await adminDb.collection('users').doc(u.uid).get()).data() || {};
        const firstName = userDoc.firstName || String(u.displayName || '').trim().split(/\s+/)[0] || '';
        const unsub = unsubscribeUrl(u.uid, secret);
        try {
          await transporter.sendMail({
            from, to: u.email, replyTo,
            subject: 'Your first video is about 2 minutes away',
            html: nextDayEmailHtml(firstName, unsub),
            text: nextDayEmailText(firstName, unsub),
            headers: {
              'List-Unsubscribe': `<${unsub}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
          });
          await prefRef.set({ nextDayStatus: 'sent' }, { merge: true });
          report.sent.push(u.uid);
          console.log(`[next-day-email] sent to ${u.uid}`);
        } catch (e) {
          await prefRef.set({ nextDayStatus: 'failed' }, { merge: true });
          report.failed.push(u.uid);
          console.error(`[next-day-email] ${u.uid} failed:`, e.message);
        }
      }
    } catch (e) {
      console.error('[next-day-email] sweep failed:', e.message);
      report.error = 'sweep failed';
    } finally {
      running = false;
    }
    return report;
  }

  function start() {
    setTimeout(() => sweep(), 2 * 60 * 1000);
    setInterval(() => sweep(), SWEEP_MS);
  }

  return { start, sweep };
}
