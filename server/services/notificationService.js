const prisma = require('../lib/prisma');
const { getIo, room } = require('../lib/io');

function serialize(n) {
  let data = {};
  try {
    data = JSON.parse(n.data || '{}');
  } catch {
    data = {};
  }
  return {
    id: n.id,
    userId: n.userId,
    type: n.type,
    title: n.title,
    message: n.message,
    data,
    read: n.read,
    createdAt: n.createdAt.toISOString(),
  };
}

/** Persist a notification and push it to every open tab of that merchant. */
async function createNotification({ type, title, message, data = {}, userId }) {
  const row = await prisma.notification.create({
    data: { type, title, message, data: JSON.stringify(data), userId },
  });
  const notification = serialize(row);
  const io = getIo();
  if (io) io.to(room.merchant(userId)).emit('notification', notification);
  return notification;
}

async function list(userId, limit = 30) {
  const rows = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  const unreadCount = await prisma.notification.count({ where: { userId, read: false } });
  return { notifications: rows.map(serialize), unreadCount };
}

async function markRead(userId, id) {
  // updateMany scopes by userId so one merchant cannot touch another's notifications.
  const res = await prisma.notification.updateMany({ where: { id, userId }, data: { read: true } });
  return res.count > 0;
}

async function markAllRead(userId) {
  await prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
}

module.exports = { createNotification, list, markRead, markAllRead, serialize };
