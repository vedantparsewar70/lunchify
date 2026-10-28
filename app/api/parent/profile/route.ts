import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { updateOwnPhone } from '@/lib/profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Updates the signed-in parent's mobile number (used for payment checkout). */
export async function PATCH(req: Request) {
  try {
    const user = await getCurrentUser();
    const { phone } = await req.json().catch(() => ({}));
    const result = await updateOwnPhone(user, phone);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, phone: result.phone });
  } catch (error) {
    console.error('Error updating parent phone:', error);
    return NextResponse.json({ error: 'Failed to update phone number' }, { status: 500 });
  }
}
