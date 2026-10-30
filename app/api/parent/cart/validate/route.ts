import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { validateCartAvailability } from '@/lib/availability';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req);
    if (!user || user.role !== 'PARENT') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { cartItems } = body;

    if (!cartItems || !Array.isArray(cartItems)) {
      return NextResponse.json({ error: 'cartItems array is required' }, { status: 400 });
    }

    const validation = await validateCartAvailability(cartItems);

    return NextResponse.json({
      valid: validation.valid,
      items: validation.items,
      firstUnavailableItem: validation.firstUnavailableItem,
      errorMessage: validation.errorMessage,
    });
  } catch (error) {
    console.error('Error validating cart availability:', error);
    return NextResponse.json({ error: 'Failed to validate cart availability' }, { status: 500 });
  }
}
