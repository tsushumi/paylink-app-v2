// Development-only helpers: inspect mock email/SMS and simulate Safaricom callbacks.
// Never mounted when NODE_ENV=production.
const express = require('express');
const prisma = require('../lib/prisma');
const outbox = require('../lib/outbox');
const { handleStkCallback } = require('../services/paymentProcessor');
const payments = require('./payments');

const router = express.Router();

router.get('/dev/outbox', (req, res) => res.json({ emails: outbox.emails, sms: outbox.sms }));
router.delete('/dev/outbox', (req, res) => {
  outbox.clear();
  res.json({ success: true });
});

// POST /api/dev/simulate-callback { paymentId, success?: boolean }
router.post('/dev/simulate-callback', async (req, res) => {
  const payment = await prisma.payment.findUnique({ where: { id: String(req.body.paymentId || '') } });
  if (!payment?.checkoutRequestId) return res.status(404).json({ error: 'Payment not found' });
  const body = payments.mockCallbackBody(payment.checkoutRequestId, payment.amount, payment.phone, {
    success: req.body.success !== false,
  });
  res.json(await handleStkCallback(body));
});

// Backdate a completed payment (used to populate the 7-day chart for demos/screenshots).
router.post('/dev/backdate', async (req, res) => {
  const { paymentId, daysAgo } = req.body;
  const when = new Date(Date.now() - Number(daysAgo) * 86400000);
  await prisma.payment.update({ where: { id: String(paymentId) }, data: { paidAt: when, createdAt: when } });
  res.json({ success: true });
});

module.exports = router;
