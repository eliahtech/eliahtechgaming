// Server-side access calculation. The browser never supplies role or premium state; it is derived here from
// the profile row and the subscriptions table, both written only by the server (service role).

export const TRIAL_DAYS_DEFAULT = 3;

const toMs = (value) => {
  const ms = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(ms) ? null : ms;
};

export function computeAccess({ profile, subscriptions = [], now = new Date() } = {}) {
  const nowMs = now.getTime();
  const trialStart = toMs(profile?.trial_started_at);
  const trialEnd = toMs(profile?.trial_ends_at);
  const trial = {
    started_at: profile?.trial_started_at ?? null,
    ends_at: profile?.trial_ends_at ?? null,
    active: trialEnd !== null && trialEnd > nowMs,
    expired: trialStart !== null && trialEnd !== null && trialEnd <= nowMs,
  };

  const paidUntil = subscriptions
    .filter((s) => s.status === 'active' && toMs(s.expires_at) !== null && toMs(s.expires_at) > nowMs)
    .map((s) => toMs(s.expires_at))
    .sort((a, b) => b - a)[0];

  const isAdmin = profile?.role === 'admin';
  let source = 'none';
  if (isAdmin) source = 'admin';
  else if (paidUntil !== undefined) source = 'subscription';
  else if (profile?.role === 'premium_user') source = 'role';
  else if (trial.active) source = 'trial';

  const isPremium = source !== 'none';
  return {
    role: isAdmin ? 'admin' : isPremium ? 'premium_user' : 'free_user',
    isAdmin,
    isPremium,
    source,
    trial,
    premiumUntil: paidUntil !== undefined ? new Date(paidUntil).toISOString() : null,
  };
}

// Public, snake_case view of an authenticated account for API responses (never includes tokens or internals).
export function accountView(user) {
  const { access, profile } = user;
  return {
    id: user.id,
    email: user.email,
    email_verified: Boolean(user.emailVerified),
    display_name: profile?.display_name ?? null,
    avatar_url: profile?.avatar_url ?? null,
    role: access.role,
    access: { is_premium: access.isPremium, source: access.source, trial: access.trial, premium_until: access.premiumUntil },
  };
}
