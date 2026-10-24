// node test-safe-fetch.mjs - SSRF guard checks (needs internet for the public/redirect cases).
import assert from 'assert/strict';
import { safeFetch, checkUrl, isPublicAddress, isUnsafeUrlError } from './safeFetch.js';

for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1'])
  assert.ok(!isPublicAddress(ip), `private: ${ip}`);
for (const ip of ['8.8.8.8', '173.212.232.182', '2606:4700::1111']) assert.ok(isPublicAddress(ip), `public: ${ip}`);

const refused = async (url) => {
  try { const r = await safeFetch(url, { signal: AbortSignal.timeout(10000) }); assert.fail(`fetched ${url} (${r.status})`); }
  catch (e) { assert.ok(isUnsafeUrlError(e), `${url} should be refused, got ${e.code} ${e.message}`); }
};
for (const u of [
  'http://127.0.0.1:5000/', 'http://localhost:5000/', 'http://localhost/', 'http://[::1]/', 'http://2130706433/',
  'http://0x7f000001/', 'http://169.254.169.254/latest/meta-data/', 'file:///etc/passwd', 'ftp://example.com/',
  'https://api.fitlifesolutions.site:5000/', 'http://user:pw@example.com/', 'http://127.0.0.1.nip.io/',
  // a public URL that redirects to localhost
  'https://httpbin.org/redirect-to?url=http%3A%2F%2F127.0.0.1%3A5000%2F',
]) await refused(u);

// Legitimate: a public page, and our own media host on 443.
let r = await safeFetch('https://example.com/', { signal: AbortSignal.timeout(15000) });
assert.equal(r.status, 200);
r = await safeFetch('https://api.fitlifesolutions.site/', { signal: AbortSignal.timeout(15000) });
assert.ok(r.status < 500, `own host reachable on 443 (${r.status})`);
assert.equal(checkUrl('https://example.com/a').hostname, 'example.com');
console.log('safe-fetch: all checks passed');
