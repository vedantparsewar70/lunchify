import assert from 'assert';
import prisma from '../lib/prisma';

async function testChildRegistration() {
  console.log('🧪 Starting Child Registration 3-Field Verification Flow...\n');

  // Find test parent
  const parents = await prisma.parent.findMany();
  assert(parents.length > 0, 'A parent must exist in database for testing registration');
  const parentId = parents[0].id;
  console.log(`👤 Using test parent ID: ${parentId}`);

  // Test 1: Register child with Name, Category, and DOB
  console.log('\n--- 1. Testing Registration with Name, Category, and DOB ---');
  const timestamp = Date.now() % 10000;
  const child1Name = `Aarav Sharma ${timestamp}`;
  const child1Category = 'Pre-primary';
  const child1Dob = '2021-04-15';

  const child1 = await prisma.student.create({
    data: {
      parentId: parentId,
      name: child1Name,
      dob: child1Dob,
      grade: child1Category,
      division: '-',
      rollNo: '-',
      studentId: `STU-2026-${Math.floor(100 + Math.random() * 900)}`,
      studentCategory: child1Category,
      isVegetarian: true,
      isActive: true,
    },
  });

  assert.strictEqual(child1.name, child1Name);
  assert.strictEqual(child1.dob, child1Dob);
  assert.strictEqual(child1.studentCategory, 'Pre-primary');
  assert.strictEqual(child1.grade, 'Pre-primary');
  console.log(`✅ Child 1 registered successfully: ${child1.name} | Category: ${child1.studentCategory} | DOB: ${child1.dob}`);

  // Test 2: Register child with Name and Category only (DOB omitted / optional)
  console.log('\n--- 2. Testing Registration with Name and Category only (DOB optional) ---');
  const child2Name = `Diya Patel ${timestamp}`;
  const child2Category = 'Primary';

  const child2 = await prisma.student.create({
    data: {
      parentId: parentId,
      name: child2Name,
      dob: null,
      grade: child2Category,
      division: '-',
      rollNo: '-',
      studentId: `STU-2026-${Math.floor(100 + Math.random() * 900)}`,
      studentCategory: child2Category,
      isVegetarian: true,
      isActive: true,
    },
  });

  assert.strictEqual(child2.name, child2Name);
  assert.strictEqual(child2.dob, null);
  assert.strictEqual(child2.studentCategory, 'Primary');
  assert.strictEqual(child2.grade, 'Primary');
  console.log(`✅ Child 2 registered successfully without DOB: ${child2.name} | Category: ${child2.studentCategory} | DOB: ${child2.dob}`);

  // Test 3: Register child for Secondary category
  console.log('\n--- 3. Testing Registration for Secondary category ---');
  const child3Name = `Kabir Singh ${timestamp}`;
  const child3Category = 'Secondary';

  const child3 = await prisma.student.create({
    data: {
      parentId: parentId,
      name: child3Name,
      dob: '2014-08-20',
      grade: child3Category,
      division: '-',
      rollNo: '-',
      studentId: `STU-2026-${Math.floor(100 + Math.random() * 900)}`,
      studentCategory: child3Category,
      isVegetarian: true,
      isActive: true,
    },
  });

  assert.strictEqual(child3.name, child3Name);
  assert.strictEqual(child3.studentCategory, 'Secondary');
  assert.strictEqual(child3.grade, 'Secondary');
  console.log(`✅ Child 3 registered successfully: ${child3.name} | Category: ${child3.studentCategory}`);

  // Test 4: Verify persistence and query back
  console.log('\n--- 4. Verifying Persistence & Category Filtering ---');
  const queriedChild1 = await prisma.student.findUnique({ where: { id: child1.id } });
  assert(queriedChild1, 'Child 1 must persist');
  assert.strictEqual(queriedChild1.studentCategory, 'Pre-primary');

  const queriedChild2 = await prisma.student.findUnique({ where: { id: child2.id } });
  assert(queriedChild2, 'Child 2 must persist');
  assert.strictEqual(queriedChild2.studentCategory, 'Primary');

  console.log('✅ Child records persisted and re-queried accurately from database');

  // Clean up test students using db
  const { db } = await import('../lib/firebase-admin');
  await db.collection('students').doc(child1.id).delete();
  await db.collection('students').doc(child2.id).delete();
  await db.collection('students').doc(child3.id).delete();
  console.log('✅ Cleaned up temporary test children records.');

  console.log('\n🎉 ALL CHILD REGISTRATION 3-FIELD TESTS PASSED!\n');
}

testChildRegistration()
  .catch((err) => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
