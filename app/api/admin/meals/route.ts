import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

function isValidMealPrice(price: unknown): boolean {
  const value = Number(price);
  return price !== null && price !== '' && Number.isFinite(value) && value > 0 && value <= 10000;
}

export async function GET(req: Request) {
  try {
    const meals = await prisma.meal.findMany({
      include: {
        mealAllergens: {
          include: { allergen: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    const filtered = meals
      .filter((m) => m.id !== 'meal_holiday_no_brunch' && !m.name.toLowerCase().includes('holiday'))
      .map((m) => {
        const allergensList = m.mealAllergens.map((ma) => ma.allergen.name);
        if (m.allergens && allergensList.length === 0) {
          m.allergens.split(/[,;]/).forEach((p) => {
            const t = p.trim();
            if (t && !allergensList.includes(t)) allergensList.push(t);
          });
        }

        return {
          ...m,
          allergensList,
          allergens: allergensList.join(', ') || m.allergens || null,
          imageUrl: null, // Ensure no photos
        };
      });

    return NextResponse.json({ meals: filtered });
  } catch (error) {
    console.error('Error fetching meals:', error);
    return NextResponse.json({ error: 'Failed to fetch meals' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req);
    if (!user || (user.role !== 'ADMIN' && user.role !== 'STAFF')) {
      return NextResponse.json({ error: 'Unauthorized: Admin or Staff access required' }, { status: 403 });
    }

    const body = await req.json();
    const {
      name,
      description,
      category = 'LUNCH',
      isVegetarian = true,
      ingredients,
      allergens,
      allergensList,
      calories,
      price,
    } = body;

    if (!name || price === undefined || Number(price) <= 0) {
      return NextResponse.json(
        { error: 'Name and a valid price (> 0) are required' },
        { status: 400 }
      );
    }

    const finalDesc = description?.trim() || `${name.trim()} - Freshly prepared at school canteen`;

    // Build unified allergens array
    let finalAllergens: string[] = [];
    if (Array.isArray(allergensList)) {
      finalAllergens = [...allergensList];
    } else if (typeof allergens === 'string' && allergens.trim()) {
      finalAllergens = allergens.split(/[,;]/).map((a: string) => a.trim()).filter(Boolean);
    }

    const meal = await prisma.meal.create({
      data: {
        name: name.trim(),
        description: finalDesc,
        category: category.toUpperCase().trim(),
        isVegetarian: Boolean(isVegetarian),
        ingredients: ingredients?.trim() || null,
        allergens: finalAllergens.join(', ') || null,
        calories: calories ? Number(calories) : null,
        price: Number(price),
        imageUrl: null,
      },
    });

    // Create relational allergens
    for (const alg of finalAllergens) {
      if (!alg || alg.toLowerCase() === 'none') continue;
      const allergenRecord = await prisma.allergen.upsert({
        where: { name: alg },
        update: {},
        create: { name: alg },
      });

      await prisma.mealAllergen.upsert({
        where: {
          mealId_allergenId: {
            mealId: meal.id,
            allergenId: allergenRecord.id,
          },
        },
        update: {},
        create: {
          mealId: meal.id,
          allergenId: allergenRecord.id,
        },
      });
    }

    try {
      const { notifyMenuUpdated } = await import('@/lib/sync-events');
      await notifyMenuUpdated();
    } catch {
      // non-blocking
    }

    return NextResponse.json({ success: true, meal }, { status: 201 });
  } catch (error) {
    console.error('Error creating meal:', error);
    return NextResponse.json({ error: 'Failed to create meal' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const user = await getCurrentUser(req);
    if (!user || (user.role !== 'ADMIN' && user.role !== 'STAFF')) {
      return NextResponse.json({ error: 'Unauthorized: Admin or Staff access required' }, { status: 403 });
    }

    const body = await req.json();
    const {
      id,
      name,
      description,
      category,
      isVegetarian,
      ingredients,
      allergens,
      allergensList,
      calories,
      price,
    } = body;

    if (!id) {
      return NextResponse.json({ error: 'Meal ID is required' }, { status: 400 });
    }

    if (price !== undefined && !isValidMealPrice(price)) {
      return NextResponse.json({ error: 'Price must be a number greater than 0' }, { status: 400 });
    }
    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      return NextResponse.json({ error: 'Meal name cannot be empty' }, { status: 400 });
    }

    // Allergens are only replaced when the request explicitly carries them. A partial edit
    // (e.g. price only) must never erase allergy information parents and the kitchen rely on.
    const allergensSupplied = Array.isArray(allergensList) || typeof allergens === 'string';
    let finalAllergens: string[] = [];
    if (Array.isArray(allergensList)) {
      finalAllergens = allergensList.map((a: unknown) => String(a).trim()).filter(Boolean);
    } else if (typeof allergens === 'string') {
      finalAllergens = allergens.split(/[,;]/).map((a: string) => a.trim()).filter(Boolean);
    }

    const existing = await prisma.meal.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Meal not found' }, { status: 404 });
    }

    const updated = await prisma.meal.update({
      where: { id },
      data: {
        name: name !== undefined ? name.trim() : undefined,
        description: description !== undefined ? description.trim() : undefined,
        category: category !== undefined ? category.toUpperCase().trim() : undefined,
        isVegetarian: isVegetarian !== undefined ? Boolean(isVegetarian) : undefined,
        ingredients: ingredients !== undefined ? ingredients?.trim() || null : undefined,
        allergens: allergensSupplied ? finalAllergens.join(', ') || null : undefined,
        calories: calories !== undefined ? (calories ? Number(calories) : null) : undefined,
        price: price !== undefined ? Number(price) : undefined,
      },
    });

    // Reset and sync meal_allergens relation, only for an explicit allergen update
    if (allergensSupplied) await prisma.mealAllergen.deleteMany({ where: { mealId: id } });
    for (const alg of allergensSupplied ? finalAllergens : []) {
      if (!alg || alg.toLowerCase() === 'none') continue;
      const allergenRecord = await prisma.allergen.upsert({
        where: { name: alg },
        update: {},
        create: { name: alg },
      });

      await prisma.mealAllergen.create({
        data: {
          mealId: id,
          allergenId: allergenRecord.id,
        },
      });
    }

    try {
      const { notifyMenuUpdated } = await import('@/lib/sync-events');
      await notifyMenuUpdated();
    } catch {
      // non-blocking
    }

    return NextResponse.json({ success: true, meal: updated });
  } catch (error) {
    console.error('Error updating meal:', error);
    return NextResponse.json({ error: 'Failed to update meal' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await getCurrentUser(req);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Meal ID is required' }, { status: 400 });
    }

    // Check if meal is in active orders
    const count = await prisma.orderItem.count({ where: { mealId: id } });
    if (count > 0) {
      return NextResponse.json(
        { error: 'Cannot delete meal because it has existing orders in the system. You can remove it from future daily menus instead.' },
        { status: 400 }
      );
    }

    await prisma.meal.delete({ where: { id } });

    try {
      const { notifyMenuUpdated } = await import('@/lib/sync-events');
      await notifyMenuUpdated();
    } catch {
      // non-blocking
    }

    return NextResponse.json({ success: true, message: 'Meal deleted successfully' });
  } catch (error) {
    console.error('Error deleting meal:', error);
    return NextResponse.json({ error: 'Failed to delete meal' }, { status: 500 });
  }
}
