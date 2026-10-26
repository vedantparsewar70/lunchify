import { db } from './firebase-admin';
import { categoryMenuDocId } from './menu-stock';
import { FieldValue, type DocumentSnapshot, type Query, type DocumentReference, type Transaction } from 'firebase-admin/firestore';

export interface DbUser {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  phone?: string | null;
  role: string;
  createdAt: Date;
  updatedAt: Date;
  parent?: DbParent | null;
}

export interface DbParent {
  id: string;
  userId: string;
  walletBalance: number;
  createdAt: Date;
  updatedAt: Date;
  user: DbUser;
  students: DbStudent[];
  orders: DbOrder[];
}

export interface DbAllergy {
  id: string;
  name: string;
  createdAt: Date;
}

export interface DbStudentAllergy {
  id: string;
  studentId: string;
  allergyId: string;
  customNote?: string | null;
  createdAt: Date;
  allergy: DbAllergy;
}

export interface DbStudent {
  id: string;
  parentId: string;
  name: string;
  dob?: string | null;
  grade: string;
  division: string;
  rollNo: string;
  studentId: string;
  studentCategory?: string | null;
  allergies?: string | null;
  dietaryRestrictions?: string | null;
  foodPreference?: string | null;
  notes?: string | null;
  isVegetarian: boolean;
  profilePhoto?: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  parent: DbParent;
  studentAllergies: DbStudentAllergy[];
  orderItems: DbOrderItem[];
}

export interface DbAllergen {
  id: string;
  name: string;
  createdAt: Date;
}

export interface DbMealAllergen {
  id: string;
  mealId: string;
  allergenId: string;
  createdAt: Date;
  allergen: DbAllergen;
}

export interface DbMeal {
  id: string;
  name: string;
  description: string;
  category: string;
  isVegetarian: boolean;
  ingredients?: string | null;
  allergens?: string | null;
  calories?: number | null;
  price: number;
  imageUrl?: string | null;
  createdAt: Date;
  updatedAt: Date;
  mealAllergens: DbMealAllergen[];
}

export interface DbMenu {
  id: string;
  mealId: string;
  meal: DbMeal;
  date: string;
  studentCategory?: string;
  isHoliday?: boolean;
  holidayReason?: string | null;
  availableQuantity: number;
  maxQuantity: number;
  orderingDeadline: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DbOrderItem {
  id: string;
  orderId: string;
  studentId: string;
  mealId: string;
  date: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  hasAllergyAlert: boolean;
  conflictAllergens?: string | null;
  createdAt: Date;
  student: DbStudent;
  meal: DbMeal;
  order: DbOrder;
}

export interface DbPayment {
  id: string;
  orderId: string;
  amount: number;
  paymentMethod: string;
  status: string;
  transactionRef: string;
  upiId?: string | null;
  cardLastFour?: string | null;
  bankName?: string | null;
  createdAt: Date;
  order?: DbOrder;
}

export interface DbOrder {
  id: string;
  parentId: string;
  totalAmount: number;
  paymentStatus: string;
  orderStatus: string;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: DbOrderItem[];
  payments: DbPayment[];
  parent: DbParent;
}

export interface DbSystemSetting {
  key: string;
  value: string;
  updatedAt: Date;
}

// Helper to generate cuid-like unique id
export function generateId(prefix: string = ''): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 9);
  return `${prefix}${ts}${rand}`;
}

export function cleanDoc<T extends Record<string, any>>(obj: T): T {
  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

// Convert Firestore doc to JS object
function docData(doc: DocumentSnapshot): any {
  if (!doc.exists) return null;
  const data = doc.data() || {};
  return {
    id: doc.id,
    ...data,
    createdAt: data.createdAt ? new Date(data.createdAt) : new Date(),
    updatedAt: data.updatedAt ? new Date(data.updatedAt) : new Date(),
  };
}

interface StaticCacheEntry {
  data: any;
  expiry: number;
}
const staticDocCache = new Map<string, StaticCacheEntry>();
const STATIC_CACHE_TTL = 30000; // 30s TTL
const STATIC_COLLECTIONS = new Set(['allergens', 'allergies', 'meals']);

export function invalidateStaticCache(collectionName?: string) {
  if (!collectionName) {
    staticDocCache.clear();
  } else {
    for (const key of staticDocCache.keys()) {
      if (key.startsWith(`${collectionName}:`)) {
        staticDocCache.delete(key);
      }
    }
  }
}

// Ultra-fast batch fetch of documents by ID using Firestore db.getAll in chunks with static caching
async function batchGetDocs(collectionName: string, ids: (string | undefined | null)[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  const uniqueIds = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
  if (uniqueIds.length === 0) return map;

  const now = Date.now();
  const isStatic = STATIC_COLLECTIONS.has(collectionName);
  const idsToFetch: string[] = [];

  if (isStatic) {
    for (const id of uniqueIds) {
      const cacheKey = `${collectionName}:${id}`;
      const cached = staticDocCache.get(cacheKey);
      if (cached && now < cached.expiry) {
        map.set(id, cached.data);
      } else {
        idsToFetch.push(id);
      }
    }
    if (idsToFetch.length === 0) {
      return map;
    }
  } else {
    idsToFetch.push(...uniqueIds);
  }

  const chunkSize = 200;
  for (let i = 0; i < idsToFetch.length; i += chunkSize) {
    const chunk = idsToFetch.slice(i, i + chunkSize);
    const refs = chunk.map((id) => db.collection(collectionName).doc(id));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      if (snap.exists) {
        const item = docData(snap);
        map.set(snap.id, item);
        if (isStatic) {
          staticDocCache.set(`${collectionName}:${snap.id}`, { data: item, expiry: now + STATIC_CACHE_TTL });
        }
      }
    }
  }
  return map;
}

// Ultra-fast chunked 'in' query for querying related child collections in parallel
async function queryInChunks<T = any>(
  collectionName: string,
  field: string,
  values: (string | undefined | null)[]
): Promise<T[]> {
  const unique = Array.from(new Set(values.filter((v): v is string => Boolean(v))));
  if (unique.length === 0) return [];

  const results: T[] = [];
  const chunkSize = 30; // Firestore limit for 'in' queries
  const promises: Promise<any>[] = [];

  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    promises.push(db.collection(collectionName).where(field, 'in', chunk).get());
  }

  const snapshots = await Promise.all(promises);
  for (const snap of snapshots) {
    for (const doc of snap.docs) {
      results.push(docData(doc));
    }
  }
  return results;
}

export class FirestoreDbAdapter {
  // SystemSetting
  systemSetting = {
    findUnique: async ({ where }: { where: { key: string } }): Promise<DbSystemSetting | null> => {
      const snap = await db.collection('systemSettings').doc(where.key).get();
      return docData(snap);
    },
    upsert: async ({ where, update, create }: any): Promise<DbSystemSetting> => {
      const ref = db.collection('systemSettings').doc(where.key);
      const snap = await ref.get();
      const now = new Date().toISOString();
      if (snap.exists) {
        await ref.set({ ...update, updatedAt: now }, { merge: true });
      } else {
        await ref.set({ ...create, key: where.key, updatedAt: now });
      }
      const updatedSnap = await ref.get();
      return docData(updatedSnap);
    },
    deleteMany: async (): Promise<any> => {
      const snap = await db.collection('systemSettings').get();
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      return { count: snap.docs.length };
    },
    create: async ({ data }: any): Promise<DbSystemSetting> => {
      const key = data.key;
      await db.collection('systemSettings').doc(key).set({ ...data, updatedAt: new Date().toISOString() });
      return data;
    },
  };

