// Fetching a URL a USER gave us, without letting them aim this server at itself.
//
// /api/extract-url fetched whatever address it was sent, and so did every route that
// downloads a user-supplied media URL (downloadToFile). Any signed-in user could make
// this box request http://127.0.0.1:<port> - MySQL, n8n and other pm2 services listen on
// localhost here - or a private/metadata address, and read the reply back as a "script"
// or as a file served from /audios/. That is a server-side request forgery (found Oct 24
// 2026, fixed the same day).
//
// The rules, all enforced here so no caller can forget one:
// - http/https only, and only ports 80/443. The VPS's own public IP is allowed on those,
//   because what answers there is nginx serving the public sites - the same thing anyone
//   on the internet gets (and our own https://api.fitlifesolutions.site/videos/ links
//   have to keep working). Port 5000 and every other service are refused.
// - The resolved address must be public unicast. Checked in the socket's DNS lookup, so
//   the address checked IS the address connected to - a name that resolves public for a
//   check and private for the connect (DNS rebinding) gains nothing.
//   An IP-literal host never reaches lookup, so it is checked up front.
// - Redirects are followed by hand (at most 5), every hop re-checked.

import http from "http";
import https from "https";
import dns from "dns";
import net from "net";
import fetch from "node-fetch";

const blocked = new net.BlockList();
for (const [a, p] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(a, p, 'ipv4');
for (const [a, p] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 32],
  ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
]) blocked.addSubnet(a, p, 'ipv6');

export class UnsafeUrlError extends Error {
  constructor(msg) { super(msg); this.name = 'UnsafeUrlError'; this.unsafeUrl = true; this.code = 'EUNSAFEURL'; }
}

export function isPublicAddress(ip) {
  const family = net.isIP(ip);
  if (!family) return false;
  if (family === 6) {
    // ::ffff:127.0.0.1 is 127.0.0.1.
    const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (m) return isPublicAddress(m[1]);
    return !blocked.check(ip, 'ipv6');
  }
  return !blocked.check(ip, 'ipv4');
}

// Throws UnsafeUrlError for anything we must not fetch; returns the parsed URL otherwise.
export function checkUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch (e) { throw new UnsafeUrlError('not a URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new UnsafeUrlError(`protocol ${u.protocol}`);
  if (u.username || u.password) throw new UnsafeUrlError('credentials in URL');
  if (u.port && !['80', '443'].includes(u.port)) throw new UnsafeUrlError(`port ${u.port}`);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && !isPublicAddress(host)) throw new UnsafeUrlError(`address ${host}`);
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw new UnsafeUrlError(`host ${host}`);
  return u;
}

function guardedLookup(hostname, options, cb) {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err);
    const list = Array.isArray(addrs) ? addrs : [{ address: addrs, family: options.family || 4 }];
    const bad = list.find(a => !isPublicAddress(a.address));
    if (bad) return cb(new UnsafeUrlError(`${hostname} resolves to ${bad.address}`));
    if (options.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}
const httpAgent = new http.Agent({ lookup: guardedLookup });
const httpsAgent = new https.Agent({ lookup: guardedLookup });

/**
 * node-fetch with the rules above. Same options and return value as fetch; redirects are
 * followed here, so `redirect` is ignored. Rejects with UnsafeUrlError for a refused URL.
 */
export async function safeFetch(url, options = {}) {
  let current = String(url);
  for (let hop = 0; hop <= 5; hop++) {
    const u = checkUrl(current);
    const res = await fetch(u.href, {
      ...options,
      redirect: 'manual',
      agent: u.protocol === 'https:' ? httpsAgent : httpAgent,
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), u).href;
      res.body?.resume?.();
      continue;
    }
    return res;
  }
  throw new UnsafeUrlError('too many redirects');
}

/** The body as text, refusing to buffer more than maxBytes (a page, not a disk image). */
export async function readTextCapped(res, maxBytes = 5 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > maxBytes) { res.body.destroy?.(); break; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// True for a refusal from here, whether thrown directly or wrapped by node-fetch (which
// keeps the code but not the error when the guarded DNS lookup refuses).
export const isUnsafeUrlError = (e) => !!(e && (e.unsafeUrl || e.code === 'EUNSAFEURL'));
