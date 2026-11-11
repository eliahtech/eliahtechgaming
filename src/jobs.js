import { createLinkChecker } from './link-checker.js';
import { createMailAdmin } from './admin/mail.js';
import { sanitizeContent } from './sanitize.js';
import { authorizedScheduler } from './scheduler-auth.js';

// One endpoint does all scheduled work. It is safe to call as often as you like: newsletters are limited to the daily allowance
// (so extra calls on the same day send nothing) and a short lease stops two runs from overlapping.
// Vercel Cron calls it with GET once a day; an external scheduler may call it with POST.
export function registerJobs(app, { db, email, appUrl }) {
  const run = async (req, res, next) => {
    try {
      if (!authorizedScheduler(req.headers.authorization)) return res.sendStatus(403);
      const claimed = await db.rpc('claim_gaming_job');
      if (!claimed) return res.status(409).json({ success: false, error: { code: 'JOB_RUNNING', message: 'Another worker is running.' } });
      await db.rpc('notify_due_gaming_posts');
      const mail = createMailAdmin({ db, email, appUrl, sanitize: sanitizeContent, batchSize: Number(process.env.NEWSLETTER_BATCH_SIZE) || 50, dailyLimit: process.env.NEWSLETTER_DAILY_LIMIT });
      const newsletter = await mail.campaigns.processDaily();
      const links = await createLinkChecker({ db, appUrl }).runBatch();
      res.set('Cache-Control', 'no-store').json({ success: true, data: { processed: true, newsletter, links } });
    } catch (err) { next(err); }
  };
  app.post('/api/v1/jobs/run', run);
  app.get('/api/v1/jobs/run', run);
}
