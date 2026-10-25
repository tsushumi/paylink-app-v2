/**
 * End-to-end check of PayLink v2 against a running server (mock M-Pesa / email / SMS mode).
 *   Terminal 1: MPESA_MOCK_AUTO_CALLBACK=false npm run dev      (or dev:shim)
 *   Terminal 2: npm run test:flow
 */
const { io } = require('socket.io-client');

const BASE = process.env.BASE_URL || 'http://localhost:3001';
let passed = 0;
let failed = 0;

const check = (name, cond, extra = '') => {
  if (cond) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, path, body, userId) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(userId ? { 'x-user-id': userId } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

const connect = () =>
  new Promise((resolve, reject) => {
    const s = io(BASE, { transports: ['websocket'] });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
const emitAck = (s, ev, ...args) => new Promise((r) => s.emit(ev, ...args, r));

async function main() {
  console.log(`Testing ${BASE}\n`);
  await api('DELETE', '/dev/outbox');
  const tag = Date.now();

  // ---- Setup ----
  console.log('Setup: merchant, link, sockets');
  const reg = await api('POST', '/auth/register', { name: 'Test Shop', email: `shop${tag}@test.dev`, phone: '0712345678' });
  check('register merchant', reg.status === 201);
  const merchant = reg.json.user;
  const dup = await api('POST', '/auth/register', { name: 'x', email: `shop${tag}@test.dev` });
  check('duplicate email rejected (409)', dup.status === 409);
  const other = (await api('POST', '/auth/register', { name: 'Other', email: `other${tag}@test.dev` })).json.user;

  const linkRes = await api('POST', '/payment-links', { description: 'Coffee <b>combo</b>', amount: 2500 }, merchant.id);
  check('create payment link', linkRes.status === 201);
  const link = linkRes.json;
  check('amount validation rejects 0', (await api('POST', '/payment-links', { description: 'x', amount: 0 }, merchant.id)).status === 400);
  check('payment-links requires auth', (await api('POST', '/payment-links', { description: 'x', amount: 5 })).status === 401);
  const pub = await api('GET', `/payment-links/${link.id}`);
  check('public link shows merchantName', pub.json.merchantName === 'Test Shop');

  const merchantTab1 = await connect();
  const merchantTab2 = await connect();
  const m1 = [];
  const m2 = [];
  merchantTab1.on('notification', (n) => m1.push(n));
  merchantTab2.on('notification', (n) => m2.push(n));
  check('merchant register ack (tab 1)', (await emitAck(merchantTab1, 'register-merchant', merchant.id)).ok === true);
  check('merchant register ack (tab 2)', (await emitAck(merchantTab2, 'register-merchant', merchant.id)).ok === true);
  check('unknown merchant id rejected', (await emitAck(await connect(), 'register-merchant', 'nope')).ok === false);
  const otherSock = await connect();
  const mOther = [];
  otherSock.on('notification', (n) => mOther.push(n));
  await emitAck(otherSock, 'register-merchant', other.id);

  // ---- Payment 1: two payers on the SAME link ----
  console.log('\nTwo payers on one link (success + cancel)');
  const payerA = await connect();
  const payerB = await connect();
  const statusA = [];
  const statusB = [];
  payerA.on('payment-status', (d) => statusA.push(d));
  payerB.on('payment-status', (d) => statusB.push(d));
  payerA.emit('watch-payment', link.id);
  payerB.emit('watch-payment', link.id);

  check('invalid phone rejected', (await api('POST', '/payments/initiate', { paymentLinkId: link.id, phone: '12345' })).status === 400);
  const initA = await api('POST', '/payments/initiate', { paymentLinkId: link.id, phone: '0712 345 678', email: `payer${tag}@test.dev`, payerName: 'Alice <script>' });
  const initB = await api('POST', '/payments/initiate', { paymentLinkId: link.id, phone: '+254799111222' });
  check('initiate A ok', initA.json?.success === true, JSON.stringify(initA.json));
  check('initiate B ok', initB.json?.success === true, JSON.stringify(initB.json));

  const ackA = await emitAck(payerA, 'watch-payment-attempt', initA.json.paymentId);
  const ackB = await emitAck(payerB, 'watch-payment-attempt', initB.json.paymentId);
  check('attempt ack reports pending', ackA.status === 'pending' && ackB.status === 'pending');

  const cbA = await api('POST', '/dev/simulate-callback', { paymentId: initA.json.paymentId });
  check('callback A processed', cbA.json?.status === 'completed', JSON.stringify(cbA.json));
  const cbB = await api('POST', '/dev/simulate-callback', { paymentId: initB.json.paymentId, success: false });
  check('callback B processed as failed', cbB.json?.status === 'failed', JSON.stringify(cbB.json));
  await sleep(300);

  check('payer A: saw processing then completed', statusA.map((s) => s.status).join(',') === 'processing,completed', statusA.map((s) => s.status).join(','));
  const doneA = statusA.find((s) => s.status === 'completed');
  check('payer A: receipt number + amount', !!doneA?.mpesaReceiptNumber && doneA.amount === 2500);
  check('payer B (same link): got ITS OWN failure only', statusB.map((s) => s.status).join(',') === 'processing,failed', statusB.map((s) => s.status).join(','));
  check('payer B failure has reason', !!statusB.find((s) => s.status === 'failed')?.reason);

  // ---- Email ----
  console.log('\nEmail receipt');
  const outbox = (await api('GET', '/dev/outbox')).json;
  check('exactly one email sent (only A gave an email)', outbox.emails.length === 1, `got ${outbox.emails.length}`);
  const mail = outbox.emails[0];
  check('email addressed to payer', mail?.to === `payer${tag}@test.dev`);
  check('subject has amount', mail?.subject === 'Payment Receipt - KES 2,500', mail?.subject);
  check('email includes receipt number + merchant', mail?.html.includes(doneA.mpesaReceiptNumber) && mail?.html.includes('Test Shop'));
  check('email HTML-escapes user input', mail?.html.includes('Coffee &lt;b&gt;combo&lt;/b&gt;') && !mail.html.includes('<script>'));

  // ---- SMS ----
  console.log('\nMerchant SMS');
  check('one SMS (success only)', outbox.sms.length === 1, `got ${outbox.sms.length}`);
  check('SMS text matches spec', outbox.sms[0]?.message === 'PayLink: Payment of KES 2,500 received from 0712345678.', outbox.sms[0]?.message);
  check('SMS sent to merchant in +254 format', outbox.sms[0]?.to === '+254712345678', outbox.sms[0]?.to);

  // ---- Notifications ----
  console.log('\nNotification bell');
  check('tab 1 got 2 live notifications (paid + failed)', m1.length === 2, `got ${m1.length}`);
  check('tab 2 also got them (multi-tab)', m2.length === 2, `got ${m2.length}`);
  check('other merchant got none (isolation)', mOther.length === 0);
  const types = m1.map((n) => n.type).sort().join(',');
  check('types are payment_failed + payment_received', types === 'payment_failed,payment_received', types);
  const list = await api('GET', '/notifications', null, merchant.id);
  check('GET /notifications unread = 2', list.json.unreadCount === 2 && list.json.notifications.length === 2);
  const first = list.json.notifications[0];
  check('mark one read', (await api('POST', `/notifications/${first.id}/read`, null, merchant.id)).status === 200);
  check('other merchant cannot mark it (404)', (await api('POST', `/notifications/${list.json.notifications[1].id}/read`, null, other.id)).status === 404);
  check('unread now 1', (await api('GET', '/notifications', null, merchant.id)).json.unreadCount === 1);
  check('read-all route not shadowed by :id', (await api('POST', '/notifications/read-all', null, merchant.id)).status === 200);
  check('unread now 0', (await api('GET', '/notifications', null, merchant.id)).json.unreadCount === 0);

  // ---- Idempotency ----
  console.log('\nDuplicate callback (Safaricom retry)');
  await api('DELETE', '/dev/outbox');
  const before = m1.length;
  const dupCb = await api('POST', '/dev/simulate-callback', { paymentId: initA.json.paymentId });
  await sleep(200);
  const outbox2 = (await api('GET', '/dev/outbox')).json;
  check('duplicate flagged', dupCb.json?.duplicate === true, JSON.stringify(dupCb.json));
  check('no second email / SMS / notification', outbox2.emails.length === 0 && outbox2.sms.length === 0 && m1.length === before);

  // ---- Reconnect catch-up ----
  console.log('\nReconnect catch-up');
  const lateSock = await connect();
  const late = await emitAck(lateSock, 'watch-payment-attempt', initA.json.paymentId);
  check('late joiner receives completed status in ack', late.status === 'completed' && !!late.mpesaReceiptNumber);
  const poll = await api('GET', `/payments/${initA.json.paymentId}/status`);
  check('HTTP status fallback agrees', poll.json.status === 'completed');

  // ---- Real callback endpoint (as Safaricom would hit it) ----
  console.log('\nPOST /api/mpesa/callback (real endpoint)');
  const initC = await api('POST', '/payments/initiate', { paymentLinkId: link.id, phone: '0722000111' });
  const payC = await connect();
  const statusC = [];
  payC.on('payment-status', (d) => statusC.push(d));
  await emitAck(payC, 'watch-payment-attempt', initC.json.paymentId);
  const raw = await api('POST', '/mpesa/callback', {
    Body: {
      stkCallback: {
        MerchantRequestID: 'x',
        CheckoutRequestID: initC.json.checkoutRequestId,
        ResultCode: 0,
        ResultDesc: 'ok',
        CallbackMetadata: { Item: [{ Name: 'Amount', Value: 2500 }, { Name: 'MpesaReceiptNumber', Value: 'QWE123RTY4' }, { Name: 'PhoneNumber', Value: 254722000111 }] },
      },
    },
  });
  check('endpoint answers ResultCode 0 immediately', raw.json?.ResultCode === 0);
  await sleep(300);
  check('payer C completed via real endpoint', statusC.some((s) => s.status === 'completed' && s.mpesaReceiptNumber === 'QWE123RTY4'));
  check('malformed callback does not crash', (await api('POST', '/mpesa/callback', { nope: 1 })).status === 200);

  // ---- Analytics ----
  console.log('\nAnalytics');
  const an = (await api('GET', '/analytics', null, merchant.id)).json;
  check('totalReceived = 5000 (2 completed)', an.totalReceived === 5000, String(an.totalReceived));
  check('totalPayments = 2', an.totalPayments === 2, String(an.totalPayments));
  check('chart has 7 days', an.chartData.length === 7);
  check('today bucket total = 5000', an.chartData[6].total === 5000, JSON.stringify(an.chartData[6]));
  check('analytics requires auth', (await api('GET', '/analytics')).status === 401);
  const otherAn = (await api('GET', '/analytics', null, other.id)).json;
  check('other merchant sees zero', otherAn.totalReceived === 0 && otherAn.totalPayments === 0);

  // ---- Listener hygiene ----
  console.log('\nDisconnect cleanup');
  payerA.disconnect();
  await sleep(100);
  const before2 = statusA.length;
  await api('POST', '/dev/simulate-callback', { paymentId: initA.json.paymentId });
  check('disconnected socket gets nothing further', statusA.length === before2);

  [merchantTab1, merchantTab2, payerB, otherSock, lateSock, payC].forEach((s) => s.disconnect());
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('E2E crashed:', e);
  process.exit(1);
});
