const express = require('express');
const { requireUser } = require('../middleware/auth');
const notificationService = require('../services/notificationService');

const router = express.Router();
router.use('/notifications', requireUser);

router.get('/notifications', async (req, res) => {
  res.json(await notificationService.list(req.user.id));
});

// Declared before "/:id/read" so "read-all" is never treated as an id.
router.post('/notifications/read-all', async (req, res) => {
  await notificationService.markAllRead(req.user.id);
  res.json({ success: true });
});

router.post('/notifications/:id/read', async (req, res) => {
  const ok = await notificationService.markRead(req.user.id, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Notification not found' });
  res.json({ success: true });
});

module.exports = router;
