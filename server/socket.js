const { Server } = require('socket.io');
const prisma = require('./lib/prisma');
const { setIo, room } = require('./lib/io');
const { payerStatusPayload } = require('./services/paymentProcessor');

/**
 * Socket.IO setup.
 *
 * The lesson tracked sockets in Maps keyed by paymentLinkId / userId. That breaks as soon as two
 * payers open the same link (the second overwrites the first and the first never gets updates)
 * or a merchant has two tabs open. Socket.IO rooms solve this directly:
 *   - payment:<paymentId>  -> exactly the browser(s) watching that one payment
 *   - link:<linkId>        -> anyone viewing a link page (kept for the lesson's 'watch-payment')
 *   - merchant:<userId>    -> every open tab of that merchant
 */
function initSocket(httpServer, allowedOrigins) {
  const io = new Server(httpServer, {
    cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
  });
  setIo(io);

  io.on('connection', (socket) => {
    // Payer opens a payment page
    socket.on('watch-payment', (paymentLinkId) => {
      if (typeof paymentLinkId !== 'string') return;
      socket.join(room.link(paymentLinkId));
    });

    // Payer has started a specific payment attempt. Replies with the current status so a
    // callback that landed before this join (or during a reconnect) is never missed.
    socket.on('watch-payment-attempt', async (paymentId, ack) => {
      try {
        if (typeof paymentId !== 'string') throw new Error('bad id');
        socket.join(room.payment(paymentId));
        const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
        if (typeof ack === 'function') ack(payment ? payerStatusPayload(payment) : { status: 'unknown' });
      } catch {
        if (typeof ack === 'function') ack({ status: 'unknown' });
      }
    });

    // Merchant dashboard registers for notifications
    socket.on('register-merchant', async (userId, ack) => {
      try {
        const user = typeof userId === 'string' ? await prisma.user.findUnique({ where: { id: userId } }) : null;
        if (!user) {
          if (typeof ack === 'function') ack({ ok: false });
          return;
        }
        socket.join(room.merchant(user.id));
        if (typeof ack === 'function') ack({ ok: true });
      } catch {
        if (typeof ack === 'function') ack({ ok: false });
      }
    });
    // Rooms are cleaned up automatically on disconnect - no manual Map bookkeeping.
  });

  return io;
}

module.exports = { initSocket };
