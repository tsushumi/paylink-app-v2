/**
 * Normalise a Kenyan mobile number to Daraja format (254XXXXXXXXX).
 * Accepts 0712345678, 712345678, +254712345678, 254712345678, with spaces/dashes.
 * Returns null when the number is not a valid Kenyan mobile (07xx / 01xx).
 */
function formatKenyanPhone(input) {
  if (input === undefined || input === null) return null;
  let p = String(input).replace(/[\s\-()]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (/^0[17]\d{8}$/.test(p)) p = `254${p.slice(1)}`;
  else if (/^[17]\d{8}$/.test(p)) p = `254${p}`;
  return /^254[17]\d{8}$/.test(p) ? p : null;
}

// 254712345678 -> 0712345678
const toLocalFormat = (p) => (p && p.startsWith('254') ? `0${p.slice(3)}` : p);

// 254712345678 -> +254712345678
const toE164 = (p) => (p ? `+${String(p).replace(/^\+/, '')}` : p);

module.exports = { formatKenyanPhone, toLocalFormat, toE164 };
