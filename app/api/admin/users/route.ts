import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser(req);
    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized: Admin access required' }, { status: 403 });
    }

    const [parents, allStudents] = await Promise.all([
      prisma.parent.findMany({
        include: {
          user: true,
          students: {
            orderBy: { name: 'asc' },
          },
          orders: {
            select: { id: true, totalAmount: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.student.findMany({
        include: {
          parent: {
            include: { user: true },
          },
          studentAllergies: {
            include: { allergy: true },
          },
          orderItems: {
            where: {
              hasAllergyAlert: true,
              order: {
                orderStatus: { in: ['CONFIRMED', 'PREPARING', 'READY'] },
              },
            },
            select: {
              id: true,
              hasAllergyAlert: true,
              conflictAllergens: true,
            },
          },
        },
        orderBy: [
          { grade: 'asc' },
          { division: 'asc' },
          { rollNo: 'asc' },
        ],
      }),
    ]);

    const formattedStudents = allStudents.map((s) => {
      const allergiesList = s.studentAllergies.map((sa) => sa.allergy.name);
      if (s.allergies && allergiesList.length === 0) {
        s.allergies.split(/[,;]/).forEach((p) => {
          const t = p.trim();
          if (t && !allergiesList.includes(t)) allergiesList.push(t);
        });
      }

      const hasConflict = s.orderItems && s.orderItems.length > 0;
      const hasAllergies = allergiesList.length > 0 && !allergiesList.includes('None');

      let allergyAlertState: 'NO_ALLERGY' | 'ALLERGY_RECORDED' | 'CONFLICT_DETECTED' = 'NO_ALLERGY';
      if (hasConflict) {
        allergyAlertState = 'CONFLICT_DETECTED';
      } else if (hasAllergies) {
        allergyAlertState = 'ALLERGY_RECORDED';
      }

      return {
        id: s.id,
        name: s.name,
        grade: s.grade,
        division: s.division,
        rollNo: s.rollNo,
        studentId: s.studentId,
        dietaryType: s.foodPreference || (s.isVegetarian ? 'Vegetarian' : 'Non-Vegetarian'),
        isVegetarian: s.isVegetarian,
        allergies: allergiesList.join(', ') || s.allergies || null,
        allergiesList,
        dietaryRestrictions: s.dietaryRestrictions || null,
        notes: s.notes || null,
        isActive: s.isActive,
        allergyAlertState,
        conflictOrdersCount: s.orderItems.length,
        parentName: s.parent?.user?.name || 'N/A',
        parentEmail: s.parent?.user?.email || 'N/A',
        parentPhone: s.parent?.user?.phone || 'N/A',
      };
    });

    const formattedParents = parents.map((p) => ({
      id: p.id,
      userId: p.userId,
      name: p.user.name,
      email: p.user.email,
      phone: p.user.phone,
      childrenCount: p.students.length,
      ordersCount: p.orders.length,
      totalSpent: p.orders.reduce((sum, o) => sum + o.totalAmount, 0),
      createdAt: p.createdAt.toISOString(),
      students: p.students.map((s) => ({
        id: s.id,
        name: s.name,
        grade: s.grade,
        division: s.division,
        rollNo: s.rollNo,
        studentId: s.studentId,
        allergies: s.allergies,
        isVegetarian: s.isVegetarian,
        isActive: s.isActive,
      })),
    }));

    return NextResponse.json({
      parents: formattedParents,
      students: formattedStudents,
    });
  } catch (error) {
    console.error('Error fetching admin users:', error);
    return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
  }
}