  // User
  user = {
    findUnique: async ({ where, include }: any): Promise<DbUser | null> => {
      let doc: any = null;
      if (where.id) {
        const snap = await db.collection('users').doc(where.id).get();
        doc = docData(snap);
      } else if (where.email) {
        const snap = await db.collection('users').where('email', '==', where.email.toLowerCase()).limit(1).get();
        if (!snap.empty) {
          doc = docData(snap.docs[0]);
        }
      }

      if (!doc) return null;

      if (include?.parent && doc.role === 'PARENT') {
        const parentSnap = await db.collection('parents').where('userId', '==', doc.id).limit(1).get();
        if (!parentSnap.empty) {
          const parentData = docData(parentSnap.docs[0]);
          if (include.parent.include?.students) {
            const studentsSnap = await db
              .collection('students')
              .where('parentId', '==', parentData.id)
              .where('isActive', '==', true)
              .get();
            const students = studentsSnap.docs
              .map((d) => docData(d))
              .sort((a: any, b: any) => String(a?.name || '').localeCompare(String(b?.name || '')));
            parentData.students = students;
          }
          doc.parent = parentData;
        } else {
          doc.parent = null;
        }
      }
      return doc;
    },
    create: async ({ data, include }: any): Promise<DbUser> => {
      const userId = data.id || generateId('usr_');
      const now = new Date().toISOString();
      const userRef = db.collection('users').doc(userId);

      const { parent: parentCreate, ...userData } = data;
      const userObj = cleanDoc({
        id: userId,
        ...userData,
        createdAt: now,
        updatedAt: now,
      });
      await userRef.set(userObj);

      let createdParent = null;
      if (parentCreate?.create) {
        const parentId = generateId('par_');
        const parentObj = cleanDoc({
          id: parentId,
          userId,
          walletBalance: parentCreate.create.walletBalance ?? 500,
          createdAt: now,
          updatedAt: now,
        });
        await db.collection('parents').doc(parentId).set(parentObj);
        createdParent = parentObj;
      }

      const res: any = { ...userObj };
      if (include?.parent) {
        res.parent = createdParent;
      }
      return res;
    },
    upsert: async ({ where, update, create }: any): Promise<DbUser> => {
      const snap = await db.collection('users').doc(where.id).get();
      if (snap.exists) {
        await db.collection('users').doc(where.id).set(update, { merge: true });
      } else {
        await db.collection('users').doc(where.id).set({ id: where.id, ...create });
      }
      return docData(await db.collection('users').doc(where.id).get());
    },
    count: async (args?: any): Promise<number> => {
      const snap = await db.collection('users').count().get();
      return snap.data().count;
    },
    findMany: async (args?: any): Promise<DbUser[]> => {
      const snap = await db.collection('users').get();
      return snap.docs.map((d) => docData(d));
    },
    deleteMany: async (): Promise<any> => {
      const snap = await db.collection('users').get();
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      return { count: snap.docs.length };
    },
  };

  // Parent
  parent = {
    findUnique: async ({ where, include }: any): Promise<DbParent | null> => {
      let pDoc: any = null;
      if (where.id) {
        const snap = await db.collection('parents').doc(where.id).get();
        pDoc = docData(snap);
      } else if (where.userId) {
        const snap = await db.collection('parents').where('userId', '==', where.userId).limit(1).get();
        if (!snap.empty) pDoc = docData(snap.docs[0]);
      }
      if (!pDoc) return null;

      if (include?.user) {
        const uSnap = await db.collection('users').doc(pDoc.userId).get();
        pDoc.user = docData(uSnap);
      }
      if (include?.students) {
        const sSnap = await db.collection('students').where('parentId', '==', pDoc.id).get();
        pDoc.students = sSnap.docs.map((d) => docData(d));
      }
      return pDoc;
    },
    findMany: async ({ include, orderBy }: any = {}): Promise<DbParent[]> => {
      const snap = await db.collection('parents').get();
      let parents = snap.docs.map((d) => docData(d));

      if (include && parents.length > 0) {
        const parentIds = parents.map((p) => p.id);
        const userIds = parents.map((p) => p.userId);

        const [usersMap, allStudents, allOrders] = await Promise.all([
          include.user ? batchGetDocs('users', userIds) : Promise.resolve(new Map()),
          include.students ? queryInChunks<any>('students', 'parentId', parentIds) : Promise.resolve([]),
          include.orders ? queryInChunks<any>('orders', 'parentId', parentIds) : Promise.resolve([]),
        ]);

        const studentsByParent = new Map<string, any[]>();
        for (const s of allStudents) {
          const l = studentsByParent.get(s.parentId) || [];
          l.push(s);
          studentsByParent.set(s.parentId, l);
        }

        const ordersByParent = new Map<string, any[]>();
        for (const o of allOrders) {
          const l = ordersByParent.get(o.parentId) || [];
          l.push(o);
          ordersByParent.set(o.parentId, l);
        }

        for (const p of parents) {
          if (include.user) p.user = usersMap.get(p.userId) || null;
          if (include.students) p.students = studentsByParent.get(p.id) || [];
          if (include.orders) p.orders = ordersByParent.get(p.id) || [];
        }
      }
      if (orderBy?.createdAt === 'desc') {
        parents.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }
      return parents;
    },
    update: async ({ where, data }: any): Promise<DbParent> => {
      const ref = db.collection('parents').doc(where.id);
      const now = new Date().toISOString();
      const updateData: any = { updatedAt: now };

      if (data.walletBalance !== undefined) {
        if (typeof data.walletBalance === 'object' && data.walletBalance.increment !== undefined) {
          updateData.walletBalance = FieldValue.increment(Number(data.walletBalance.increment));
        } else if (typeof data.walletBalance === 'object' && data.walletBalance.decrement !== undefined) {
          updateData.walletBalance = FieldValue.increment(-Number(data.walletBalance.decrement));
        } else {
          updateData.walletBalance = Number(data.walletBalance);
        }
      }

      await ref.set(updateData, { merge: true });
      return docData(await ref.get());
    },
    upsert: async ({ where, update, create }: any): Promise<DbParent> => {
      const ref = db.collection('parents').doc(where.id);
      const snap = await ref.get();
      if (snap.exists) {
        await ref.set(update, { merge: true });
      } else {
        await ref.set({ id: where.id, ...create });
      }
      return docData(await ref.get());
    },
    count: async (): Promise<number> => {
      const snap = await db.collection('parents').count().get();
      return snap.data().count;
    },
    deleteMany: async (): Promise<any> => {
      const snap = await db.collection('parents').get();
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      return { count: snap.docs.length };
    },
  };

