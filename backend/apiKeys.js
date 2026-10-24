// API keys for the public Tonefy API (/v1) - a Pro/Creator feature (Oct 24 2026).
//
// A key is shown ONCE, when it is made, and only its SHA-256 is stored: `apiKeys/{hash}`.
// The hash is the document id, so checking a key is one read and the stored value cannot
// be used to call the API (a leak of this collection leaks no working key). Keys are long
// random strings, not passwords, so a plain fast hash is right - nothing to brute-force.
//
// The plan is checked on EVERY call (requirePlan in server.js), not when the key is made:
// an account that drops to Free keeps its keys, and they simply stop working until it
// upgrades again. Revoking is the owner's own action, from the website Profile.
//
// Server-only collection: firestore.rules denies anything not listed, and this is not.

import crypto from "crypto";

export const KEY_PREFIX = "tfy_live_";
export const MAX_ACTIVE_KEYS = 3;
const hashKey = (key) => crypto.createHash("sha256").update(String(key)).digest("hex");

export function createApiKeys({ db, FieldValue }) {
  const col = () => db.collection("apiKeys");

  async function list(uid) {
    const snap = await col().where("uid", "==", uid).get();
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(k => !k.revokedAt)
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
      .map(k => ({
        id: k.id,
        name: k.name || "",
        prefix: k.prefix,
        createdAt: k.createdAt?.toDate?.().toISOString() || null,
        lastUsedAt: k.lastUsedAt?.toDate?.().toISOString() || null,
      }));
  }

  /** Returns { key, ...listing } - the only time the full key exists outside the caller. */
  async function create(uid, name) {
    const active = await list(uid);
    if (active.length >= MAX_ACTIVE_KEYS) {
      const e = new Error(`You can have up to ${MAX_ACTIVE_KEYS} API keys. Revoke one to make another.`);
      e.status = 409; e.code = "too_many_keys"; e.publicMessage = e.message;
      throw e;
    }
    const key = KEY_PREFIX + crypto.randomBytes(32).toString("base64url");
    const id = hashKey(key);
    const clean = String(name || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 40) || "API key";
    await col().doc(id).set({
      uid, name: clean, prefix: key.slice(0, KEY_PREFIX.length + 6),
      createdAt: FieldValue.serverTimestamp(), lastUsedAt: null, revokedAt: null,
    });
    return { key, id, name: clean, prefix: key.slice(0, KEY_PREFIX.length + 6) };
  }

  /** Only the owner's own key; anything else is "not found", so ids cannot be probed. */
  async function revoke(uid, id) {
    if (!/^[0-9a-f]{64}$/.test(String(id || ""))) return false;
    const ref = col().doc(id);
    const snap = await ref.get();
    if (!snap.exists || snap.data().uid !== uid || snap.data().revokedAt) return false;
    await ref.set({ revokedAt: FieldValue.serverTimestamp() }, { merge: true });
    return true;
  }

  /** Bearer key -> { uid, keyId } or null. lastUsedAt is written at most once a minute. */
  async function authenticate(key) {
    if (typeof key !== "string" || !key.startsWith(KEY_PREFIX) || key.length > 100) return null;
    const id = hashKey(key);
    const snap = await col().doc(id).get();
    if (!snap.exists) return null;
    const k = snap.data();
    if (k.revokedAt) return null;
    const last = k.lastUsedAt?.toMillis?.() || 0;
    if (Date.now() - last > 60000) {
      col().doc(id).set({ lastUsedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
    }
    return { uid: k.uid, keyId: id };
  }

  /** For /api/account/delete: every key the account ever made, revoked or not. */
  async function purge(uid) {
    const snap = await col().where("uid", "==", uid).get();
    for (const d of snap.docs) await d.ref.delete();
  }

  return { list, create, revoke, authenticate, purge };
}
