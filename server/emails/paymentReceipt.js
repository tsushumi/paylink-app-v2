const { escapeHtml, formatKES, formatDateTime } = require('../lib/format');

/**
 * Builds the payer's receipt email. Every user-supplied value is HTML-escaped
 * (payer name and link description come from untrusted input).
 */
function buildPaymentReceiptEmail({
  payerName,
  amount,
  merchantName,
  description,
  transactionId,
  mpesaReceiptNumber,
  paidAt,
}) {
  const when = formatDateTime(paidAt || new Date());
  const amountText = `KES ${formatKES(amount)}`;

  const rows = [
    ['Merchant', merchantName],
    ['For', description],
    ['M-Pesa receipt', mpesaReceiptNumber],
    ['Transaction ID', transactionId],
    ['Date', when],
  ].filter(([, v]) => v);

  const rowsHtml = rows
    .map(
      ([k, v]) => `
        <tr>
          <td style="padding:10px 0;color:#6b7280;font-size:14px;border-bottom:1px solid #e5e7eb;">${escapeHtml(k)}</td>
          <td style="padding:10px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid #e5e7eb;">${escapeHtml(v)}</td>
        </tr>`
    )
    .join('');

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;">
          <tr><td style="background:#16a34a;padding:20px 24px;color:#ffffff;font-size:20px;font-weight:700;">PayLink</td></tr>
          <tr><td style="padding:28px 24px 8px;">
            <p style="margin:0 0 4px;color:#374151;font-size:15px;">Hi ${escapeHtml(payerName || 'there')},</p>
            <p style="margin:0 0 20px;color:#374151;font-size:15px;">Thanks for your payment. Here is your receipt.</p>
            <p style="margin:0;color:#6b7280;font-size:13px;">Amount paid</p>
            <p style="margin:0 0 20px;color:#111827;font-size:32px;font-weight:700;">${escapeHtml(amountText)}</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowsHtml}</table>
          </td></tr>
          <tr><td style="padding:20px 24px 28px;color:#9ca3af;font-size:12px;">
            Keep this email as proof of payment. Questions? Contact ${escapeHtml(merchantName || 'the merchant')} directly.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  const text = [
    'PayLink - Payment Receipt',
    '',
    `Hi ${payerName || 'there'},`,
    `Amount paid: ${amountText}`,
    ...rows.map(([k, v]) => `${k}: ${v}`),
  ].join('\n');

  return { html, text };
}

module.exports = { buildPaymentReceiptEmail };
