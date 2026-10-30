import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getTodayString, APP_TIMEZONE, isDeadlinePassed } from '@/lib/utils';
import { evaluateAllergyConflict, getSystemSetting } from '@/lib/allergy';
import { getCurrentUser } from '@/lib/auth';
import { getStudentCategory } from '@/lib/october-2026-timetable';

export function clearMenuCache() {
  // Authoritative database querying is always real-time
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const childId = searchParams.get('childId');
    const categoryParam = searchParams.get('category') || searchParams.get('studentCategory');
    const includeHolidays = searchParams.get('includeHolidays') !== 'false';

    let whereClause: any = {};
    if (!includeHolidays) {
      whereClause.isActive = true;
    }

    const todayStr = getTodayString(APP_TIMEZONE);

    if (date) {
      whereClause.date = date;
    } else if (startDate && endDate) {
      whereClause.date = {
        gte: startDate,
        lte: endDate,
      };
    } else {
      whereClause.date = todayStr;
    }

    const allowAllergyOrdersSettingPromise = getSystemSetting('ALLOW_ALLERGY_ORDERS', 'true');

    // Optimize: Fetch child allergies and student category
    let studentAllergiesList: string[] = [];
    let studentName = '';
    let derivedStudentCategory: string | null = null;
    if (childId) {
      const student = await prisma.student.findUnique({
        where: { id: childId },
        include: {
          studentAllergies: { include: { allergy: true } },
        },
      });
      // A child's name and allergies are private: only that child's parent (or staff) may see them.
      const viewer = await getCurrentUser(req);
      const mayView =
        viewer && (viewer.role === 'STAFF' || viewer.role === 'ADMIN' || (student && viewer.parentId === student.parentId));
      if (student && !mayView) {
        return NextResponse.json({ error: 'Child not found' }, { status: 404 });
      }
      if (student) {
        studentName = student.name;
        derivedStudentCategory = getStudentCategory(student.grade, (student as any).studentCategory);
        if (student.studentAllergies && student.studentAllergies.length > 0) {
          student.studentAllergies.forEach((sa: any) => {
            if (sa.allergy?.name) studentAllergiesList.push(sa.allergy.name);
            if (sa.customNote) studentAllergiesList.push(sa.customNote);
          });
        }
        if (student.allergies) {
          student.allergies.split(/[,;]/).forEach((part: string) => {
            const clean = part.trim();
            if (clean && !studentAllergiesList.includes(clean)) {
              studentAllergiesList.push(clean);
            }
          });
        }
      }
    }

    const filterCategory = categoryParam || derivedStudentCategory;
    if (filterCategory) {
      whereClause.studentCategory = {
        in: [filterCategory, 'ALL'],
      };
    }

    // Authoritative real-time query
    const menus = await prisma.menu.findMany({
      where: whereClause,
      include: {
        meal: {
          include: {
            mealAllergens: {
              include: { allergen: true },
            },
          },
        },
      },
      orderBy: [
        { date: 'asc' },
        { meal: { category: 'asc' } },
        { meal: { name: 'asc' } },
      ],
    });

    const allowAllergyOrdersSetting = await allowAllergyOrdersSettingPromise;
    const allowAllergyOrders = allowAllergyOrdersSetting === 'true';

    const evaluatedMenus = menus.map((item) => {
      const isHoliday = Boolean((item as any).isHoliday);
      const isPastDate = item.date < todayStr;
      const deadlinePassed = isPastDate || isDeadlinePassed(item.date, item.orderingDeadline || '08:30');
      const isAvailable = Boolean(item.isActive) && !isHoliday && !isPastDate && (item.availableQuantity > 0) && !deadlinePassed;

      if (isHoliday) {
        return {
          ...item,
          studentCategory: (item as any).studentCategory || 'ALL',
          isHoliday: true,
          holidayReason: (item as any).holidayReason || 'Holiday Today — No Brunch Scheduled',
          isPastDate,
          isAvailable: false,
          isDeadlinePassed: deadlinePassed,
          meal: null,
          allergyEvaluation: {
            hasConflict: false,
            matchingAllergens: [],
            childName: studentName || undefined,
            mealName: 'Holiday',
          },
        };
      }

      const mealObj = item.meal || {
        id: item.mealId,
        name: 'Scheduled Brunch',
        description: 'Freshly prepared wholesome school brunch.',
        category: 'LUNCH',
        price: 80,
        isVegetarian: true,
      };

      const allergensList = ((mealObj as any).mealAllergens || []).map((ma: any) => ma.allergen?.name).filter(Boolean);
      if ((mealObj as any).allergens && allergensList.length === 0) {
        (mealObj as any).allergens.split(/[,;]/).forEach((p: string) => {
          const t = p.trim();
          if (t && !allergensList.includes(t)) allergensList.push(t);
        });
      }

      let allergyEvaluation = {
        hasConflict: false,
        matchingAllergens: [] as string[],
        childName: studentName || undefined,
        mealName: mealObj.name,
      };

      if (childId && studentAllergiesList.length > 0) {
        const conflictRes = evaluateAllergyConflict(studentAllergiesList, allergensList, studentName, mealObj.name);
        allergyEvaluation = {
          hasConflict: conflictRes.hasConflict,
          matchingAllergens: conflictRes.matchingAllergens,
          childName: studentName || undefined,
          mealName: mealObj.name,
        };
      }

      return {
        ...item,
        studentCategory: (item as any).studentCategory || 'ALL',
        isHoliday: false,
        holidayReason: null,
        isPastDate,
        isAvailable,
        isDeadlinePassed: deadlinePassed,
        meal: {
          ...mealObj,
          allergensList,
          imageUrl: null, // No photo
        },
        allergyEvaluation,
      };
    });

    const headers: Record<string, string> = {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    };

    return NextResponse.json(
      {
        menus: evaluatedMenus,
        policy: {
          allowAllergyOrders,
        },
      },
      { headers }
    );
  } catch (error) {
    console.error('Error fetching menus:', error);
    return NextResponse.json({ error: 'Failed to fetch menu items' }, { status: 500 });
  }
}
