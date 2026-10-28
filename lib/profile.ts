import type { Firestore } from 'firebase-admin/firestore';
import { db } from './firebase-admin';
import { INVALID_PHONE_MESSAGE, normalizeIndianMobile } from './phone';

export type PhoneUpdateResult =
  | { ok: true; phone: string }
  | { ok: false; status: number; error: string };

/**
 * Updates the signed-in parent's own mobile number. The user ID always comes from the
 * session, never from the request, so a parent can only change their own record.
 */
export async function updateOwnPhone(
  user: { id: string; role: string } | null,
  rawPhone: unknown,
  firestore: Firestore = db
): Promise<PhoneUpdateResult> {
  if (!user) return { ok: false, status: 401, error: 'Unauthorized' };
  if (user.role !== 'PARENT') return { ok: false, status: 403, error: 'Only parent accounts can update this profile.' };

  const phone = normalizeIndianMobile(rawPhone);
  if (!phone) return { ok: false, status: 400, error: INVALID_PHONE_MESSAGE };

  const ref = firestore.collection('users').doc(user.id);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, status: 404, error: 'Account not found' };

  await ref.update({ phone, updatedAt: new Date().toISOString() });
  return { ok: true, phone };
}
