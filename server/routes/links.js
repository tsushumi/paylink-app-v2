const express = require('express');
const prisma = require('../lib/prisma');
const { requireUser } = require('../middleware/auth');

const router = express.Router();

// Merchant: create a payment link
router.post('/payment-links', requireUser, async (req, res) => {
  const description = String(req.body.description || '').trim();
  const amount = Number(req.body.amount);

  if (!description) return res.status(400).json({ error: 'Description is required' });
  if (description.length > 120) return res.status(400).json({ error: 'Description is too long (max 120)' });
  if (!Number.isInteger(amount) || amount < 1 || amount > 150000) {
    return res.status(400).json({ error: 'Amount must be a whole number between 1 and 150,000' });
  }

  const link = await prisma.paymentLink.create({
    data: { description, amount, userId: req.user.id },
  });
  res.status(201).json(link);
});

// Merchant: list own links
router.get('/payment-links', requireUser, async (req, res) => {
  const links = await prisma.paymentLink.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { payments: { where: { status: 'completed' } } } } },
  });
  res.json(
    links.map(({ _count, ...l }) => ({ ...l, paidCount: _count.payments }))
  );
});

// Public: payer loads a link
router.get('/payment-links/:id', async (req, res) => {
  const link = await prisma.paymentLink.findUnique({
    where: { id: req.params.id },
    include: { user: { select: { name: true } } },
  });
  if (!link || !link.active) return res.status(404).json({ error: 'Payment link not found' });
  res.json({
    id: link.id,
    merchantName: link.user.name,
    description: link.description,
    amount: link.amount,
  });
});

module.exports = router;