  // Student
  student = {
    findMany: async ({ where, include, orderBy }: any = {}): Promise<DbStudent[]> => {
      let query: Query = db.collection('students');
      if (where?.parentId) {
        query = query.where('parentId', '==', where.parentId);
      }
      if (where?.isActive !== undefined) {
        query = query.where('isActive', '==', where.isActive);
      }
      const snap = await query.get();
      let list = snap.docs.map((d) => docData(d));

      for (const st of list) {
        if (!st.studentAllergies) st.studentAllergies = [];
        if (!st.orderItems) st.orderItems = [];
      }

      const studentIds = list.map((s) => s.id);

      const [allStudentAllergies, allOrderItems, parentsMap] = await Promise.all([
        include?.studentAllergies ? queryInChunks<any>('studentAllergies', 'studentId', studentIds) : Promise.resolve([]),
        include?.orderItems ? queryInChunks<any>('orderItems', 'studentId', studentIds) : Promise.resolve([]),
        include?.parent ? batchGetDocs('parents', list.map((s) => s.parentId)) : Promise.resolve(new Map()),
      ]);

      let allergiesMap = new Map<string, any>();
      if (include?.studentAllergies?.include?.allergy && allStudentAllergies.length > 0) {
        allergiesMap = await batchGetDocs('allergies', allStudentAllergies.map((sa) => sa.allergyId));
      }

      let usersMap = new Map<string, any>();
      if (include?.parent?.include?.user && parentsMap.size > 0) {
        const userIds = Array.from(parentsMap.values()).map((p: any) => p?.userId).filter(Boolean);
        usersMap = await batchGetDocs('users', userIds);
      }

      const saByStudent = new Map<string, any[]>();
      for (const sa of allStudentAllergies) {
        if (include?.studentAllergies?.include?.allergy) {
          sa.allergy = allergiesMap.get(sa.allergyId) || null;
        }
        const l = saByStudent.get(sa.studentId) || [];
        l.push(sa);
        saByStudent.set(sa.studentId, l);
      }

      const oiByStudent = new Map<string, any[]>();
      for (const oi of allOrderItems) {
        const l = oiByStudent.get(oi.studentId) || [];
        l.push(oi);
        oiByStudent.set(oi.studentId, l);
      }

      for (const st of list) {
        st.studentAllergies = saByStudent.get(st.id) || [];
        st.orderItems = oiByStudent.get(st.id) || [];
        if (include?.parent) {
          const p = parentsMap.get(st.parentId) || null;
          if (p && include.parent.include?.user) {
            p.user = usersMap.get(p.userId) || null;
          }
          st.parent = p;
        }
      }

      if (orderBy?.name === 'asc') {
        list.sort((a: any, b: any) => String(a.name || '').localeCompare(String(b.name || '')));
      }
      return list;
    },
    findUnique: async ({ where, include }: any): Promise<DbStudent | null> => {
      let st: any = null;
      if (where.id) {
        const snap = await db.collection('students').doc(where.id).get();
        st = docData(snap);
      } else if (where.studentId) {
        const snap = await db.collection('students').where('studentId', '==', where.studentId).limit(1).get();
        if (!snap.empty) st = docData(snap.docs[0]);
      }
      if (!st) return null;
      if (!st.studentAllergies) st.studentAllergies = [];
      if (!st.orderItems) st.orderItems = [];

      if (include?.studentAllergies) {
        const saSnap = await db.collection('studentAllergies').where('studentId', '==', st.id).get();
        const saList = saSnap.docs.map((d) => docData(d));
        if (include.studentAllergies.include?.allergy && saList.length > 0) {
          const allergiesMap = await batchGetDocs('allergies', saList.map((sa) => sa.allergyId));
          for (const sa of saList) {
            sa.allergy = allergiesMap.get(sa.allergyId) || null;
          }
        }
        st.studentAllergies = saList;
      }
      return st;
    },
    findFirst: async ({ where, include }: any): Promise<DbStudent | null> => {
      let query: Query = db.collection('students');
      if (where.id) query = query.where('__name__', '==', where.id);
      if (where.parentId) query = query.where('parentId', '==', where.parentId);
      if (where.studentId) query = query.where('studentId', '==', where.studentId);
      const snap = await query.limit(1).get();
      if (snap.empty) return null;
      const st = docData(snap.docs[0]);
      if (!st.studentAllergies) st.studentAllergies = [];
      if (!st.orderItems) st.orderItems = [];
      return st;
    },
    create: async ({ data, include }: any): Promise<DbStudent> => {
      const id = data.id || generateId('stu_');
      const now = new Date().toISOString();
      const obj = {
        id,
        studentAllergies: [],
        orderItems: [],
        ...data,
        createdAt: now,
        updatedAt: now,
      };
      await db.collection('students').doc(id).set(obj);
      return obj;
    },
    upsert: async ({ where, update, create }: any): Promise<DbStudent> => {
      const ref = db.collection('students').doc(where.id);
      const snap = await ref.get();
      if (snap.exists) {
        await ref.set(update, { merge: true });
      } else {
        await ref.set({ id: where.id, ...create });
      }
      return docData(await ref.get());
    },
    update: async ({ where, data }: any): Promise<DbStudent> => {
      const ref = db.collection('students').doc(where.id);
      const now = new Date().toISOString();
      await ref.set({ ...data, updatedAt: now }, { merge: true });
      return docData(await ref.get());
    },
    count: async ({ where }: any = {}): Promise<number> => {
      let query: Query = db.collection('students');
      if (where?.isActive !== undefined) {
        query = query.where('isActive', '==', where.isActive);
      }
      const snap = await query.count().get();
      return snap.data().count;
    },
    deleteMany: async (): Promise<any> => {
      const snap = await db.collection('students').get();
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      return { count: snap.docs.length };
    },
  };

  // Allergy
  allergy = {
    findMany: async (): Promise<DbAllergy[]> => {
      const snap = await db.collection('allergies').get();
      return snap.docs.map((d) => docData(d));
    },
    create: async ({ data }: any): Promise<DbAllergy> => {
      const id = data.id || generateId('alg_');
      const obj = { id, ...data, createdAt: new Date().toISOString() };
      await db.collection('allergies').doc(id).set(obj);
      return obj;
    },
    upsert: async ({ where, create, update }: any): Promise<DbAllergy> => {
      if (where.id) {
        const snap = await db.collection('allergies').doc(where.id).get();
        if (snap.exists) {
          await db.collection('allergies').doc(where.id).set(update, { merge: true });
          return docData(await db.collection('allergies').doc(where.id).get());
        }
        const obj = { id: where.id, ...create, createdAt: new Date().toISOString() };
        await db.collection('allergies').doc(where.id).set(obj);
        return obj;
      }
      if (where.name) {
        const snap = await db.collection('allergies').where('name', '==', where.name).limit(1).get();
        if (!snap.empty) return docData(snap.docs[0]);
      }
      const id = generateId('alg_');
      const obj = { id, ...(create || update), createdAt: new Date().toISOString() };
      await db.collection('allergies').doc(id).set(obj);
      return obj;
    },
    deleteMany: async (): Promise<any> => {
      const snap = await db.collection('allergies').get();
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      return { count: snap.docs.length };
    },
  };

  // StudentAllergy
  studentAllergy = {
    deleteMany: async ({ where }: any = {}): Promise<any> => {
      let query: Query = db.collection('studentAllergies');
      if (where?.studentId) query = query.where('studentId', '==', where.studentId);
      const snap = await query.get();
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      return { count: snap.docs.length };
    },
    upsert: async ({ where, create, update }: any): Promise<DbStudentAllergy> => {
      const studentId = where.studentId_allergyId?.studentId || create?.studentId;
      const allergyId = where.studentId_allergyId?.allergyId || create?.allergyId;
      const id = where.id || `${studentId}_${allergyId}`;
      const ref = db.collection('studentAllergies').doc(id);
      const data = {
        id,
        studentId,
        allergyId,
        ...(create || update),
        createdAt: new Date().toISOString(),
      };
      await ref.set(data, { merge: true });
      return data as any;
    },
    create: async ({ data }: any): Promise<DbStudentAllergy> => {
      const id = data.id || `${data.studentId}_${data.allergyId}`;
      const obj = { id, ...data, createdAt: new Date().toISOString() };
      await db.collection('studentAllergies').doc(id).set(obj, { merge: true });
      return obj as any;
    },
  };

