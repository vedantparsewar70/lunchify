/**
 * Indian mobile numbers: 10 digits starting with 6-9, optionally written with a +91/91/0
 * prefix, spaces, dashes or brackets. Returns the 10-digit form, or null if invalid.
 * Used on both client and server; never substitutes a placeholder number.
 */
export function normalizeIndianMobile(input: unknown): string | null {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  const raw = String(input).trim();
  if (!/^[+\d\s()-]+$/.test(raw)) return null;

  let digits = raw.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);

  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

export const INVALID_PHONE_MESSAGE = 'Please enter a valid 10-digit Indian mobile number (starting with 6, 7, 8 or 9).';

export const TEACHER_PHONE_REQUIRED_MESSAGE =
  'Please enter your 10-digit mobile number. The payment gateway requires it to process your payment.';

export type CheckoutPhoneResult =
  | { ok: true; phone: string }
  | { ok: false; code: 'PHONE_INVALID' | 'PHONE_REQUIRED'; error: string };

/**
 * Teacher checkout phone: the number typed at checkout if any (must be valid), otherwise the
 * number saved on the account. Never substitutes a placeholder, and never saves anything.
 */
export function resolveCheckoutPhone(typed: unknown, saved: unknown): CheckoutPhoneResult {
  const typedText = typeof typed === 'string' ? typed.trim() : typed == null ? '' : String(typed).trim();
  if (typedText) {
    const phone = normalizeIndianMobile(typedText);
    return phone ? { ok: true, phone } : { ok: false, code: 'PHONE_INVALID', error: INVALID_PHONE_MESSAGE };
  }
  const savedPhone = normalizeIndianMobile(saved);
  return savedPhone
    ? { ok: true, phone: savedPhone }
    : { ok: false, code: 'PHONE_REQUIRED', error: TEACHER_PHONE_REQUIRED_MESSAGE };
}
