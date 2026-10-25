const express = require('express');
const prisma = require('../lib/prisma');
const { formatKenyanPhone, toLocalFormat } = require('../lib/phone');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone });

router.post('/auth/register', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const rawPhone = String(req.body.phone || '').trim();

  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required' });

  let phone = null;
  if (rawPhone) {
    const normalized = formatKenyanPhone(rawPhone);
    if (!normalized) return res.status(400).json({ error: 'Enter a valid Kenyan phone number (e.g. 0712345678)' });
    phone = toLocalFormat(normalized);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: 'An account with this email already exists' });

  const user = await prisma.user.create({ data: { name, email, phone } });
  res.status(201).json({ user: publicUser(user) });
});

router.post('/auth/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(404).json({ error: 'No account found for that email' });
  res.json({ user: publicUser(user) });
});

module.exports = router;
