import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'PARENT' || !user.parentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const students = await prisma.student.findMany({
      where: {
        parentId: user.parentId,
        isActive: true,
      },
      include: {
        studentAllergies: {
          include: { allergy: true },
        },
        orderItems: {
          where: {
            hasAllergyAlert: true,
          },
          select: { id: true, hasAllergyAlert: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const formattedStudents = students.map((s) => {
      const allergiesList = s.studentAllergies.map((sa) => sa.allergy.name);
      if (s.allergies && allergiesList.length === 0) {
        s.allergies.split(/[,;]/).forEach((p) => {
          const t = p.trim();
          if (t && !allergiesList.includes(t)) allergiesList.push(t);
        });
      }

      let allergyAlertStatus: 'NO_ALLERGY' | 'ALLERGY_RECORDED' | 'CONFLICT_DETECTED' = 'NO_ALLERGY';
      if (s.orderItems && s.orderItems.length > 0) {
        allergyAlertStatus = 'CONFLICT_DETECTED';
      } else if (allergiesList.length > 0 && !allergiesList.includes('None')) {
        allergyAlertStatus = 'ALLERGY_RECORDED';
      }

      const resolvedGrade = s.grade || '';
      const category =
        (s as any).studentCategory ||
        (resolvedGrade.toLowerCase().includes('nursery') ||
        resolvedGrade.toLowerCase().includes('kg') ||
        resolvedGrade.toLowerCase().includes('pre')
          ? 'Pre-primary'
          : parseInt(resolvedGrade, 10) <= 5
          ? 'Primary'
          : 'Secondary');

      return {
        id: s.id,
        parentId: s.parentId,
        name: s.name,
        dob: s.dob,
        grade: s.grade,
        division: s.division,
        rollNo: s.rollNo,
        studentId: s.studentId,
        studentCategory: category,
        allergies: allergiesList.join(', ') || s.allergies || null,
        allergiesList,
        dietaryRestrictions: s.dietaryRestrictions || null,
        foodPreference: s.foodPreference || null,
        notes: s.notes || null,
        isVegetarian: s.isVegetarian,
        profilePhoto: null, // Photos completely removed
        isActive: s.isActive,
        allergyAlertStatus,
      };
    });

    return NextResponse.json({ students: formattedStudents });
  } catch (error) {
    console.error('Error fetching children:', error);
    return NextResponse.json({ error: 'Failed to fetch children' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'PARENT' || !user.parentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const data = await req.json();
    const {
      name,
      dob,
      grade,
      division,
      rollNo,
      studentId,
      allergies, // can be string or array
      allergiesList,
      otherAllergy,
      dietaryRestrictions,
      foodPreference,
      notes,
      isVegetarian,
    } = data;

    if (!name || !grade || !division || !rollNo) {
      return NextResponse.json(
        { error: 'Name, Class, Division, and Roll Number are required' },
        { status: 400 }
      );
    }

    const generatedStudentId = studentId?.trim() || `STU-2026-${Math.floor(100 + Math.random() * 900)}`;

    // Build unified allergies array
    let finalAllergies: string[] = [];
    if (Array.isArray(allergiesList)) {
      finalAllergies = [...allergiesList];
    } else if (typeof allergies === 'string' && allergies.trim()) {
      finalAllergies = allergies.split(/[,;]/).map((a: string) => a.trim()).filter(Boolean);
    }
    if (otherAllergy && otherAllergy.trim() && !finalAllergies.includes(otherAllergy.trim())) {
      finalAllergies.push(otherAllergy.trim());
    }

    const allergiesSummary = finalAllergies.join(', ');
    const resolvedGrade = String(grade).trim();
    const studentCategory =
      data.studentCategory ||
      (resolvedGrade.toLowerCase().includes('nursery') ||
      resolvedGrade.toLowerCase().includes('kg') ||
      resolvedGrade.toLowerCase().includes('pre')
        ? 'Pre-primary'
        : parseInt(resolvedGrade, 10) <= 5
        ? 'Primary'
        : 'Secondary');

    const newStudent = await prisma.student.create({
      data: {
        parentId: user.parentId,
        name: name.trim(),
        dob: dob || null,
        grade: resolvedGrade,
        division: String(division).trim().toUpperCase(),
        rollNo: String(rollNo).trim(),
        studentId: generatedStudentId,
        studentCategory,
        allergies: allergiesSummary || null,
        dietaryRestrictions: dietaryRestrictions?.trim() || null,
        foodPreference: foodPreference?.trim() || (isVegetarian !== false ? 'Vegetarian' : 'Non-Vegetarian'),
        notes: notes?.trim() || null,
        isVegetarian: isVegetarian !== false,
        profilePhoto: null,
        isActive: true,
      },
    });

    // Create relational student allergies concurrently
    const validAllergies = finalAllergies.filter(
      (alg) => Boolean(alg) && alg.toLowerCase() !== 'none'
    );
    if (validAllergies.length > 0) {
      await Promise.all(
        validAllergies.map(async (alg) => {
          const allergyRecord = await prisma.allergy.upsert({
            where: { name: alg },
            update: {},
            create: { name: alg },
          });

          await prisma.studentAllergy.upsert({
            where: {
              studentId_allergyId: {
                studentId: newStudent.id,
                allergyId: allergyRecord.id,
              },
            },
            update: {},
            create: {
              studentId: newStudent.id,
              allergyId: allergyRecord.id,
            },
          });
        })
      );
    }

    return NextResponse.json({ success: true, student: newStudent }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating child:', error);
    if (error.code === 'P2002') {
      return NextResponse.json({ error: 'A student with this ID already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to create student' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'PARENT' || !user.parentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const data = await req.json();
    const {
      id,
      name,
      dob,
      grade,
      division,
      rollNo,
      allergies,
      allergiesList,
      otherAllergy,
      dietaryRestrictions,
      foodPreference,
      notes,
      isVegetarian,
    } = data;

    if (!id) {
      return NextResponse.json({ error: 'Student ID is required' }, { status: 400 });
    }

    // Verify ownership
    const student = await prisma.student.findFirst({
      where: { id, parentId: user.parentId },
    });

    if (!student) {
      return NextResponse.json({ error: 'Student not found or unauthorized' }, { status: 404 });
    }

    // Build unified allergies list
    let finalAllergies: string[] = [];
    if (Array.isArray(allergiesList)) {
      finalAllergies = [...allergiesList];
    } else if (typeof allergies === 'string') {
      finalAllergies = allergies.split(/[,;]/).map((a: string) => a.trim()).filter(Boolean);
    }
    if (otherAllergy && otherAllergy.trim() && !finalAllergies.includes(otherAllergy.trim())) {
      finalAllergies.push(otherAllergy.trim());
    }

    const allergiesSummary = finalAllergies.join(', ');

    const updated = await prisma.student.update({
      where: { id },
      data: {
        name: name?.trim() ?? student.name,
        dob: dob ?? student.dob,
        grade: grade ? String(grade).trim() : student.grade,
        division: division ? String(division).trim().toUpperCase() : student.division,
        rollNo: rollNo ? String(rollNo).trim() : student.rollNo,
        studentCategory: data.studentCategory !== undefined
          ? data.studentCategory
          : grade
          ? (String(grade).toLowerCase().includes('nursery') ||
             String(grade).toLowerCase().includes('kg') ||
             String(grade).toLowerCase().includes('pre')
              ? 'Pre-primary'
              : parseInt(String(grade), 10) <= 5
              ? 'Primary'
              : 'Secondary')
          : (student as any).studentCategory,
        allergies: allergiesSummary || null,
        dietaryRestrictions: dietaryRestrictions !== undefined ? dietaryRestrictions?.trim() : student.dietaryRestrictions,
        foodPreference: foodPreference !== undefined ? foodPreference?.trim() : student.foodPreference,
        notes: notes !== undefined ? notes?.trim() : student.notes,
        isVegetarian: isVegetarian !== undefined ? isVegetarian : student.isVegetarian,
        profilePhoto: null,
      },
    });

    // Reset and sync student_allergies relation concurrently
    await prisma.studentAllergy.deleteMany({ where: { studentId: id } });
    const validUpdateAllergies = finalAllergies.filter(
      (alg) => Boolean(alg) && alg.toLowerCase() !== 'none'
    );
    if (validUpdateAllergies.length > 0) {
      await Promise.all(
        validUpdateAllergies.map(async (alg) => {
          const allergyRecord = await prisma.allergy.upsert({
            where: { name: alg },
            update: {},
            create: { name: alg },
          });

          await prisma.studentAllergy.create({
            data: {
              studentId: id,
              allergyId: allergyRecord.id,
            },
          });
        })
      );
    }

    return NextResponse.json({ success: true, student: updated });
  } catch (error) {
    console.error('Error updating child:', error);
    return NextResponse.json({ error: 'Failed to update student' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || user.role !== 'PARENT' || !user.parentId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Student ID is required' }, { status: 400 });
    }

    // Verify ownership
    const student = await prisma.student.findFirst({
      where: { id, parentId: user.parentId },
    });

    if (!student) {
      return NextResponse.json({ error: 'Student not found or unauthorized' }, { status: 404 });
    }

    // Soft delete/deactivate so historical orders are preserved
    await prisma.student.update({
      where: { id },
      data: { isActive: false },
    });

    return NextResponse.json({ success: true, message: 'Student removed successfully' });
  } catch (error) {
    console.error('Error deleting child:', error);
    return NextResponse.json({ error: 'Failed to delete student' }, { status: 500 });
  }
}
