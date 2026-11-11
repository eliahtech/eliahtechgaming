import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPath, deviceOf, browserOf, isBot, countryOf, recordView } from '../src/analytics.js';

const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const SAFARI_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

test('paths are cleaned and private or junk paths are never counted', () => {
  assert.equal(cleanPath('/posts/My-Guide?utm=1#x'), '/posts/my-guide');
  assert.equal(cleanPath('/posts/'), '/posts');
  assert.equal(cleanPath('/'), '/');
  for (const bad of ['', 'posts', '/admin', '/admin/users', '/api/v1/x', '/login', '/profile', '/payment/return', '/a/b/c/d', '/x y', '/' + 'a'.repeat(200), '//evil', '/<script>']) assert.equal(cleanPath(bad), null, bad);
});

test('device, browser, country and bot detection', () => {
  assert.equal(deviceOf(CHROME_ANDROID), 'mobile'); assert.equal(deviceOf(SAFARI_MAC), 'desktop');
  assert.equal(deviceOf('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'), 'tablet');
  assert.equal(browserOf(CHROME_ANDROID), 'Chrome'); assert.equal(browserOf(SAFARI_MAC), 'Safari'); assert.equal(browserOf('Mozilla/5.0 Firefox/120.0'), 'Firefox');
  assert.equal(browserOf('Mozilla/5.0 Chrome/120 Safari/537 Edg/120'), 'Edge');
  assert.equal(isBot('Googlebot/2.1'), true); assert.equal(isBot(''), true); assert.equal(isBot(CHROME_ANDROID), false);
  assert.equal(countryOf({ 'x-vercel-ip-country': 'ke' }), 'KE'); assert.equal(countryOf({}), 'XX'); assert.equal(countryOf({ 'x-vercel-ip-country': 'evil' }), 'XX');
});

test('a real visit is recorded with only path/country/device/browser; bots, Do Not Track and failures are safe', async () => {
  const calls = [];
  const db = { rpc: async (name, args) => { calls.push([name, args]); } };
  assert.equal(await recordView(db, { path: '/posts/a', headers: { 'user-agent': CHROME_ANDROID, 'x-vercel-ip-country': 'KE', 'x-forwarded-for': '1.2.3.4' } }), true);
  assert.deepEqual(calls[0], ['analytics_hit', { p_path: '/posts/a', p_country: 'KE', p_device: 'mobile', p_browser: 'Chrome' }]);
  assert.equal(JSON.stringify(calls).includes('1.2.3.4'), false, 'no IP address is stored');
  assert.equal(await recordView(db, { path: '/posts/a', headers: { 'user-agent': 'Googlebot/2.1' } }), false);
  assert.equal(await recordView(db, { path: '/posts/a', headers: { 'user-agent': CHROME_ANDROID, dnt: '1' } }), false);
  assert.equal(await recordView(db, { path: '/admin', headers: { 'user-agent': CHROME_ANDROID } }), false);
  assert.equal(await recordView({ rpc: async () => { throw new Error('db down'); } }, { path: '/', headers: { 'user-agent': CHROME_ANDROID } }), false);
  assert.equal(calls.length, 1);
});
