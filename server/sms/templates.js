const { formatKES } = require('../lib/format');
const { toLocalFormat } = require('../lib/phone');

const templates = {
  // "PayLink: Payment of KES 2,500 received from 0712345678."
  paymentReceived: ({ amount, phone }) =>
    `PayLink: Payment of KES ${formatKES(amount)} received from ${toLocalFormat(String(phone))}.`,

  paymentFailed: ({ amount, phone }) =>
    `PayLink: Payment of KES ${formatKES(amount)} from ${toLocalFormat(String(phone))} was not completed.`,
};

function buildSMS(name, params) {
  const fn = templates[name];
  if (!fn) throw new Error(`Unknown SMS template: ${name}`);
  return fn(params);
}

module.exports = { buildSMS };
