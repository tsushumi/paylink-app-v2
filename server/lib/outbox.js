// In-memory record of emails/SMS that were "sent" in mock mode (dev + e2e testing only).
const MAX = 100;
const emails = [];
const sms = [];

const push = (list, item) => {
  list.unshift({ ...item, at: new Date().toISOString() });
  if (list.length > MAX) list.pop();
};

module.exports = {
  emails,
  sms,
  addEmail: (item) => push(emails, item),
  addSms: (item) => push(sms, item),
  clear() {
    emails.length = 0;
    sms.length = 0;
  },
};
