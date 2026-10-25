const axios = require('axios');
const { TZ } = require('../lib/format');

const env = () => process.env;

const isMock = () => {
  const e = env();
  if (e.MPESA_MOCK === 'true') return true;
  const missing = !(
    e.MPESA_CONSUMER_KEY &&
    e.MPESA_CONSUMER_SECRET &&
    e.MPESA_SHORTCODE &&
    e.MPESA_PASSKEY &&
    e.MPESA_CALLBACK_URL
  );
  return missing;
};

const baseUrl = () =>
  env().MPESA_ENV === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';

// ---- OAuth token with caching (Daraja tokens last 3600s) ----
let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) return cachedToken;
  const { MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET } = env();
  const res = await axios.get(`${baseUrl()}/oauth/v1/generate?grant_type=client_credentials`, {
    auth: { username: MPESA_CONSUMER_KEY, password: MPESA_CONSUMER_SECRET },
    timeout: 15000,
  });
  cachedToken = res.data.access_token;
  tokenExpiresAt = Date.now() + Number(res.data.expires_in || 3599) * 1000;
  return cachedToken;
}

// YYYYMMDDHHmmss in Nairobi time
function timestamp() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}${get('month')}${get('day')}${hour}${get('minute')}${get('second')}`;
}

/**
 * Initiate an STK Push. `phone` must already be 254XXXXXXXXX.
 * Returns { checkoutRequestId, merchantRequestId, mock }.
 */
async function initiateSTKPush({ phone, amount, reference, description }) {
  if (isMock()) {
    const id = `ws_CO_MOCK_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[mpesa:mock] STK Push to ${phone} for KES ${amount} -> ${id}`);
    return { checkoutRequestId: id, merchantRequestId: `mock_${id}`, mock: true };
  }

  const { MPESA_SHORTCODE, MPESA_PASSKEY, MPESA_CALLBACK_URL, MPESA_CALLBACK_TOKEN } = env();
  const ts = timestamp();
  const password = Buffer.from(`${MPESA_SHORTCODE}${MPESA_PASSKEY}${ts}`).toString('base64');
  const callbackUrl = MPESA_CALLBACK_TOKEN
    ? `${MPESA_CALLBACK_URL}${MPESA_CALLBACK_URL.includes('?') ? '&' : '?'}token=${encodeURIComponent(MPESA_CALLBACK_TOKEN)}`
    : MPESA_CALLBACK_URL;

  const token = await getAccessToken();
  try {
    const res = await axios.post(
      `${baseUrl()}/mpesa/stkpush/v1/processrequest`,
      {
        BusinessShortCode: MPESA_SHORTCODE,
        Password: password,
        Timestamp: ts,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(amount),
        PartyA: phone,
        PartyB: MPESA_SHORTCODE,
        PhoneNumber: phone,
        CallBackURL: callbackUrl,
        AccountReference: String(reference).slice(0, 12),
        TransactionDesc: String(description || 'PayLink payment').slice(0, 13),
      },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 }
    );
    if (String(res.data.ResponseCode) !== '0') {
      throw new Error(res.data.ResponseDescription || 'STK Push rejected');
    }
    return {
      checkoutRequestId: res.data.CheckoutRequestID,
      merchantRequestId: res.data.MerchantRequestID,
      mock: false,
    };
  } catch (err) {
    if (err.response?.status === 401) cachedToken = null; // force a fresh token next time
    const detail = err.response?.data?.errorMessage || err.message;
    throw new Error(detail);
  }
}

module.exports = { initiateSTKPush, isMock, getAccessToken };