  // Meal
  meal = {
    findMany: async ({ include, orderBy }: any = {}): Promise<DbMeal[]> => {
      const snap = await db.collection('meals').get();
      let list = snap.docs.map((d) => docData(d));
      for (const m of list) {
        if (!m.mealAllergens) m.mealAllergens = [];
      }
      if (include?.mealAllergens && list.length > 0) {
        const mealIds = list.map((m) => m.id);
        const allMealAllergens = await queryInChunks<any>('mealAllergens', 'mealId', mealIds);

        let allergensMap = new Map<string, any>();
        if (include.mealAllergens.include?.allergen && allMealAllergens.length > 0) {
          allergensMap = await batchGetDocs('allergens', allMealAllergens.map((ma) => ma.allergenId));
        }

        const maByMeal = new Map<string, any[]>();
        for (const ma of allMealAllergens) {
          if (include.mealAllergens.include?.allergen) {
            ma.allergen = allergensMap.get(ma.allergenId) || null;
          }
          const l = maByMeal.get(ma.mealId) || [];
          l.push(ma);
          maByMeal.set(ma.mealId, l);
        }

        for (const m of list) {
          m.mealAllergens = maByMeal.get(m.id) || [];
        }
      }
      if (orderBy?.name === 'asc') {
        list.sort((a: any, b: any) => a.name.localeCompare(b.name));
      }
      return list;
    },
    findUnique: async ({ where, include }: any): Promise<DbMeal | null> => {
      const snap = await db.collection('meals').doc(where.id).get();
      const m = docData(snap);
      if (!m) return null;
      if (!m.mealAllergens) m.mealAllergens = [];

      if (include?.mealAllergens) {
        const maSnap = await db.collection('mealAllergens').where('mealId', '==', m.id).get();
        const maList = maSnap.docs.map((d) => docData(d));
        if (include.mealAllergens.include?.allergen && maList.length > 0) {
          const allergensMap = await batchGetDocs('allergens', maList.map((ma) => ma.allergenId));
          for (const ma of maList) {
            ma.allergen = allergensMap.get(ma.allergenId) || null;
          }
        }
        m.mealAllergens = maList;
      }
      return m;
    },
    create: async ({ data }: any): Promise<DbMeal> => {
      invalidateStaticCache('meals');
      const id = data.id || generateId('mel_');
      const now = new Date().toISOString();
      const obj = { id, mealAllergens: [], ...data, createdAt: now, updatedAt: now };
      await db.collection('meals').doc(id).set(obj);
      return obj;
    },
    upsert: async ({ where, update, create }: any): Promise<DbMeal> => {
      invalidateStaticCache('meals');
      const ref = db.collection('meals').doc(where.id);
      const snap = await ref.get();
      if (snap.exists) {
        await ref.set(update, { merge: true });
      } else {
        await ref.set({ id: where.id, ...create });
      }
      return docData(await ref.get());
    },
    update: async ({ where, data }: any): Promise<DbMeal> => {
      invalidateStaticCache('meals');
      const ref = db.collection('meals').doc(where.id);
      const now = new Date().toISOString();
      await ref.set({ ...data, updatedAt: now }, { merge: true });
      return docData(await ref.get());
    },
    delete: async ({ where }: any): Promise<any> => {
      invalidateStaticCache('meals');
      await db.collection('meals').doc(where.id).delete();
      return { id: where.id };
    },
    count: async (args?: any): Promise<number> => {
      const snap = await db.collection('meals').count().get();
      return snap.data().count;
    },
    deleteMany: async (): Promise<any> => {
      invalidateStaticCache('meals');
      const snap = await db.collection('meals').get();
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      return { count: snap.docs.length };
    },
  };

  // Allergen
  allergen = {
    findMany: async (): Promise<DbAllergen[]> => {
      const snap = await db.collection('allergens').get();
      return snap.docs.map((d) => docData(d));
    },
    create: async ({ data }: any): Promise<DbAllergen> => {
      const id = data.id || generateId('aln_');
      const obj = { id, ...data, createdAt: new Date().toISOString() };
      await db.collection('allergens').doc(id).set(obj);
      return obj;
    },
    upsert: async ({ where, create, update }: any): Promise<DbAllergen> => {
      if (where.id) {
        const snap = await db.collection('allergens').doc(where.id).get();
        if (snap.exists) {
          await db.collection('allergens').doc(where.id).set(update, { merge: true });
          return docData(await db.collection('allergens').doc(where.id).get());
        }
        const obj = { id: where.id, ...create, createdAt: new Date().toISOString() };
        await db.collection('allergens').doc(where.id).set(obj);
        return obj;
      }
      if (where.name) {
        const snap = await db.collection('allergens').where('name', '==', where.name).limit(1).get();
        if (!snap.empty) return docData(snap.docs[0]);
      }
      const id = generateId('aln_');
      const obj = { id, ...(create || update), createdAt: new Date().toISOString() };
      await db.collection('allergens').doc(id).set(obj);
      return obj;
    },
    deleteMany: async (): Promise<any> => {
      const snap = await db.collection('allergens').get();
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      return { count: snap.docs.length };
    },
  };

  // MealAllergen
  mealAllergen = {
    create: async ({ data }: any): Promise<DbMealAllergen> => {
      const id = `${data.mealId}_${data.allergenId}`;
      const obj = { id, ...data, createdAt: new Date().toISOString() };
      await db.collection('mealAllergens').doc(id).set(obj, { merge: true });
      return obj as any;
    },
    deleteMany: async ({ where }: any = {}): Promise<any> => {
      let query: Query = db.collection('mealAllergens');
      if (where?.mealId) query = query.where('mealId', '==', where.mealId);
      const snap = await query.get();
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      return { count: snap.docs.length };
    },
    upsert: async ({ where, create, update }: any): Promise<DbMealAllergen> => {
      const mealId = where.mealId_allergenId?.mealId || create?.mealId;
      const allergenId = where.mealId_allergenId?.allergenId || create?.allergenId;
      const id = where.id || `${mealId}_${allergenId}`;
      const ref = db.collection('mealAllergens').doc(id);
      const data = { id, mealId, allergenId, ...(create || update), createdAt: new Date().toISOString() };
      await ref.set(data, { merge: true });
      return data as any;
    },
  };

