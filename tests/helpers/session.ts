import { createSessionToken } from '../../lib/auth';
import { setFirestoreForTesting } from '../../lib/firebase-admin';
import { invalidateStaticCache } from '../../lib/firestore-db';
import { FakeFirestore } from './fake-firestore';

/** Routes the app's database to a fresh in-memory Firestore (and drops cached reads). */
export function useFakeFirestore(): FakeFirestore {
  const fs = new FakeFirestore();
  setFirestoreForTesting(fs.asFirestore());
  invalidateStaticCache();
  return fs;
}

type Role = 'PARENT' | 'STAFF' | 'ADMIN';

/** Seeds a user in the fake database and returns a Bearer header carrying a valid session for it. */
export async function signedInAs(fs: FakeFirestore, role: Role, id = `usr_${role.toLowerCase()}`) {
  fs.seed('users', id, { id, email: `${id}@example.com`, name: role, role });
  if (role === 'PARENT') fs.seed('parents', `par_${id}`, { id: `par_${id}`, userId: id });
  const token = await createSessionToken({ userId: id, email: `${id}@example.com`, name: role, role });
  return { authorization: `Bearer ${token}` };
}

export function jsonRequest(url: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:3000${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
