import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAccess, accountView } from '../src/access.js';

const now = new Date('2026-10-10T12:00:00Z');
const day = 86400000;
const iso = (offsetDays) => new Date(now.getTime() + offsetDays * day).toISOString();

test('a verified user inside the trial window is premium via trial', () => {
  const a = computeAccess({ profile: { role: 'free_user', trial_started_at: iso(-1), trial_ends_at: iso(2) }, now });
  assert.deepEqual([a.isPremium, a.source, a.role, a.trial.active], [true, 'trial', 'premium_user', true]);
});

test('after the trial the account is free and the trial is marked expired (account is kept)', () => {
  const a = computeAccess({ profile: { role: 'free_user', trial_started_at: iso(-5), trial_ends_at: iso(-2) }, now });
  assert.deepEqual([a.isPremium, a.source, a.role, a.trial.expired], [false, 'none', 'free_user', true]);
});

test('no trial dates (unverified account) means free', () => {
  const a = computeAccess({ profile: { role: 'free_user' }, now });
  assert.deepEqual([a.isPremium, a.trial.active, a.trial.expired], [false, false, false]);
});

test('only an active, unexpired subscription grants premium', () => {
  const profile = { role: 'free_user' };
  assert.equal(computeAccess({ profile, subscriptions: [{ status: 'active', expires_at: iso(10) }], now }).source, 'subscription');
  assert.equal(computeAccess({ profile, subscriptions: [{ status: 'active', expires_at: iso(-1) }], now }).isPremium, false);
  assert.equal(computeAccess({ profile, subscriptions: [{ status: 'cancelled', expires_at: iso(10) }], now }).isPremium, false);
  assert.equal(computeAccess({ profile, subscriptions: [{ status: 'active', expires_at: null }], now }).isPremium, false);
  const latest = computeAccess({ profile, subscriptions: [{ status: 'active', expires_at: iso(3) }, { status: 'active', expires_at: iso(30) }], now });
  assert.equal(latest.premiumUntil, iso(30));
});

test('admin role is admin and premium; premium_user role is premium', () => {
  assert.deepEqual([computeAccess({ profile: { role: 'admin' }, now }).isAdmin, computeAccess({ profile: { role: 'admin' }, now }).isPremium], [true, true]);
  assert.equal(computeAccess({ profile: { role: 'premium_user' }, now }).source, 'role');
});

test('missing profile is a plain free user, never privileged', () => {
  const a = computeAccess({ profile: null, now });
  assert.deepEqual([a.isAdmin, a.isPremium, a.role], [false, false, 'free_user']);
});

test('garbage trial dates do not grant access', () => {
  assert.equal(computeAccess({ profile: { role: 'free_user', trial_ends_at: 'not-a-date' }, now }).isPremium, false);
});

test('account view exposes no tokens or internal fields', () => {
  const user = { id: 'u1', email: 'a@b.co', emailVerified: true, token: 'secret-token', profile: { display_name: 'Ann', role: 'admin', avatar_url: null }, access: computeAccess({ profile: { role: 'free_user' }, now }) };
  const view = accountView(user);
  assert.equal(JSON.stringify(view).includes('secret-token'), false);
  assert.deepEqual(Object.keys(view).sort(), ['access', 'avatar_url', 'display_name', 'email', 'email_verified', 'id', 'role']);
  assert.equal(view.role, 'free_user'); // role comes from computed access, not from a raw profile value
});
