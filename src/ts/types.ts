export type Timing = 'morning' | 'out' | 'night';

/** users/{uid}/items/{id} 毎日のチェック項目 */
export interface CareItem {
  id: string;
  title: string;
  timing: Timing;
  createdAt: number;
}

/** users/{uid}/periodic/{id} 数日〜数週間おきのケア */
export interface PeriodicItem {
  id: string;
  title: string;
  intervalDays: number;
  /** 最後にやった日（YYYY-MM-DD）。未記録なら null */
  lastDone: string | null;
  createdAt: number;
}

/** users/{uid}/days/{YYYY-MM-DD} */
export interface DayLog {
  date: string;
  /** チェックした項目ID */
  done: Set<string>;
  /** 記録時点の項目数（過去日の達成率計算用） */
  total: number;
}
