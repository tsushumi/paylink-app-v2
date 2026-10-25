const express = require('express');
const prisma = require('../lib/prisma');
const { requireUser } = require('../middleware/auth');
const { formatKenyanPhone, toLocalFormat } = require('../lib/phone');
const { initiateSTKPush, isMock } = require('../services/mpesaService');
const { handleStkCallback, payerStatusPayload } = require('../services/paymentProcessor');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Payer: start a payment (STK Push)
router.post('/payments/initiate', async (req, res) => {
  const { paymentLinkId } = req.body;
  const email = String(req.body.email || '').trim().toLowerCase();
  const payerName = String(req.body.payerName || '').trim() || null;

  const phone = formatKenyanPhone(req.body.phone);
  if (!phone) return res.status(400).json({ success: false, error: 'Enter a valid Kenyan phone number (e.g. 0712345678)' });
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ success: false, error: 'Enter a valid email address' });

  const link = await prisma.paymentLink.findUnique({ where: { id: String(paymentLinkId || '') } });
  if (!link || !link.active) return res.status(404).json({ success: false, error: 'Payment link not found' });

  // Amount always comes from the link, never from the client.
  const payment = await prisma.payment.create({
    data: {
      paymentLinkId: link.id,
      phone,
      payerEmail: email || null,
      payerName,
      amount: link.amount,
    },
  });

  try {
    const stk = await initiateSTKPush({
      phone,
      amount: link.amount,
      reference: `PL${payment.id.slice(-8)}`,
      description: link.description,
    });
    await prisma.payment.update({
      where: { id: payment.id },
      data: { checkoutRequestId: stk.checkoutRequestId, merchantRequestId: stk.merchantRequestId },
    });

    // Mock mode: pretend the customer entered their PIN a few seconds later.
    if (stk.mock && process.env.MPESA_MOCK_AUTO_CALLBACK !== 'false') {
      const delay = Number(process.env.MPESA_MOCK_CALLBACK_DELAY_MS || 5000);
      setTimeout(() => {
        handleStkCallback(mockCallbackBody(stk.checkoutRequestId, link.amount, phone)).catch((e) =>
          console.error('[mpesa:mock] auto callback failed:', e)
        );
      }, delay);
    }

    res.json({
      success: true,
      paymentId: payment.id,
      checkoutRequestId: stk.checkoutRequestId,
      mock: stk.mock,
    });
  } catch (err) {
    console.error('[payments] STK Push failed:', err.message);
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'failed', failureReason: 'Could not send the M-Pesa request' },
    });
    res.status(502).json({ success: false, error: 'Could not send the M-Pesa request. Please try again.' });
  }
});

// Payer: poll / catch-up for a payment's current status
router.get('/payments/:id/status', async (req, res) => {
  const payment = await prisma.payment.findUnique({ where: { id: req.params.id } });
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  res.json(payerStatusPayload(payment));
});

// Merchant: recent payments
router.get('/payments', requireUser, async (req, res) => {
  const payments = await prisma.payment.findMany({
    where: { paymentLink: { userId: req.user.id } },
    orderBy: { createdAt: 'desc' },
    take: 10,
    include: { paymentLink: { select: { description: true } } },
  });
  res.json(
    payments.map((p) => ({
      id: p.id,
      description: p.paymentLink.description,
      amount: p.amount,
      phone: toLocalFormat(p.phone),
      status: p.status,
      mpesaReceiptNumber: p.mpesaReceiptNumber,
      createdAt: p.createdAt,
      paidAt: p.paidAt,
    }))
  );
});

// Safaricom -> us. Always answer 200 quickly; Safaricom retries on anything else.
router.post('/mpesa/callback', (req, res) => {
  const expected = process.env.MPESA_CALLBACK_TOKEN;
  if (expected && req.query.token !== expected) {
    console.warn('[callback] rejected: bad token');
    return res.status(403).json({ ResultCode: 1, ResultDesc: 'Forbidden' });
  }

  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  handleStkCallback(req.body).catch((err) => console.error('[callback] processing error:', err));
});

function mockCallbackBody(checkoutRequestId, amount, phone, { success = true, resultCode = 1032 } = {}) {
  if (!success) {
    return {
      Body: {
        stkCallback: {
          MerchantRequestID: `mock_${checkoutRequestId}`,
          CheckoutRequestID: checkoutRequestId,
          ResultCode: resultCode,
          ResultDesc: 'Request cancelled by user',
        },
      },
    };
  }
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: `mock_${checkoutRequestId}`,
        CheckoutRequestID: checkoutRequestId,
        ResultCode: 0,
        ResultDesc: 'The service request is processed successfully.',
        CallbackMetadata: {
          Item: [
            { Name: 'Amount', Value: amount },
            { Name: 'MpesaReceiptNumber', Value: `MOCK${Math.random().toString(36).slice(2, 9).toUpperCase()}` },
            { Name: 'TransactionDate', Value: Number(new Date().toISOString().replace(/\D/g, '').slice(0, 14)) },
            { Name: 'PhoneNumber', Value: Number(phone) },
          ],
        },
      },
    },
  };
}

module.exports = router;
module.exports.mockCallbackBody = mockCallbackBody;
module.exports.isMock = isMock;
