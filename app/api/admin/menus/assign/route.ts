import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { publishDish } from '@/lib/menu-publish';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Puts an existing Master Recipe Catalog recipe on the menu for one date (staff/admin) and
 * publishes it so parents can order it. Rules: see lib/menu-publish.ts.
 *
 * Body: { date: 'YYYY-MM-DD', studentCategory: 'Pre-primary' | 'Primary' | 'Secondary' | 'ALL', mealId, replace? }
 */
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req);
    if (!user || (user.role !== 'ADMIN' && user.role !== 'STAFF')) {
      return NextResponse.json({ error: 'Unauthorized: Admin or Staff access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const { date, studentCategory, mealId, replace } = body || {};
    const result = await publishDish({ date, studentCategory, mealId, replace, actorId: user.id });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error('Error assigning menu recipe:', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ error: 'The menu could not be saved. Please try again.' }, { status: 500 });
  }
}