  // Menu
  menu = {
    findMany: async ({ where, include, orderBy }: any = {}): Promise<DbMenu[]> => {
      let query: Query = db.collection('menus');
      if (typeof where?.date === 'string') {
        query = query.where('date', '==', where.date);
      }
      const snap = await query.get();
      let list = snap.docs.map((d) => docData(d));

      if (where?.date) {
        if (typeof where.date === 'string') {
          list = list.filter((m: any) => m.date === where.date);
        } else if (where.date?.in && Array.isArray(where.date.in)) {
          const dateSet = new Set(where.date.in);
          list = list.filter((m: any) => dateSet.has(m.date));
        } else if (typeof where.date === 'object') {
          if (where.date.gte) {
            list = list.filter((m: any) => m.date >= where.date.gte);
          }
          if (where.date.lte) {
            list = list.filter((m: any) => m.date <= where.date.lte);
          }
        }
      }

      if (where?.studentCategory) {
        const normalize = (val: string) => {
          const clean = String(val).trim().toLowerCase();
          if (clean.includes('pre')) return 'Pre-primary';
          if (clean.includes('sec')) return 'Secondary';
          if (clean.includes('pri')) return 'Primary';
          return val;
        };

        if (typeof where.studentCategory === 'string') {
          const target = normalize(where.studentCategory);
          list = list.filter(
            (m: any) =>
              !m.studentCategory ||
              m.studentCategory === 'ALL' ||
              normalize(m.studentCategory) === target
          );
        } else if (where.studentCategory?.in && Array.isArray(where.studentCategory.in)) {
          const normalizedTargets = new Set(where.studentCategory.in.map(normalize));
          normalizedTargets.add('ALL');
          list = list.filter((m: any) => !m.studentCategory || normalizedTargets.has(normalize(m.studentCategory)));
        }
      }

      if (where?.isHoliday !== undefined) {
        list = list.filter((m: any) => Boolean(m.isHoliday) === Boolean(where.isHoliday));
      }

      if (where?.mealId) {
        if (typeof where.mealId === 'string') {
          list = list.filter((m: any) => m.mealId === where.mealId);
        } else if (where.mealId?.in && Array.isArray(where.mealId.in)) {
          const mealIdSet = new Set(where.mealId.in);
          list = list.filter((m: any) => mealIdSet.has(m.mealId));
        }
      }

      if (where?.id) {
        if (typeof where.id === 'string') {
          list = list.filter((m: any) => m.id === where.id);
        } else if (where.id?.in && Array.isArray(where.id.in)) {
          const idSet = new Set(where.id.in);
          list = list.filter((m: any) => idSet.has(m.id));
        }
      }

      if (where?.isActive !== undefined) {
        list = list.filter((m: any) => Boolean(m.isActive) === Boolean(where.isActive));
      }

      if (include?.meal && list.length > 0) {
        const mealIds = list.map((mn) => mn.mealId);
        const mealsMap = await batchGetDocs('meals', mealIds);

        if (include.meal.include?.mealAllergens) {
          const allMealAllergens = await queryInChunks<any>('mealAllergens', 'mealId', Array.from(mealsMap.keys()));
          const allergenIds = allMealAllergens.map((ma) => ma.allergenId);
          const allergensMap = await batchGetDocs('allergens', allergenIds);

          const mealAllergensByMealId = new Map<string, any[]>();
          for (const ma of allMealAllergens) {
            ma.allergen = allergensMap.get(ma.allergenId) || null;
            const l = mealAllergensByMealId.get(ma.mealId) || [];
            l.push(ma);
            mealAllergensByMealId.set(ma.mealId, l);
          }

          for (const meal of mealsMap.values()) {
            meal.mealAllergens = mealAllergensByMealId.get(meal.id) || [];
          }
        }

        for (const mn of list) {
          mn.meal = mealsMap.get(mn.mealId) || null;
        }
      }

      if (orderBy?.date) {
        list.sort((a: any, b: any) => (orderBy.date === 'asc' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)));
      }
      return list;
    },
    findUnique: async ({ where, include }: any): Promise<DbMenu | null> => {
      let doc: any = null;
      if (where.id) {
        const snap = await db.collection('menus').doc(where.id).get();
        doc = docData(snap);
      } else if (where.mealId_date_studentCategory) {
        const { mealId, date, studentCategory } = where.mealId_date_studentCategory;
        const directId = categoryMenuDocId(date, studentCategory);
        const snap = await db.collection('menus').doc(directId).get();
        if (snap.exists) {
          doc = docData(snap);
        } else {
          const qSnap = await db
            .collection('menus')
            .where('mealId', '==', mealId)
            .where('date', '==', date)
            .where('studentCategory', '==', studentCategory)
            .limit(1)
            .get();
          if (!qSnap.empty) doc = docData(qSnap.docs[0]);
        }
      } else if (where.mealId_date) {
        const directId = `${where.mealId_date.mealId}_${where.mealId_date.date}`;
        const snap = await db.collection('menus').doc(directId).get();
        if (snap.exists) {
          doc = docData(snap);
        } else {
          const qSnap = await db
            .collection('menus')
            .where('mealId', '==', where.mealId_date.mealId)
            .where('date', '==', where.mealId_date.date)
            .limit(1)
            .get();
          if (!qSnap.empty) doc = docData(qSnap.docs[0]);
        }
      }
      if (!doc) return null;
      if (include?.meal) {
        const mSnap = await db.collection('meals').doc(doc.mealId).get();
        doc.meal = docData(mSnap);
      }
      return doc;
    },
    findFirst: async ({ where }: any): Promise<DbMenu | null> => {
      let query: Query = db.collection('menus');
      if (where.mealId) query = query.where('mealId', '==', where.mealId);
      if (where.date) query = query.where('date', '==', where.date);
      if (where.studentCategory) query = query.where('studentCategory', '==', where.studentCategory);
      const snap = await query.limit(1).get();
      if (snap.empty) return null;
      return docData(snap.docs[0]);
    },
    upsert: async ({ where, create, update }: any): Promise<DbMenu> => {
      const mealId =
        where.mealId_date_studentCategory?.mealId ||
        where.mealId_date?.mealId ||
        create.mealId;
      const date =
        where.mealId_date_studentCategory?.date ||
        where.mealId_date?.date ||
        create.date;
      const studentCategory =
        where.mealId_date_studentCategory?.studentCategory ||
        create.studentCategory ||
        update.studentCategory ||
        'ALL';

      let ref: DocumentReference;
      let docExists = false;

      if (where.id) {
        ref = db.collection('menus').doc(where.id);
        const snap = await ref.get();
        docExists = snap.exists;
      } else if (where.mealId_date_studentCategory) {
        const docId = categoryMenuDocId(date, studentCategory);
        ref = db.collection('menus').doc(docId);
        const snap = await ref.get();
        if (snap.exists) {
          docExists = true;
        } else {
          const qSnap = await db
            .collection('menus')
            .where('mealId', '==', mealId)
            .where('date', '==', date)
            .where('studentCategory', '==', studentCategory)
            .limit(1)
            .get();
          if (!qSnap.empty) {
            ref = qSnap.docs[0].ref;
            docExists = true;
          }
        }
      } else if (where.mealId_date) {
        const qSnap = await db
          .collection('menus')
          .where('mealId', '==', where.mealId_date.mealId)
          .where('date', '==', where.mealId_date.date)
          .limit(1)
          .get();
        if (!qSnap.empty) {
          ref = qSnap.docs[0].ref;
          docExists = true;
        } else {
          ref = db.collection('menus').doc(`${mealId}_${date}`);
        }
      } else {
        const id = where.id || `${mealId}_${date}`;
        ref = db.collection('menus').doc(id);
        const snap = await ref.get();
        docExists = snap.exists;
      }

      const now = new Date().toISOString();
      if (docExists) {
        await ref.set({ ...update, updatedAt: now }, { merge: true });
      } else {
        const newId = ref.id;
        await ref.set({
          id: newId,
          mealId,
          date,
          studentCategory,
          ...create,
          createdAt: now,
          updatedAt: now,
        });
      }
      return docData(await ref.get());
    },
    update: async ({ where, data }: any): Promise<DbMenu> => {
      let ref: DocumentReference;
      if (where.id) {
        ref = db.collection('menus').doc(where.id);
      } else if (where.mealId_date) {
        const qSnap = await db.collection('menus')
          .where('mealId', '==', where.mealId_date.mealId)
          .where('date', '==', where.mealId_date.date)
          .limit(1)
          .get();
        if (!qSnap.empty) {
          ref = qSnap.docs[0].ref;
        } else {
          ref = db.collection('menus').doc(`${where.mealId_date.mealId}_${where.mealId_date.date}`);
        }
      } else {
        throw new Error('Invalid where clause for menu update');
      }

      const updateData: any = { updatedAt: new Date().toISOString() };
      if (data.availableQuantity !== undefined) {
        if (typeof data.availableQuantity === 'object' && data.availableQuantity.decrement !== undefined) {
          updateData.availableQuantity = FieldValue.increment(-Number(data.availableQuantity.decrement));
        } else if (typeof data.availableQuantity === 'object' && data.availableQuantity.increment !== undefined) {
          updateData.availableQuantity = FieldValue.increment(Number(data.availableQuantity.increment));
        } else {
          updateData.availableQuantity = Number(data.availableQuantity);
        }
      }
      if (data.orderingDeadline !== undefined) updateData.orderingDeadline = data.orderingDeadline;
      if (data.maxQuantity !== undefined) updateData.maxQuantity = data.maxQuantity;
      if (data.isActive !== undefined) updateData.isActive = data.isActive;

      await ref.set(updateData, { merge: true });
      return docData(await ref.get());
    },
    updateMany: async ({ where, data }: any): Promise<any> => {
      let query: Query = db.collection('menus');
      if (where.mealId) query = query.where('mealId', '==', where.mealId);
      if (where.date) query = query.where('date', '==', where.date);
      const snap = await query.get();

      if (snap.empty) return { count: 0 };

      const batch = db.batch();
      for (const d of snap.docs) {
        const updateData: any = { updatedAt: new Date().toISOString() };
        if (typeof data.availableQuantity === 'object' && data.availableQuantity.increment !== undefined) {
          updateData.availableQuantity = FieldValue.increment(Number(data.availableQuantity.increment));
        } else if (typeof data.availableQuantity === 'object' && data.availableQuantity.decrement !== undefined) {
          updateData.availableQuantity = FieldValue.increment(-Number(data.availableQuantity.decrement));
        } else if (data.availableQuantity !== undefined) {
          updateData.availableQuantity = Number(data.availableQuantity);
        }
        if (data.isActive !== undefined) updateData.isActive = data.isActive;
        batch.set(d.ref, updateData, { merge: true });
      }
      await batch.commit();
      return { count: snap.docs.length };
    },
    delete: async ({ where }: any): Promise<any> => {
      await db.collection('menus').doc(where.id).delete();
      return { id: where.id };
    },
    deleteMany: async (): Promise<any> => {
      const snap = await db.collection('menus').get();
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      return { count: snap.docs.length };
    },
  };

  // Order
  order = {
    findMany: async ({ where, include, orderBy, take }: any = {}): Promise<DbOrder[]> => {
      let orders: any[] = [];

      if (where?.id && typeof where.id === 'string') {
        const snap = await db.collection('orders').doc(where.id).get();
        if (snap.exists) {
          orders = [docData(snap)];
        }
      } else if (where?.id?.in && Array.isArray(where.id.in)) {
        const map = await batchGetDocs('orders', where.id.in);
        orders = Array.from(map.values());
      } else {
        let query: Query = db.collection('orders');
        if (where?.parentId) {
          query = query.where('parentId', '==', where.parentId);
        }
        if (where?.orderStatus) {
          if (typeof where.orderStatus === 'string') {
            query = query.where('orderStatus', '==', where.orderStatus);
          } else if (Array.isArray(where.orderStatus?.in) && where.orderStatus.in.length > 0 && where.orderStatus.in.length <= 10) {
            query = query.where('orderStatus', 'in', where.orderStatus.in);
          }
        }
        if (where?.paymentStatus) {
          if (typeof where.paymentStatus === 'string') {
            query = query.where('paymentStatus', '==', where.paymentStatus);
          } else if (Array.isArray(where.paymentStatus?.in) && where.paymentStatus.in.length > 0 && where.paymentStatus.in.length <= 10) {
            query = query.where('paymentStatus', 'in', where.paymentStatus.in);
          }
        }
        const snap = await query.get();
        orders = snap.docs.map((d) => docData(d));
      }

      // Comprehensive in-memory filtering: ensures paid-only queries do not leak unpaid/pending/failed orders
      if (where?.parentId) {
        orders = orders.filter((o) => o.parentId === where.parentId);
      }
      if (where?.orderStatus) {
        if (typeof where.orderStatus === 'string') {
          orders = orders.filter((o) => o.orderStatus === where.orderStatus);
        } else if (Array.isArray(where.orderStatus?.in)) {
          orders = orders.filter((o) => where.orderStatus.in.includes(o.orderStatus));
        } else if (where.orderStatus?.not) {
          orders = orders.filter((o) => o.orderStatus !== where.orderStatus.not);
        }
      }
      if (where?.paymentStatus) {
        if (typeof where.paymentStatus === 'string') {
          orders = orders.filter((o) => o.paymentStatus === where.paymentStatus);
        } else if (Array.isArray(where.paymentStatus?.in)) {
          orders = orders.filter((o) => where.paymentStatus.in.includes(o.paymentStatus));
        } else if (where.paymentStatus?.not) {
          orders = orders.filter((o) => o.paymentStatus !== where.paymentStatus.not);
        }
      }

      if (orderBy?.createdAt === 'desc') {
        orders.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }

      if (take && typeof take === 'number') {
        orders = orders.slice(0, take);
      }

      const orderIds = orders.map((o) => o.id);

      if (orderIds.length > 0) {
        const [allItems, allPayments, parentsMap] = await Promise.all([
          include?.items ? queryInChunks<any>('orderItems', 'orderId', orderIds) : Promise.resolve([]),
          include?.payments ? queryInChunks<any>('payments', 'orderId', orderIds) : Promise.resolve([]),
          include?.parent ? batchGetDocs('parents', orders.map((o) => o.parentId)) : Promise.resolve(new Map()),
        ]);

        let studentsMap = new Map<string, any>();
        let mealsMap = new Map<string, any>();
        if (include?.items?.include && allItems.length > 0) {
          const [sMap, mMap] = await Promise.all([
            include.items.include.student ? batchGetDocs('students', allItems.map((it) => it.studentId)) : Promise.resolve(new Map()),
            include.items.include.meal ? batchGetDocs('meals', allItems.map((it) => it.mealId)) : Promise.resolve(new Map()),
          ]);
          studentsMap = sMap;
          mealsMap = mMap;
        }

        let usersMap = new Map<string, any>();
        if (include?.parent?.include?.user && parentsMap.size > 0) {
          const userIds = Array.from(parentsMap.values()).map((p: any) => p?.userId).filter(Boolean);
          usersMap = await batchGetDocs('users', userIds);
          for (const p of parentsMap.values()) {
            if (p && p.userId) p.user = usersMap.get(p.userId) || null;
          }
        }

        if (include?.items) {
          const itemsByOrderId = new Map<string, any[]>();
          for (const item of allItems) {
            if (include.items.include?.student) {
              item.student = studentsMap.get(item.studentId) || null;
            }
            if (include.items.include?.meal) {
              item.meal = mealsMap.get(item.mealId) || null;
            }
            const l = itemsByOrderId.get(item.orderId) || [];
            l.push(item);
            itemsByOrderId.set(item.orderId, l);
          }
          for (const ord of orders) {
            ord.items = itemsByOrderId.get(ord.id) || [];
          }
        }

        if (include?.payments) {
          const paymentsByOrderId = new Map<string, any[]>();
          for (const p of allPayments) {
            const l = paymentsByOrderId.get(p.orderId) || [];
            l.push(p);
            paymentsByOrderId.set(p.orderId, l);
          }
          for (const ord of orders) {
            ord.payments = paymentsByOrderId.get(ord.id) || [];
          }
        }

        if (include?.parent) {
          for (const ord of orders) {
            ord.parent = parentsMap.get(ord.parentId) || null;
          }
        }
      }

      return orders;
    },
    findUnique: async ({ where, include }: any): Promise<DbOrder | null> => {
      const snap = await db.collection('orders').doc(where.id).get();
      const ord = docData(snap);
      if (!ord) return null;

      if (include?.items) {
        const itemsSnap = await db.collection('orderItems').where('orderId', '==', ord.id).get();
        const items = itemsSnap.docs.map((d) => docData(d));
        if (items.length > 0 && include.items.include) {
          const [studentsMap, mealsMap] = await Promise.all([
            include.items.include.student ? batchGetDocs('students', items.map((it) => it.studentId)) : Promise.resolve(new Map()),
            include.items.include.meal ? batchGetDocs('meals', items.map((it) => it.mealId)) : Promise.resolve(new Map()),
          ]);
          for (const item of items) {
            if (include.items.include?.student) {
              item.student = studentsMap.get(item.studentId) || null;
            }
            if (include.items.include?.meal) {
              item.meal = mealsMap.get(item.mealId) || null;
            }
          }
        }
        ord.items = items;
      }

      if (include?.payments) {
        const paySnap = await db.collection('payments').where('orderId', '==', ord.id).get();
        ord.payments = paySnap.docs.map((d) => docData(d));
      }

      if (include?.parent) {
        const pSnap = await db.collection('parents').doc(ord.parentId).get();
        const parentData = docData(pSnap);
        if (parentData && include.parent.include?.user) {
          const uSnap = await db.collection('users').doc(parentData.userId).get();
          parentData.user = docData(uSnap);
        }
        ord.parent = parentData;
      }

      return ord;
    },
    findFirst: async ({ where, include }: any): Promise<DbOrder | null> => {
      let ord: any = null;
      if (where.id) {
        const snap = await db.collection('orders').doc(where.id).get();
        if (snap.exists) {
          const candidate = docData(snap);
          if (
            (!where.parentId || candidate.parentId === where.parentId) &&
            (!where.paymentStatus || candidate.paymentStatus === where.paymentStatus) &&
            (!where.orderStatus || candidate.orderStatus === where.orderStatus)
          ) {
            ord = candidate;
          }
        }
      } else if (where.parentId) {
        let query: Query = db.collection('orders').where('parentId', '==', where.parentId);
        if (where.orderStatus) query = query.where('orderStatus', '==', where.orderStatus);
        if (where.paymentStatus) query = query.where('paymentStatus', '==', where.paymentStatus);
        const snap = await query.limit(1).get();
        if (!snap.empty) ord = docData(snap.docs[0]);
      } else {
        let query: Query = db.collection('orders');
        if (where.orderStatus) query = query.where('orderStatus', '==', where.orderStatus);
        if (where.paymentStatus) query = query.where('paymentStatus', '==', where.paymentStatus);
        const snap = await query.limit(1).get();
        if (!snap.empty) ord = docData(snap.docs[0]);
      }

      if (!ord) return null;

      if (include?.items) {
        const itemsSnap = await db.collection('orderItems').where('orderId', '==', ord.id).get();
        ord.items = itemsSnap.docs.map((d) => docData(d));
      }

      if (include?.payments) {
        const paySnap = await db.collection('payments').where('orderId', '==', ord.id).get();
        ord.payments = paySnap.docs.map((d) => docData(d));
      }

      return ord;
    },
    create: async ({ data, include }: any): Promise<DbOrder> => {
      const orderId = data.id || generateId('ORD-');
      const now = new Date().toISOString();
      const { items: itemsCreate, payments: paymentsCreate, ...orderFields } = data;

      const orderObj = cleanDoc({
        id: orderId,
        ...orderFields,
        createdAt: now,
        updatedAt: now,
      });

      const batch = db.batch();
      batch.set(db.collection('orders').doc(orderId), orderObj);

      const createdItems = [];
      if (itemsCreate?.create) {
        for (const item of itemsCreate.create) {
          const itemId = generateId('oit_');
          const itemObj = cleanDoc({
            id: itemId,
            orderId,
            ...item,
            createdAt: now,
          });
          batch.set(db.collection('orderItems').doc(itemId), itemObj);
          createdItems.push(itemObj);
        }
      }

      const createdPayments = [];
      if (paymentsCreate?.create) {
        const payList = Array.isArray(paymentsCreate.create) ? paymentsCreate.create : [paymentsCreate.create];
        for (const pay of payList) {
          const payId = pay.id || generateId('PAY-');
          const payObj = cleanDoc({
            id: payId,
            orderId,
            ...pay,
            createdAt: now,
          });
          batch.set(db.collection('payments').doc(payId), payObj);
          createdPayments.push(payObj);
        }
      }

      await batch.commit();

      const res: any = { ...orderObj };
      if (include?.items) res.items = createdItems;
      if (include?.payments) res.payments = createdPayments;
      return res;
    },
    upsert: async ({ where, update, create }: any): Promise<DbOrder> => {
      const ref = db.collection('orders').doc(where.id);
      const snap = await ref.get();
      if (snap.exists) {
        await ref.set(update, { merge: true });
      } else {
        await ref.set({ id: where.id, ...create });
      }
      return docData(await ref.get());
    },
    update: async ({ where, data }: any): Promise<DbOrder> => {
      const ref = db.collection('orders').doc(where.id);
      const now = new Date().toISOString();
      await ref.set({ ...data, updatedAt: now }, { merge: true });
      return docData(await ref.get());
    },
    updateMany: async ({ where, data }: any): Promise<any> => {
      if (where?.id?.in && Array.isArray(where.id.in) && where.id.in.length > 0) {
        const ids: string[] = where.id.in;
        const now = new Date().toISOString();
        const batch = db.batch();
        for (const id of ids) {
          batch.set(db.collection('orders').doc(id), { ...data, updatedAt: now }, { merge: true });
        }
        await batch.commit();
        return { count: ids.length };
      }
      return { count: 0 };
    },
    count: async ({ where }: any = {}): Promise<number> => {
      let query: Query = db.collection('orders');
      if (where?.orderStatus) {
        query = query.where('orderStatus', '==', where.orderStatus);
      }
      const snap = await query.count().get();
      return snap.data().count;
    },
    deleteMany: async (): Promise<any> => {
      const snap = await db.collection('orders').get();
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      return { count: snap.docs.length };
    },
  };

  // OrderItem
  orderItem = {
    findMany: async ({ where, include, orderBy }: any = {}): Promise<DbOrderItem[]> => {
      let query: Query = db.collection('orderItems');
      if (where?.orderId) query = query.where('orderId', '==', where.orderId);
      if (where?.date) query = query.where('date', '==', where.date);

      const snap = await query.get();
      let items = snap.docs.map((d) => docData(d));

      if (where?.order?.orderStatus?.in || where?.order?.orderStatus?.not) {
        const orderIds = items.map((it) => it.orderId);
        const ordersMap = await batchGetDocs('orders', orderIds);
        items = items.filter((item) => {
          const ord = ordersMap.get(item.orderId);
          if (!ord) return false;
          item.order = ord;
          if (where.order.orderStatus.in && !where.order.orderStatus.in.includes(ord.orderStatus)) return false;
          if (where.order.orderStatus.not && ord.orderStatus === where.order.orderStatus.not) return false;
          return true;
        });
      }

      if (include && items.length > 0) {
        const mealIds = items.map((it) => it.mealId);
        const studentIds = items.map((it) => it.studentId);
        const orderIds = items.map((it) => it.orderId);

        const [mealsMap, studentsMap, ordersMap] = await Promise.all([
          include.meal ? batchGetDocs('meals', mealIds) : Promise.resolve(new Map()),
          include.student ? batchGetDocs('students', studentIds) : Promise.resolve(new Map()),
          include.order ? batchGetDocs('orders', orderIds) : Promise.resolve(new Map()),
        ]);

        let studentAllergiesMap = new Map<string, any[]>();
        if (include.student?.include?.studentAllergies && studentsMap.size > 0) {
          const allStudentAllergies = await queryInChunks<any>('studentAllergies', 'studentId', Array.from(studentsMap.keys()));
          const allergyIds = allStudentAllergies.map((sa) => sa.allergyId);
          const allergiesMap = await batchGetDocs('allergies', allergyIds);

          for (const sa of allStudentAllergies) {
            sa.allergy = allergiesMap.get(sa.allergyId) || null;
            const l = studentAllergiesMap.get(sa.studentId) || [];
            l.push(sa);
            studentAllergiesMap.set(sa.studentId, l);
          }
        }

        let parentsMap = new Map<string, any>();
        let usersMap = new Map<string, any>();
        if (include.order?.include?.parent) {
          const allOrderObjs = Array.from(ordersMap.values()).concat(items.map((it) => it.order).filter(Boolean));
          const parentIds = allOrderObjs.map((o: any) => o?.parentId).filter(Boolean);
          parentsMap = await batchGetDocs('parents', parentIds);
          if (include.order.include.parent.include?.user) {
            const userIds = Array.from(parentsMap.values()).map((p: any) => p?.userId).filter(Boolean);
            usersMap = await batchGetDocs('users', userIds);
            for (const p of parentsMap.values()) {
              if (p && p.userId) p.user = usersMap.get(p.userId) || null;
            }
          }
        }

        for (const item of items) {
          if (include.meal) {
            item.meal = mealsMap.get(item.mealId) || null;
          }
          if (include.student) {
            const st = studentsMap.get(item.studentId) || null;
            if (st && include.student?.include?.studentAllergies) {
              st.studentAllergies = studentAllergiesMap.get(st.id) || [];
            }
            item.student = st;
          }
          if (include.order) {
            const ord = item.order || ordersMap.get(item.orderId) || null;
            if (ord && include.order.include?.parent) {
              ord.parent = parentsMap.get(ord.parentId) || null;
            }
            item.order = ord;
          }
        }
      }

      if (orderBy && Array.isArray(orderBy)) {
        items.sort((a, b) => {
          for (const rule of orderBy) {
            if (rule.student) {
              for (const [k, dir] of Object.entries(rule.student)) {
                const valA = String(a.student?.[k] || '');
                const valB = String(b.student?.[k] || '');
                const cmp = valA.localeCompare(valB, undefined, { numeric: true });
                if (cmp !== 0) return dir === 'desc' ? -cmp : cmp;
              }
            }
          }
          return 0;
        });
      }

      return items;
    },
    create: async ({ data }: any): Promise<DbOrderItem> => {
      const id = data.id || generateId('oit_');
      const now = new Date().toISOString();
      const obj = { id, ...data, createdAt: now };
      await db.collection('orderItems').doc(id).set(obj);
      return obj as any;
    },
    upsert: async ({ where, update, create }: any): Promise<DbOrderItem> => {
      const ref = db.collection('orderItems').doc(where.id);
      const snap = await ref.get();
      if (snap.exists) {
        await ref.set(update, { merge: true });
      } else {
        await ref.set({ id: where.id, ...create });
      }
      return docData(await ref.get());
    },
    count: async ({ where }: any = {}): Promise<number> => {
      const snap = await db.collection('orderItems').count().get();
      return snap.data().count;
    },
    deleteMany: async (): Promise<any> => {
      const snap = await db.collection('orderItems').get();
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      return { count: snap.docs.length };
    },
  };

  // Payment
  payment = {
    findMany: async ({ where, include, orderBy }: any = {}): Promise<DbPayment[]> => {
      let query: Query = db.collection('payments');
      if (where?.orderId) query = query.where('orderId', '==', where.orderId);
      const snap = await query.get();
      let list = snap.docs.map((d) => docData(d));

      if ((where?.order?.parentId || include?.order) && list.length > 0) {
        const orderIds = list.map((p) => p.orderId);
        const ordersMap = await batchGetDocs('orders', orderIds);

        if (where?.order?.parentId) {
          const targetParentId = where.order.parentId;
          list = list.filter((p) => {
            const ord = ordersMap.get(p.orderId);
            if (ord && ord.parentId === targetParentId) {
              p.order = ord;
              return true;
            }
            return false;
          });
        }

        if (include?.order) {
          for (const p of list) {
            if (!p.order) {
              p.order = ordersMap.get(p.orderId) || null;
            }
          }
        }
      }

      if (orderBy?.createdAt === 'desc') {
        list.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      }

      return list;
    },
    create: async ({ data }: any): Promise<DbPayment> => {
      const id = data.id || generateId('PAY-');
      const now = new Date().toISOString();
      const obj = { id, ...data, createdAt: now };
      await db.collection('payments').doc(id).set(obj);
      return obj;
    },
    upsert: async ({ where, update, create }: any): Promise<DbPayment> => {
      const ref = db.collection('payments').doc(where.id);
      const snap = await ref.get();
      if (snap.exists) {
        await ref.set(update, { merge: true });
      } else {
        await ref.set({ id: where.id, ...create });
      }
      return docData(await ref.get());
    },
    deleteMany: async (): Promise<any> => {
      const snap = await db.collection('payments').get();
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      return { count: snap.docs.length };
    },
  };

  // $disconnect for compatibility
  $disconnect = async (): Promise<void> => {};

  // $transaction for Prisma compatibility
  $transaction = async (callback: (tx: this) => Promise<any>): Promise<any> => {
    return callback(this);
  };

  // Real atomic Firestore transaction
  runTransaction = async <T>(updateFunction: (transaction: Transaction) => Promise<T>): Promise<T> => {
    return db.runTransaction(updateFunction);
  };
}

export const firestoreDb = new FirestoreDbAdapter();
export default firestoreDb;
