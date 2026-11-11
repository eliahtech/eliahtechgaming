// Route table for /api/v1/ai. `registerAiRoutes` only calls router.get/post/patch/delete, so it works with an Express Router
// in production and with a recording router in tests. Order matters: per-IP limiter first (cheap, before any token check),
// then authentication, then the handler. Everything is no-store because answers are private.
export function registerAiRoutes(router, { controller, optionalAuth, requireAuth, limit }) {
  const ipChat = limit('ai-chat-ip', 40, 60, { failClosed: true });
  const ipRead = limit('ai-read-ip', 120, 60);
  router.use?.((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  router.get('/config', ipRead, optionalAuth, controller.config);
  router.get('/models', ipRead, optionalAuth, controller.models);
  router.get('/usage', ipRead, optionalAuth, controller.usage);
  router.post('/chat', ipChat, optionalAuth, controller.chat);

  router.get('/conversations', ipRead, requireAuth, controller.listConversations);
  router.post('/conversations', ipRead, requireAuth, controller.createConversation);
  router.get('/conversations/:id', ipRead, requireAuth, controller.getConversation);
  router.patch('/conversations/:id', ipRead, requireAuth, controller.renameConversation);
  router.delete('/conversations/:id', ipRead, requireAuth, controller.deleteConversation);
  return router;
}
