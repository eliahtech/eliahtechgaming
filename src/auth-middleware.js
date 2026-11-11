// Reusable authorization middleware. Authorization is derived only from the verified Supabase token plus
// server-side rows; nothing in req.body or other client input can grant admin or premium access.
import { AppError } from './errors.js';
import { computeAccess } from './access.js';

const bearerToken = (req) => /^Bearer\s+(\S+)$/i.exec(req.headers?.authorization || '')?.[1] || null;

export function createAuthMiddleware({ auth, loadContext, now = () => new Date() }) {
  const authenticate = async (req) => {
    const token = bearerToken(req);
    if (!token) return null;
    const user = await auth.getUser(token); // throws 401 INVALID_TOKEN when Supabase rejects the token
    const { profile, subscriptions } = await loadContext(user.id);
    return { id: user.id, email: user.email, emailVerified: user.email_verified, profile, access: computeAccess({ profile, subscriptions, now: now() }), token };
  };

  // Guests pass through; a token that is present but invalid is rejected rather than treated as a guest.
  const optionalAuth = (req, _res, next) => { authenticate(req).then((user) => { req.user = user; next(); }, next); };

  const requireAuth = (req, _res, next) => {
    authenticate(req).then((user) => {
      if (!user) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.', 401);
      req.user = user;
      next();
    }).catch(next);
  };

  const requireAdmin = (req, res, next) => requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (!req.user.access.isAdmin || !req.user.emailVerified) return next(new AppError('FORBIDDEN', 'You do not have permission to do that.', 403));
    return next();
  });

  const requirePremium = (req, res, next) => requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (!req.user.access.isPremium) return next(new AppError('PREMIUM_REQUIRED', 'This feature is available to Premium members.', 403));
    return next();
  });

  return { optionalAuth, requireAuth, requireAdmin, requirePremium };
}
