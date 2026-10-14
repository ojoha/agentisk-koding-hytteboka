// Who someone is: a PIN they chose, kept only as a hash, and cookies the server has signed,
// so a cookie someone wrote themselves is not believed.

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** A PIN is 4 to 6 digits. */
export function isPin(text) {
  return /^\d{4,6}$/.test(String(text ?? ''));
}

/** The PIN as it is stored: `scrypt$salt$hash`, with a salt of its own. */
export function hashPin(pin) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64url')}$${scryptSync(pin, salt, 32).toString('base64url')}`;
}

export function checkPin(pin, stored) {
  const [kind, salt, hash] = String(stored ?? '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  return timingSafeEqual(scryptSync(String(pin ?? ''), Buffer.from(salt, 'base64url'), expected.length), expected);
}

/** `value.signature`, where only someone who knows the secret can make the signature. */
export function sign(secret, value) {
  return `${value}.${signature(secret, value)}`;
}

/** The value a signed text was made from, or null when the signature does not fit. */
export function unsign(secret, signed) {
  const text = String(signed ?? '');
  const at = text.lastIndexOf('.');
  if (at < 0) return null;
  const value = text.slice(0, at);
  return same(text.slice(at + 1), signature(secret, value)) ? value : null;
}

/** Compares two texts in the same time whatever they hold, so the time does not tell how much was right. */
export function same(a, b) {
  const digest = (text) => createHmac('sha256', 'same').update(String(text)).digest();
  return timingSafeEqual(digest(a), digest(b));
}

function signature(secret, value) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}
