import { addDays, parseKey, todayKey } from './dates';
import { ACHIEVE_RATE, SOON_DAYS } from './templates';
import { DayLog, PeriodicItem } from './types';

/** その日のチェック率（0〜1）。今日は現在の項目数で、過去日は記録時点の項目数で計算する */
export function rateOf(day: DayLog | undefined, liveTotal: number | null): number {
  if (!day) return 0;
  const total = liveTotal ?? day.total;
  if (total <= 0) return 0;
  return Math.min(1, day.done.size / total);
}

export const isAchieved = (rate: number): boolean => rate >= ACHIEVE_RATE - 1e-9;

/** 今日（未達成なら昨日）からさかのぼった「ととのった日」の連続日数 */
export function currentStreak(achieved: (key: string) => boolean): number {
  let key = todayKey();
  if (!achieved(key)) key = addDays(key, -1);
  let n = 0;
  while (achieved(key) && n < 3650) {
    n++;
    key = addDays(key, -1);
  }
  return n;
}

/** 記録のある日から最長の連続日数を求める */
export function bestStreak(keys: string[], achieved: (key: string) => boolean): number {
  const sorted = keys.filter(achieved).sort();
  let best = 0;
  let run = 0;
  let prev = '';
  sorted.forEach((k) => {
    run = prev && addDays(prev, 1) === k ? run + 1 : 1;
    best = Math.max(best, run);
    prev = k;
  });
  return best;
}

export const daysBetween = (from: string, to: string): number =>
  Math.round((parseKey(to).getTime() - parseKey(from).getTime()) / 86400000);

export type PeriodicStatus = 'none' | 'ok' | 'soon' | 'over';

export interface PeriodicInfo {
  status: PeriodicStatus;
  /** 次回目安までの残り日数（マイナスは超過） */
  remain: number;
  elapsed: number;
  nextKey: string | null;
}

export function periodicInfo(item: PeriodicItem, today = todayKey()): PeriodicInfo {
  if (!item.lastDone) return { status: 'none', remain: 0, elapsed: 0, nextKey: null };
  const elapsed = daysBetween(item.lastDone, today);
  const remain = item.intervalDays - elapsed;
  const status: PeriodicStatus = remain < 0 ? 'over' : remain <= SOON_DAYS ? 'soon' : 'ok';
  return { status, remain, elapsed, nextKey: addDays(item.lastDone, item.intervalDays) };
}

const STATUS_ORDER: Record<PeriodicStatus, number> = { over: 0, soon: 1, none: 2, ok: 3 };

/** 急ぐ順（超過 → そろそろ → 未記録 → 余裕あり） */
export function sortPeriodic(items: PeriodicItem[]): PeriodicItem[] {
  return items
    .map((it) => ({ it, info: periodicInfo(it) }))
    .sort((a, b) => STATUS_ORDER[a.info.status] - STATUS_ORDER[b.info.status]
      || a.info.remain - b.info.remain
      || a.it.createdAt - b.it.createdAt)
    .map((x) => x.it);
}
