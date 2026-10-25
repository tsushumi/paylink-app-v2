const prisma = require('../lib/prisma');
const { getIo, room } = require('../lib/io');
const { toLocalFormat } = require('../lib/phone');
const { formatKES } = require('../lib/format');
const { sendEmail } = require('./emailService');
const { sendSMS } = require('./smsService');
const { buildPaymentReceiptEmail } = require('../emails/paymentReceipt');
const { buildSMS } = require('../sms/templates');
const notificationService = require('./notificationService');

const emitToPayer = (paymentId, payload) => {
  const io = getIo();
  if (io) io.to(room.payment(paymentId)).emit('payment-status', { paymentId, ...payload });
};

/** Current state of a payment, shaped for the payer's browser. */
const payerStatusPayload = (p) => ({
  status: p.status,
  amount: p.amount,
  mpesaReceiptNumber: p.mpesaReceiptNumber || undefined,
  paidAt: p.paidAt ? p.paidAt.toISOString() : undefined,
  reason: p.failureReason || undefined,
});

/**
 * Process a Safaricom STK callback body. Safe to call more than once for the same
 * CheckoutRequestID: Safaricom retries callbacks, and the status guard below makes
 * sure the receipt email, SMS and notification are only produced the first time.
 */
async function handleStkCallback(body) {
  const cb = body?.Body?.stkCallback;
  if (!cb?.CheckoutRequestID) return { ok: false, reason: 'malformed callback' };

  const payment = await prisma.payment.findUnique({
    where: { checkoutRequestId: cb.CheckoutRequestID },
    include: { paymentLink: { include: { user: true } } },
  });
  if (!payment) {
    console.error('[callback] payment not found for', cb.CheckoutRequestID);
    return { ok: false, reason: 'payment not found' };
  }
  if (payment.status !== 'pending') {
    console.log(`[callback] duplicate for ${payment.id} (already ${payment.status}), ignored`);
    return { ok: true, duplicate: true };
  }

  // Tell the payer we have a result and are confirming it ("Processing...").
  emitToPayer(payment.id, { status: 'processing' });

  const merchant = payment.paymentLink.user;
  const resultCode = Number(cb.ResultCode);

  if (resultCode === 0) {
    const items = cb.CallbackMetadata?.Item || [];
    const get = (name) => items.find((i) => i.Name === name)?.Value;
    const amount = Math.round(Number(get('Amount') ?? payment.amount));
    const mpesaReceiptNumber = String(get('MpesaReceiptNumber') ?? '');
    const payerPhone = String(get('PhoneNumber') ?? payment.phone);
    const paidAt = new Date();

    // Atomic claim: only one concurrent callback can flip pending -> completed.
    const claim = await prisma.payment.updateMany({
      where: { id: payment.id, status: 'pending' },
      data: { status: 'completed', mpesaReceiptNumber, paidAt, amount },
    });
    if (claim.count === 0) return { ok: true, duplicate: true };

    // 1. Real-time: payer's browser
    emitToPayer(payment.id, {
      status: 'completed',
      amount,
      mpesaReceiptNumber,
      paidAt: paidAt.toISOString(),
    });

    // 2-4. Email, SMS and bell are independent: one failing must not stop the others.
    const jobs = [];

    if (payment.payerEmail) {
      const { html, text } = buildPaymentReceiptEmail({
        payerName: payment.payerName || 'Customer',
        amount,
        merchantName: merchant.name,
        description: payment.paymentLink.description,
        transactionId: payment.id,
        mpesaReceiptNumber,
        paidAt,
      });
      jobs.push(
        sendEmail({
          to: payment.payerEmail,
          subject: `Payment Receipt - KES ${formatKES(amount)}`,
          html,
          text,
        }).catch((err) => console.error('[callback] receipt email failed:', err.message))
      );
    }

    if (merchant.phone) {
      jobs.push(
        sendSMS({
          to: merchant.phone,
          message: buildSMS('paymentReceived', { amount, phone: payerPhone }),
        }).catch((err) => console.error('[callback] merchant SMS failed:', err.message))
      );
    }

    jobs.push(
      notificationService
        .createNotification({
          type: 'payment_received',
          title: 'Payment Received',
          message: `KES ${formatKES(amount)} received from ${toLocalFormat(payerPhone)}`,
          data: { paymentId: payment.id, amount, phone: payerPhone, mpesaReceiptNumber },
          userId: merchant.id,
        })
        .catch((err) => console.error('[callback] notification failed:', err.message))
    );

    await Promise.all(jobs);
    return { ok: true, status: 'completed' };
  }

  // ---- Failed / cancelled ----
  const reason = cb.ResultDesc || 'Payment was not completed';
  const claim = await prisma.payment.updateMany({
    where: { id: payment.id, status: 'pending' },
    data: { status: 'failed', failureReason: reason },
  });
  if (claim.count === 0) return { ok: true, duplicate: true };

  emitToPayer(payment.id, { status: 'failed', reason });

  await notificationService
    .createNotification({
      type: 'payment_failed',
      title: 'Payment Failed',
      message: `Payment of KES ${formatKES(payment.amount)} from ${toLocalFormat(payment.phone)} failed: ${reason}`,
      data: { paymentId: payment.id, reason },
      userId: merchant.id,
    })
    .catch((err) => console.error('[callback] notification failed:', err.message));

  return { ok: true, status: 'failed' };
}

module.exports = { handleStkCallback, payerStatusPayload };
