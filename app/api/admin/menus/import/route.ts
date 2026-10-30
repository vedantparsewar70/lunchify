import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { applyMonthlyMenu, parseMonthlyMenu } from '@/lib/monthly-menu';
import { MAX_XLSX_BYTES, readFirstSheet, XlsxError } from '@/lib/xlsx-reader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Monthly student menu import (staff/admin).
 * multipart/form-data: file (.xlsx), action ("preview" | "publish"), options (JSON: dishes, replaceUnordered).
 * The server always re-reads the uploaded file; a preview is never trusted as input to publish.
 */
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req);
    if (!user || (user.role !== 'ADMIN' && user.role !== 'STAFF')) {
      return NextResponse.json({ error: 'Unauthorized: Admin or Staff access required' }, { status: 403 });
    }

    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!form || !file || typeof file === 'string') {
      return NextResponse.json({ error: 'Please choose the menu spreadsheet (.xlsx) to upload.' }, { status: 400 });
    }
    if (file.size > MAX_XLSX_BYTES) {
      return NextResponse.json({ error: 'The spreadsheet is larger than 2 MB.' }, { status: 400 });
    }
    const action = form.get('action') === 'publish' ? 'publish' : 'preview';
    let options: any = {};
    try {
      options = JSON.parse(String(form.get('options') || '{}'));
    } catch {
      return NextResponse.json({ error: 'Invalid import options' }, { status: 400 });
    }

    let plan;
    try {
      plan = parseMonthlyMenu(readFirstSheet(Buffer.from(await file.arrayBuffer())));
    } catch (err) {
      if (err instanceof XlsxError) return NextResponse.json({ error: err.message }, { status: 400 });
      throw err;
    }

    const result = await applyMonthlyMenu(plan, {
      dishes: options && typeof options.dishes === 'object' ? options.dishes : {},
      replaceUnordered: options?.replaceUnordered === true,
      actorId: user.id,
      fileName: file.name?.slice(0, 120),
      dryRun: action === 'preview',
    });

    if (result.written) {
      try {
        const { notifyMenuUpdated } = await import('@/lib/sync-events');
        await notifyMenuUpdated();
      } catch {
        // non-blocking
      }
    }

    const status = action === 'publish' && !result.ok ? 422 : 200;
    return NextResponse.json({ action, ...result }, { status });
  } catch (error) {
    console.error('Error importing monthly menu:', error);
    return NextResponse.json({ error: 'Could not process the menu file. Please try again.' }, { status: 500 });
  }
}
