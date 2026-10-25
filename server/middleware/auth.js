const prisma = require('../lib/prisma');

/**
 * Auth-lite for the assignment: the client sends the merchant's id in `x-user-id`.
 * We verify the user exists, but there is no password/token - replace with real auth
 * (JWT/session) before production.
 */
async function requireUser(req, res, next) {
  const userId = req.headers['x-user-id'];
  if (!userId) return res.status(401).json({ error: 'Missing x-user-id header' });
  const user = await prisma.user.findUnique({ where: { id: String(userId) } });
  if (!user) return res.status(401).json({ error: 'Unknown user' });
  req.user = user;
  next();
}

module.exports = { requireUser };
