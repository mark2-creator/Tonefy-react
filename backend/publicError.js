// What a caught error may say to the client.
//
// About thirty catch blocks sent `e.message` straight back in a response or a job's
// `error`/`message` field, and the apps show those fields to users. e.message is
// whatever failed: ffmpeg's stderr, a Firestore error, an ENOENT naming a path on this
// server, a third-party API's raw body, a "Request failed with status code 429". That
// is an information leak, and to a user it reads as the app being broken.
//
// The rule matches the app's utils/friendlyError.js: a message passes only if it is a
// plain sentence - no URL, hostname, path, stack frame, exception name, error code,
// status dump or JSON. Messages this code writes on purpose ("That file is too large",
// plan-limit text) are plain sentences and keep reaching users; anything else becomes
// the caller's fallback. An error can opt in explicitly with `e.userMessage`.
// The full error always goes to the log first.

const RAW_RE = new RegExp([
  'https?://', '\\b[\\w-]+\\.(?:site|com|net|org|io|ai|app|dev|cloud|js|py|mp4|mp3|json)\\b',
  '(?:^|\\s)/[\\w.-]+/', '\\bat [\\w.$<>]+ \\(', '\\w+exception\\b', '[{}<>]',
  '\\b(?:errno|syscall|stack|undefined|null|NaN)\\b', 'cannot read propert', 'is not a function',
  'is not defined', '\\b(?:firebase|firestore|ffmpeg|ffprobe|magick|groq|openai|fal\\.ai|axios)\\b',
  '\\bstatus(?: ?code)? \\d{3}', '\\(#?\\d{3}\\)', 'auth/', 'timed? ?out', 'socket hang up',
  'invalid_grant', 'unexpected token', 'json',
].join('|'), 'i');
// Error codes are upper case and matched case-sensitively, or 'every' would be one.
const CODE_RE = /\b(?:E[A-Z]{4,}|E_[A-Z_]+|[A-Z]+_[A-Z_]{3,})\b/;

export function isPublicMessage(text) {
  if (typeof text !== 'string') return false;
  const t = text.trim();
  return !!t && t.length <= 300 && !RAW_RE.test(t) && !CODE_RE.test(t);
}

export function publicError(e, fallback = 'Something went wrong. Please try again.', tag = '') {
  if (e && e.userMessage) return e.userMessage;
  const msg = typeof e === 'string' ? e : e && e.message;
  if (isPublicMessage(msg)) return msg.trim();
  console.error(`[publicError]${tag ? ' ' + tag : ''} withheld from client:`, msg);
  return fallback;
}
