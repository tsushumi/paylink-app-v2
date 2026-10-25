const TZ = process.env.APP_TIMEZONE || 'Africa/Nairobi';

// Deterministic thousands separator: 2500 -> "2,500"
const formatKES = (n) => Number(n || 0).toLocaleString('en-US');

const escapeHtml = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// YYYY-MM-DD for an instant, in the app time zone (not UTC).
const dayKey = (date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

const weekdayLabel = (date) =>
  new Intl.DateTimeFormat('en-KE', { timeZone: TZ, weekday: 'short' }).format(date);

const formatDateTime = (date) =>
  new Intl.DateTimeFormat('en-KE', {
    timeZone: TZ,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);

module.exports = { TZ, formatKES, escapeHtml, dayKey, weekdayLabel, formatDateTime };
