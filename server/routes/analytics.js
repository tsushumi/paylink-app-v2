const express = require('express');
const prisma = require('../lib/prisma');
const { requireUser } = require('../middleware/auth');
const { dayKey, weekdayLabel } = require('../lib/format');

const router = express.Router();
const DAY_MS = 24 * 60 * 60 * 1000;

router.get('/analytics', requireUser, async (req, res) => {
  const userId = req.user.id;
  const where = { paymentLink: { userId }, status: 'completed' };

  const totals = await prisma.payment.aggregate({
    where,
    _sum: { amount: true },
    _count: { id: true },
  });

  // Build the last 7 calendar days in the merchant's time zone (Nairobi), oldest first.
  // (The lesson version used UTC dates, which put payments made between 00:00 and 03:00 EAT
  // on the wrong day.)
  const now = Date.now();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * DAY_MS);
    days.push({ date: dayKey(d), label: weekdayLabel(d), total: 0, count: 0 });
  }
  const byDate = new Map(days.map((d) => [d.date, d]));

  // Fetch a day of slack, then bucket precisely.
  const recent = await prisma.payment.findMany({
    where: { ...where, paidAt: { gte: new Date(now - 8 * DAY_MS) } },
    select: { amount: true, paidAt: true },
  });
  for (const p of recent) {
    const bucket = byDate.get(dayKey(p.paidAt));
    if (bucket) {
      bucket.total += p.amount;
      bucket.count += 1;
    }
  }

  res.json({
    totalReceived: totals._sum.amount || 0,
    totalPayments: totals._count.id || 0,
    chartData: days,
  });
});

module.exports = router;
