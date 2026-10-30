import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { getSystemSetting, setSystemSetting } from '@/lib/allergy';

export async function GET(req: Request) {
  try {
    const allowAllergyOrders = await getSystemSetting('ALLOW_ALLERGY_ORDERS', 'true');
    return NextResponse.json({
      settings: {
        ALLOW_ALLERGY_ORDERS: allowAllergyOrders === 'true',
      },
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 });
    }

    const body = await req.json();
    const { key, value } = body;

    if (!key || value === undefined) {
      return NextResponse.json({ error: 'Key and value are required' }, { status: 400 });
    }

    await setSystemSetting(key, String(value));
    return NextResponse.json({ success: true, key, value });
  } catch (error) {
    console.error('Error saving setting:', error);
    return NextResponse.json({ error: 'Failed to save setting' }, { status: 500 });
  }
}
