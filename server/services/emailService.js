const { Resend } = require('resend');
const outbox = require('../lib/outbox');

const FROM = process.env.EMAIL_FROM || 'PayLink <onboarding@resend.dev>';
const client = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

if (!client) {
  console.warn('[email] RESEND_API_KEY not set - emails will be logged, not sent (mock mode)');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function attemptSend({ to, subject, html, text }) {
  if (!client) {
    console.log(`[email:mock] to=${to} subject="${subject}"`);
    outbox.addEmail({ to, subject, html, text });
    return { id: `mock_${Date.now()}`, mock: true };
  }
  // Resend resolves with { data, error } instead of throwing on API errors.
  const { data, error } = await client.emails.send({ from: FROM, to, subject, html, text });
  if (error) throw new Error(error.message || 'Resend error');
  return { id: data.id, mock: false };
}

/**
 * Send an email. Retries once after 1s on failure, then throws.
 * Callers on the payment path must not await this (or must catch) so a mail outage
 * never blocks the payment flow.
 */
async function sendEmail(message, { retries = 1, delayMs = 1000 } = {}) {
  if (!message?.to) throw new Error('sendEmail: "to" is required');
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await attemptSend(message);
      if (!result.mock) console.log(`[email] sent to ${message.to} (id ${result.id})`);
      return result;
    } catch (err) {
      lastError = err;
      console.error(`[email] attempt ${attempt + 1} failed: ${err.message}`);
      if (attempt < retries) await sleep(delayMs);
    }
  }
  throw lastError;
}

module.exports = { sendEmail };
