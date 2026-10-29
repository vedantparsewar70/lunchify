import type { Firestore } from 'firebase-admin/firestore';

type Data = Record<string, any>;

/**
 * Minimal in-memory Firestore for tests. Mirrors the behaviours the payment code relies on:
 * - a transaction that reads after writing throws (as the real SDK does);
 * - transactions retry when a document or queried collection they read was committed by
 *   someone else in the meantime (optimistic concurrency);
 * - update() of a missing document fails.
 */
export class FakeFirestore {
  private collections = new Map<string, Map<string, { data: Data; version: number }>>();
  private collectionVersions = new Map<string, number>();
  private clock = 0;
  transactionAttempts = 0;

  collection(name: string) {
    return new FakeCollection(this, name);
  }

  asFirestore(): Firestore {
    return this as unknown as Firestore;
  }

  seed(collection: string, id: string, data: Data) {
    this.write(collection, id, { ...data });
  }

  getDoc(collection: string, id: string): Data | undefined {
    const entry = this.collections.get(collection)?.get(id);
    return entry ? structuredClone(entry.data) : undefined;
  }

  list(collection: string): Data[] {
    return Array.from(this.collections.get(collection)?.values() || []).map((e) => structuredClone(e.data));
  }

  /** @internal */
  read(collection: string, id: string) {
    return this.collections.get(collection)?.get(id);
  }

  /** @internal */
  docsOf(collection: string) {
    return Array.from(this.collections.get(collection)?.entries() || []);
  }

  /** @internal */
  collectionVersion(collection: string) {
    return this.collectionVersions.get(collection) || 0;
  }

  /** @internal */
  write(collection: string, id: string, data: Data | null) {
    const version = ++this.clock;
    if (!this.collections.has(collection)) this.collections.set(collection, new Map());
    if (data === null) {
      this.collections.get(collection)!.delete(id);
    } else {
      this.collections.get(collection)!.set(id, { data: structuredClone(data), version });
    }
    this.collectionVersions.set(collection, version);
  }

  async runTransaction<T>(fn: (tx: FakeTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 10; attempt++) {
      this.transactionAttempts++;
      const tx = new FakeTransaction(this);
      const result = await fn(tx);
      // Commit atomically (no awaits between conflict check and apply).
      if (tx.hasConflict()) continue;
      tx.apply();
      return result;
    }
    throw new Error('Transaction failed: too much contention');
  }
}

class FakeSnapshot {
  constructor(
    public id: string,
    public ref: FakeDocRef,
    private value: Data | undefined
  ) {}
  get exists() {
    return this.value !== undefined;
  }
  data() {
    return this.value === undefined ? undefined : structuredClone(this.value);
  }
}

class FakeDocRef {
  constructor(
    private store: FakeFirestore,
    public collectionName: string,
    public id: string
  ) {}
  get path() {
    return `${this.collectionName}/${this.id}`;
  }
  async get() {
    return new FakeSnapshot(this.id, this, this.store.read(this.collectionName, this.id)?.data);
  }
  async set(data: Data) {
    this.store.write(this.collectionName, this.id, data);
  }
  async update(data: Data) {
    const current = this.store.read(this.collectionName, this.id);
    if (!current) throw new Error(`5 NOT_FOUND: No document to update: ${this.path}`);
    this.store.write(this.collectionName, this.id, { ...current.data, ...data });
  }
  async delete() {
    this.store.write(this.collectionName, this.id, null);
  }
}

class FakeQuery {
  constructor(
    protected store: FakeFirestore,
    public collectionName: string,
    protected filters: [string, unknown][] = []
  ) {}
  where(field: string, op: string, value: unknown) {
    if (op !== '==') throw new Error(`FakeFirestore only supports '==' filters (got ${op})`);
    return new FakeQuery(this.store, this.collectionName, [...this.filters, [field, value]]);
  }
  limit(_count: number) {
    return this;
  }
  async get() {
    const docs = this.store
      .docsOf(this.collectionName)
      .filter(([, entry]) => this.filters.every(([field, value]) => entry.data[field] === value))
      .map(([id, entry]) => new FakeSnapshot(id, new FakeDocRef(this.store, this.collectionName, id), entry.data));
    return { docs, empty: docs.length === 0, size: docs.length };
  }
}

class FakeCollection extends FakeQuery {
  doc(id: string) {
    return new FakeDocRef(this.store, this.collectionName, id);
  }
}

type Write =
  | { kind: 'set'; ref: FakeDocRef; data: Data }
  | { kind: 'update'; ref: FakeDocRef; data: Data }
  | { kind: 'delete'; ref: FakeDocRef };

export class FakeTransaction {
  private writes: Write[] = [];
  private readDocs = new Map<string, { collection: string; id: string; version: number }>();
  private readCollections = new Map<string, number>();

  constructor(private store: FakeFirestore) {}

  async get(target: FakeDocRef | FakeQuery): Promise<any> {
    if (this.writes.length > 0) {
      throw new Error('Firestore transactions require all reads to be executed before all writes.');
    }
    if (target instanceof FakeDocRef) {
      const entry = this.store.read(target.collectionName, target.id);
      this.readDocs.set(target.path, { collection: target.collectionName, id: target.id, version: entry?.version ?? 0 });
      return target.get();
    }
    this.readCollections.set(target.collectionName, this.store.collectionVersion(target.collectionName));
    return target.get();
  }

  set(ref: FakeDocRef, data: Data) {
    this.writes.push({ kind: 'set', ref, data: structuredClone(data) });
    return this;
  }

  update(ref: FakeDocRef, data: Data) {
    this.writes.push({ kind: 'update', ref, data: structuredClone(data) });
    return this;
  }

  delete(ref: FakeDocRef) {
    this.writes.push({ kind: 'delete', ref });
    return this;
  }

  hasConflict(): boolean {
    for (const read of this.readDocs.values()) {
      if ((this.store.read(read.collection, read.id)?.version ?? 0) !== read.version) return true;
    }
    for (const [collection, version] of this.readCollections) {
      if (this.store.collectionVersion(collection) !== version) return true;
    }
    return false;
  }

  apply() {
    for (const w of this.writes) {
      if (w.kind === 'update' && !this.store.read(w.ref.collectionName, w.ref.id)) {
        throw new Error(`5 NOT_FOUND: No document to update: ${w.ref.path}`);
      }
    }
    for (const w of this.writes) {
      if (w.kind === 'set') this.store.write(w.ref.collectionName, w.ref.id, w.data);
      else if (w.kind === 'update') {
        const current = this.store.read(w.ref.collectionName, w.ref.id)!;
        this.store.write(w.ref.collectionName, w.ref.id, { ...current.data, ...w.data });
      } else this.store.write(w.ref.collectionName, w.ref.id, null);
    }
  }
}
