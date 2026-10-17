import {
  collection, doc, onSnapshot, setDoc, addDoc, updateDoc, deleteDoc, deleteField,
  serverTimestamp, writeBatch, Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { isTiming } from './templates';
import { CareItem, DayLog, PeriodicItem, Timing } from './types';

type ErrorHandler = (err: Error) => void;

const toMillis = (v: unknown): number => (v instanceof Timestamp ? v.toMillis() : Date.now());
const isDateKey = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

// ===== 毎日のチェック項目 =====
export function subscribeItems(uid: string, onData: (items: CareItem[]) => void, onError: ErrorHandler): () => void {
  return onSnapshot(collection(db, 'users', uid, 'items'), (snap) => {
    const list: CareItem[] = [];
    snap.forEach((d) => {
      const data = d.data();
      if (typeof data.title !== 'string' || !isTiming(data.timing)) return;
      list.push({ id: d.id, title: data.title, timing: data.timing, createdAt: toMillis(data.createdAt) });
    });
    list.sort((a, b) => a.createdAt - b.createdAt);
    onData(list);
  }, onError);
}

export async function createItem(uid: string, title: string, timing: Timing): Promise<void> {
  await addDoc(collection(db, 'users', uid, 'items'), { title, timing, createdAt: serverTimestamp() });
}

export function updateItem(uid: string, id: string, title: string, timing: Timing): Promise<void> {
  return updateDoc(doc(db, 'users', uid, 'items', id), { title, timing });
}

export function deleteItem(uid: string, id: string): Promise<void> {
  return deleteDoc(doc(db, 'users', uid, 'items', id));
}

// ===== 周期ケア =====
export function subscribePeriodic(uid: string, onData: (items: PeriodicItem[]) => void, onError: ErrorHandler): () => void {
  return onSnapshot(collection(db, 'users', uid, 'periodic'), (snap) => {
    const list: PeriodicItem[] = [];
    snap.forEach((d) => {
      const data = d.data();
      const interval = Number(data.intervalDays);
      if (typeof data.title !== 'string' || !Number.isFinite(interval) || interval < 1) return;
      list.push({
        id: d.id,
        title: data.title,
        intervalDays: Math.floor(interval),
        lastDone: isDateKey(data.lastDone) ? data.lastDone : null,
        createdAt: toMillis(data.createdAt),
      });
    });
    onData(list);
  }, onError);
}

export async function createPeriodic(uid: string, title: string, intervalDays: number, lastDone: string | null): Promise<void> {
  await addDoc(collection(db, 'users', uid, 'periodic'), { title, intervalDays, lastDone, createdAt: serverTimestamp() });
}

export function updatePeriodic(uid: string, id: string, title: string, intervalDays: number, lastDone: string | null): Promise<void> {
  return updateDoc(doc(db, 'users', uid, 'periodic', id), { title, intervalDays, lastDone });
}

export function markPeriodicDone(uid: string, id: string, date: string): Promise<void> {
  return updateDoc(doc(db, 'users', uid, 'periodic', id), { lastDone: date });
}

export function deletePeriodic(uid: string, id: string): Promise<void> {
  return deleteDoc(doc(db, 'users', uid, 'periodic', id));
}

// ===== 日ごとの記録 =====
export function subscribeDays(uid: string, onData: (days: Map<string, DayLog>) => void, onError: ErrorHandler): () => void {
  return onSnapshot(collection(db, 'users', uid, 'days'), (snap) => {
    const map = new Map<string, DayLog>();
    snap.forEach((d) => {
      const data = d.data();
      const done = new Set<string>();
      if (data.done && typeof data.done === 'object') {
        Object.entries(data.done as Record<string, unknown>).forEach(([k, v]) => {
          if (v === true) done.add(k);
        });
      }
      const total = typeof data.total === 'number' && data.total > 0 ? Math.floor(data.total) : 0;
      map.set(d.id, { date: d.id, done, total });
    });
    onData(map);
  }, onError);
}

/** その日の項目のチェックを付け外しする。total は記録時点の項目数 */
export function setCheck(uid: string, date: string, itemId: string, on: boolean, total: number): Promise<void> {
  return setDoc(doc(db, 'users', uid, 'days', date), {
    done: { [itemId]: on ? true : deleteField() },
    total,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

// ===== テンプレート投入 =====
export async function seedTemplates(
  uid: string,
  items: { title: string; timing: Timing }[],
  periodic: { title: string; intervalDays: number }[],
): Promise<void> {
  const batch = writeBatch(db);
  // createdAt の並び順を保つため、1ms ずつずらしたクライアント時刻で入れる
  const base = Date.now();
  items.forEach((it, i) => {
    batch.set(doc(collection(db, 'users', uid, 'items')), {
      title: it.title, timing: it.timing, createdAt: Timestamp.fromMillis(base + i),
    });
  });
  periodic.forEach((p, i) => {
    batch.set(doc(collection(db, 'users', uid, 'periodic')), {
      title: p.title, intervalDays: p.intervalDays, lastDone: null, createdAt: Timestamp.fromMillis(base + i),
    });
  });
  await batch.commit();
}
