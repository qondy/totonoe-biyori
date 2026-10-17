import { User } from 'firebase/auth';
import { onAuthChange, loginWithGoogle, logout } from './auth';
import { showToast, openOverlay, closeOverlay, textEl, button } from './ui';
import { submitFeedback } from './feedback';
import { todayKey, dateKey, labelOf, daysInMonth, hashString, parseKey } from './dates';
import {
  TIMINGS, TIMING_LABEL, DEFAULT_ITEMS, DEFAULT_PERIODIC, INTERVAL_OPTIONS, TIPS, ACHIEVE_RATE,
} from './templates';
import {
  subscribeItems, createItem, updateItem, deleteItem,
  subscribePeriodic, createPeriodic, updatePeriodic, markPeriodicDone, deletePeriodic,
  subscribeDays, setCheck, seedTemplates,
} from './store';
import {
  rateOf, isAchieved, currentStreak, bestStreak, periodicInfo, sortPeriodic, PeriodicInfo,
} from './stats';
import { CareItem, DayLog, PeriodicItem, Timing } from './types';

// ============================================================
// DOM refs
// ============================================================
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const loginScreen = $('login-screen');
const appEl = $('app');
const userInfo = $('user-info');
const userAvatar = $<HTMLImageElement>('user-avatar');
const userName = $('user-name');
const btnGoogleLogin = $<HTMLButtonElement>('btn-google-login');
const btnLogout = $<HTMLButtonElement>('btn-logout');

const tabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.tabs__btn'));
const panels = Array.from(document.querySelectorAll<HTMLElement>('.panel'));
const countDue = $('count-due');

const todayDateEl = $('today-date');
const streakNum = $('streak-num');
const progressFill = $('progress-fill');
const progressText = $('progress-text');
const btnQuick = $<HTMLButtonElement>('btn-quick');
const tipText = $('tip-text');
const todayDue = $('today-due');
const todayDueList = $('today-due-list');
const todayGroups = $('today-groups');
const todayEmpty = $('today-empty');
const btnSeed = $<HTMLButtonElement>('btn-seed');

const periodicList = $('periodic-list');
const periodicEmpty = $('periodic-empty');

const statStreak = $('stat-streak');
const statBest = $('stat-best');
const statMonth = $('stat-month');
const statRate = $('stat-rate');
const calendarTitle = $('calendar-title');
const calendarGrid = $('calendar-grid');
const btnPrevMonth = $<HTMLButtonElement>('btn-prev-month');
const btnNextMonth = $<HTMLButtonElement>('btn-next-month');

const itemsGroups = $('items-groups');
const btnAddItemInline = $<HTMLButtonElement>('btn-add-item-inline');
const btnFab = $<HTMLButtonElement>('btn-fab');

const itemOverlay = $('item-modal-overlay');
const itemForm = $<HTMLFormElement>('item-form');
const itemModalTitle = $('item-modal-title');
const inputItemTitle = $<HTMLInputElement>('input-item-title');
const itemTiming = $('item-timing');
const btnItemSubmit = $<HTMLButtonElement>('btn-item-submit');

const periodicOverlay = $('periodic-modal-overlay');
const periodicForm = $<HTMLFormElement>('periodic-form');
const periodicModalTitle = $('periodic-modal-title');
const inputPeriodicTitle = $<HTMLInputElement>('input-periodic-title');
const periodicIntervals = $('periodic-intervals');
const inputPeriodicInterval = $<HTMLInputElement>('input-periodic-interval');
const inputPeriodicLast = $<HTMLInputElement>('input-periodic-last');
const btnPeriodicSubmit = $<HTMLButtonElement>('btn-periodic-submit');

const checkOverlay = $('check-modal-overlay');
const checkModalTitle = $('check-modal-title');
const checkModalSub = $('check-modal-sub');
const checkModalBody = $('check-modal-body');

const confirmOverlay = $('confirm-dialog-overlay');
const confirmTitle = $('confirm-dialog-title');
const confirmText = $('confirm-dialog-text');
const btnConfirmCancel = $<HTMLButtonElement>('btn-confirm-cancel');
const btnConfirmOk = $<HTMLButtonElement>('btn-confirm-ok');

const feedbackBtn = $<HTMLButtonElement>('feedback-btn');
const feedbackOverlay = $('feedback-modal-overlay');
const inputFeedbackMessage = $<HTMLTextAreaElement>('input-feedback-message');
const btnFeedbackClose = $<HTMLButtonElement>('btn-feedback-close');
const btnFeedbackSend = $<HTMLButtonElement>('btn-feedback-send');

// ============================================================
// State
// ============================================================
type Tab = 'today' | 'periodic' | 'record' | 'items';
/** チェックモーダルの中身：ある日の全項目 or 外出前クイック点検 */
type CheckMode = { kind: 'day'; date: string } | { kind: 'quick' };

interface State {
  uid: string | null;
  unsubscribes: (() => void)[];
  items: CareItem[];
  periodic: PeriodicItem[];
  days: Map<string, DayLog>;
  loaded: { items: boolean; periodic: boolean; days: boolean };
  tab: Tab;
  viewYear: number;
  viewMonth: number;
  editingItemId: string | null;
  itemTiming: Timing;
  editingPeriodicId: string | null;
  checkMode: CheckMode | null;
  pending: Set<string>;
  confirmAction: (() => Promise<void>) | null;
}

const now = new Date();
const state: State = {
  uid: null,
  unsubscribes: [],
  items: [],
  periodic: [],
  days: new Map(),
  loaded: { items: false, periodic: false, days: false },
  tab: 'today',
  viewYear: now.getFullYear(),
  viewMonth: now.getMonth(),
  editingItemId: null,
  itemTiming: 'morning',
  editingPeriodicId: null,
  checkMode: null,
  pending: new Set(),
  confirmAction: null,
};

// ============================================================
// Helpers
// ============================================================
const allLoaded = (): boolean => state.loaded.items && state.loaded.periodic && state.loaded.days;

const itemsOf = (timing: Timing): CareItem[] => state.items.filter((i) => i.timing === timing);

/** 今日は現在の項目数、過去日は記録時点の項目数でチェック率を出す */
function dayRate(key: string): number {
  const day = state.days.get(key);
  if (key === todayKey()) {
    if (!day || state.items.length === 0) return 0;
    const ids = new Set(state.items.map((i) => i.id));
    const done = Array.from(day.done).filter((id) => ids.has(id)).length;
    return Math.min(1, done / state.items.length);
  }
  return rateOf(day, null);
}

const achievedOn = (key: string): boolean => isAchieved(dayRate(key));

const isDone = (date: string, itemId: string): boolean => state.days.get(date)?.done.has(itemId) ?? false;

const dueCount = (): number =>
  state.periodic.filter((p) => {
    const s = periodicInfo(p).status;
    return s === 'soon' || s === 'over';
  }).length;

/** 同じキーの処理が進行中なら何もしない（二重送信防止） */
async function withLock(key: string, fn: () => Promise<void>, errorMessage = '保存に失敗しました。通信環境を確認してください'): Promise<boolean> {
  if (state.pending.has(key)) return false;
  state.pending.add(key);
  renderAll();
  try {
    await fn();
    return true;
  } catch (err) {
    console.error(err);
    showToast(errorMessage);
    return false;
  } finally {
    state.pending.delete(key);
    renderAll();
  }
}

function askConfirm(title: string, text: string, action: () => Promise<void>): void {
  confirmTitle.textContent = title;
  confirmText.textContent = text;
  state.confirmAction = action;
  openOverlay(confirmOverlay);
  btnConfirmCancel.focus();
}

function periodicLabel(info: PeriodicInfo, item: PeriodicItem): string {
  switch (info.status) {
    case 'none': return `${item.intervalDays}日おき・まだ記録がありません`;
    case 'over': return `${-info.remain}日過ぎています（前回から${info.elapsed}日）`;
    case 'soon': return info.remain === 0 ? '今日が目安です' : `あと${info.remain}日（そろそろ）`;
    default: return `あと${info.remain}日（前回から${info.elapsed}日）`;
  }
}

const shortDate = (key: string): string => {
  const d = parseKey(key);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

// ============================================================
// Check rows
// ============================================================
function checkRow(date: string, item: CareItem, large = false): HTMLElement {
  const done = isDone(date, item.id);
  const lockKey = `check:${date}:${item.id}`;
  const row = document.createElement('button');
  row.type = 'button';
  row.className = `check${done ? ' is-done' : ''}${large ? ' check--lg' : ''}`;
  row.setAttribute('role', 'checkbox');
  row.setAttribute('aria-checked', String(done));
  row.disabled = state.pending.has(lockKey);
  const box = document.createElement('span');
  box.className = 'check__box';
  box.setAttribute('aria-hidden', 'true');
  row.append(box, textEl('span', 'check__label', item.title));
  row.addEventListener('click', () => {
    const uid = state.uid;
    if (!uid) return;
    const before = achievedOn(date);
    void withLock(lockKey, () => setCheck(uid, date, item.id, !done, state.items.length)).then((ok) => {
      if (ok && !done && !before && achievedOn(date) && date === todayKey()) {
        showToast('今日はととのいました！');
      }
    });
  });
  return row;
}

function groupBlock(date: string, timing: Timing, list: CareItem[], large = false): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = `check-group check-group--${timing}`;
  const doneN = list.filter((i) => isDone(date, i.id)).length;
  const head = document.createElement('div');
  head.className = 'check-group__head';
  head.append(
    textEl('h3', 'check-group__title', TIMING_LABEL[timing]),
    textEl('span', 'check-group__count', `${doneN}/${list.length}`),
  );
  const body = document.createElement('div');
  body.className = 'check-group__list';
  list.forEach((it) => body.appendChild(checkRow(date, it, large)));
  wrap.append(head, body);
  return wrap;
}

// ============================================================
// Render
// ============================================================
function renderTabs(): void {
  tabButtons.forEach((b) => {
    const active = b.dataset.tab === state.tab;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-selected', String(active));
  });
  panels.forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== state.tab));
  btnFab.classList.toggle('hidden', state.tab === 'record');
  const n = dueCount();
  countDue.textContent = n > 0 ? String(n) : '';
}

function renderToday(): void {
  const today = todayKey();
  todayDateEl.textContent = labelOf(today);
  streakNum.textContent = String(currentStreak(achievedOn));
  tipText.textContent = TIPS[hashString(today) % TIPS.length];

  const total = state.items.length;
  const rate = dayRate(today);
  const doneN = Math.round(rate * total);
  progressFill.style.width = `${Math.round(rate * 100)}%`;
  progressFill.classList.toggle('is-achieved', isAchieved(rate));
  const need = Math.max(0, Math.ceil(total * ACHIEVE_RATE - 1e-9) - doneN);
  progressText.textContent = total === 0
    ? '項目を追加すると、ここに今日の進み具合が出ます'
    : isAchieved(rate)
      ? `${doneN}/${total} できました。今日はととのった日です`
      : `${doneN}/${total} できました。あと${need}つで「ととのった日」`;
  btnQuick.disabled = itemsOf('out').length === 0;

  // そろそろの周期ケア
  const due = sortPeriodic(state.periodic).filter((p) => {
    const s = periodicInfo(p).status;
    return s === 'soon' || s === 'over';
  });
  todayDue.classList.toggle('hidden', due.length === 0);
  todayDueList.replaceChildren(...due.map((p) => periodicRow(p, true)));

  // チェックリスト
  const showEmpty = allLoaded() && total === 0;
  todayEmpty.classList.toggle('hidden', !showEmpty);
  btnSeed.disabled = state.pending.has('seed');
  todayGroups.replaceChildren(...TIMINGS
    .map((t) => ({ t, list: itemsOf(t) }))
    .filter((g) => g.list.length > 0)
    .map((g) => groupBlock(today, g.t, g.list)));
}

function periodicRow(item: PeriodicItem, compact = false): HTMLElement {
  const info = periodicInfo(item);
  const row = document.createElement('div');
  row.className = `periodic periodic--${info.status}${compact ? ' periodic--compact' : ''}`;

  const main = document.createElement('div');
  main.className = 'periodic__main';
  main.appendChild(textEl('p', 'periodic__title', item.title));
  main.appendChild(textEl('p', 'periodic__status', periodicLabel(info, item)));
  if (!compact) {
    const meta = item.lastDone
      ? `${item.intervalDays}日おき・前回 ${shortDate(item.lastDone)}・次回目安 ${shortDate(info.nextKey ?? item.lastDone)}`
      : `${item.intervalDays}日おき`;
    main.appendChild(textEl('p', 'periodic__meta', meta));
  }

  if (!compact && info.status !== 'none') {
    const bar = document.createElement('div');
    bar.className = 'periodic__bar';
    const fill = document.createElement('div');
    fill.className = 'periodic__fill';
    fill.style.width = `${Math.min(100, Math.round((info.elapsed / item.intervalDays) * 100))}%`;
    bar.appendChild(fill);
    main.appendChild(bar);
  }

  const actions = document.createElement('div');
  actions.className = 'periodic__actions';
  const lockKey = `periodic:${item.id}`;
  const doneToday = item.lastDone === todayKey();
  const doneBtn = button(doneToday ? '今日やった' : 'やった', 'btn btn--primary btn--sm', () => {
    const uid = state.uid;
    if (!uid || doneToday) return;
    void withLock(lockKey, () => markPeriodicDone(uid, item.id, todayKey())).then((ok) => {
      if (ok) showToast(`「${item.title}」を記録しました。日付は「編集」から直せます`);
    });
  });
  doneBtn.disabled = doneToday || state.pending.has(lockKey);
  actions.appendChild(doneBtn);
  if (!compact) {
    actions.appendChild(button('編集', 'btn btn--ghost btn--sm', () => openPeriodicModal(item)));
  }
  row.append(main, actions);
  return row;
}

function renderPeriodic(): void {
  const list = sortPeriodic(state.periodic);
  periodicList.replaceChildren(...list.map((p) => periodicRow(p)));
  periodicEmpty.classList.toggle('hidden', !(state.loaded.periodic && list.length === 0));
}

function renderRecord(): void {
  const keys = Array.from(state.days.keys());
  statStreak.textContent = String(currentStreak(achievedOn));
  statBest.textContent = String(Math.max(bestStreak([...keys, todayKey()], achievedOn), currentStreak(achievedOn)));

  const { viewYear: y, viewMonth: m } = state;
  calendarTitle.textContent = `${y}年${m + 1}月`;
  const today = todayKey();
  const nDays = daysInMonth(y, m);
  const firstDow = new Date(y, m, 1).getDay();
  const cells: HTMLElement[] = [];
  for (let i = 0; i < firstDow; i++) {
    const blank = document.createElement('span');
    blank.className = 'calendar__cell is-blank';
    cells.push(blank);
  }
  let achievedDays = 0;
  let rateSum = 0;
  let countedDays = 0;
  for (let d = 1; d <= nDays; d++) {
    const key = dateKey(new Date(y, m, d));
    const rate = dayRate(key);
    const future = key > today;
    if (!future) {
      countedDays++;
      rateSum += rate;
      if (isAchieved(rate)) achievedDays++;
    }
    const level = rate <= 0 ? 0 : isAchieved(rate) ? 3 : rate >= 0.5 ? 2 : 1;
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = `calendar__cell lv--${level}${key === today ? ' is-today' : ''}`;
    cell.textContent = String(d);
    cell.disabled = future;
    cell.setAttribute('aria-label', `${labelOf(key)} チェック率${Math.round(rate * 100)}%`);
    cell.addEventListener('click', () => openCheckModal({ kind: 'day', date: key }));
    cells.push(cell);
  }
  calendarGrid.replaceChildren(...cells);
  const isCurrent = y === now.getFullYear() && m === now.getMonth();
  btnNextMonth.disabled = isCurrent || new Date(y, m + 1, 1) > new Date();
  statMonth.textContent = String(achievedDays);
  statRate.textContent = `${countedDays ? Math.round((rateSum / countedDays) * 100) : 0}%`;
}

function renderItems(): void {
  itemsGroups.replaceChildren(...TIMINGS.map((t) => {
    const wrap = document.createElement('div');
    wrap.className = `check-group item-group check-group--${t}`;
    const list = itemsOf(t);
    const head = document.createElement('div');
    head.className = 'check-group__head';
    head.append(
      textEl('h3', 'check-group__title', TIMING_LABEL[t]),
      button('＋ 追加', 'btn btn--ghost btn--sm', () => openItemModal(null, t)),
    );
    wrap.appendChild(head);
    if (list.length === 0) {
      wrap.appendChild(textEl('p', 'item-group__empty', 'まだ項目がありません'));
    }
    list.forEach((it) => {
      const row = document.createElement('div');
      row.className = 'item-row';
      row.appendChild(textEl('span', 'item-row__title', it.title));
      const actions = document.createElement('div');
      actions.className = 'item-row__actions';
      actions.append(
        button('編集', 'btn btn--ghost btn--sm', () => openItemModal(it)),
        button('削除', 'btn btn--ghost btn--sm is-danger', () => confirmDeleteItem(it)),
      );
      row.appendChild(actions);
      wrap.appendChild(row);
    });
    return wrap;
  }));
}

function renderCheckModal(): void {
  const mode = state.checkMode;
  if (!mode) return;
  if (mode.kind === 'quick') {
    const today = todayKey();
    const list = itemsOf('out');
    const doneN = list.filter((i) => isDone(today, i.id)).length;
    checkModalTitle.textContent = '外出前クイック点検';
    checkModalSub.textContent = list.length > 0 && doneN === list.length
      ? 'ばっちりです。いってらっしゃい！'
      : `鏡の前で上から順に確認しましょう（${doneN}/${list.length}）`;
    checkModalBody.replaceChildren(...list.map((it) => checkRow(today, it, true)));
    return;
  }
  const { date } = mode;
  checkModalTitle.textContent = labelOf(date);
  checkModalSub.textContent = `チェック率 ${Math.round(dayRate(date) * 100)}%${achievedOn(date) ? '・ととのった日' : ''}`;
  if (state.items.length === 0) {
    checkModalBody.replaceChildren(textEl('p', 'empty-state', 'チェック項目がありません。'));
    return;
  }
  checkModalBody.replaceChildren(...TIMINGS
    .map((t) => ({ t, list: itemsOf(t) }))
    .filter((g) => g.list.length > 0)
    .map((g) => groupBlock(date, g.t, g.list)));
}

function renderAll(): void {
  renderTabs();
  renderToday();
  renderPeriodic();
  renderRecord();
  renderItems();
  renderCheckModal();
}

// ============================================================
// Item modal
// ============================================================
function renderTimingSelect(): void {
  itemTiming.replaceChildren(...TIMINGS.map((t) => {
    const b = button(TIMING_LABEL[t], `segmented__btn${state.itemTiming === t ? ' is-active' : ''}`, () => {
      state.itemTiming = t;
      renderTimingSelect();
    });
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(state.itemTiming === t));
    return b;
  }));
}

function openItemModal(item: CareItem | null, timing?: Timing): void {
  state.editingItemId = item?.id ?? null;
  state.itemTiming = item?.timing ?? timing ?? 'morning';
  itemModalTitle.textContent = item ? '項目を編集' : '項目を追加';
  inputItemTitle.value = item?.title ?? '';
  renderTimingSelect();
  openOverlay(itemOverlay);
  inputItemTitle.focus();
}

function closeItemModal(): void {
  state.editingItemId = null;
  closeOverlay(itemOverlay);
}

itemForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const uid = state.uid;
  if (!uid) return;
  const title = inputItemTitle.value.trim();
  if (!title) {
    showToast('項目名を入力してください');
    inputItemTitle.focus();
    return;
  }
  if (btnItemSubmit.disabled) return;
  btnItemSubmit.disabled = true;
  const id = state.editingItemId;
  const timing = state.itemTiming;
  try {
    if (id) await updateItem(uid, id, title, timing);
    else await createItem(uid, title, timing);
    closeItemModal();
    showToast(id ? '項目を更新しました' : '項目を追加しました');
  } catch (err) {
    console.error(err);
    showToast('保存に失敗しました。通信環境を確認してください');
  } finally {
    btnItemSubmit.disabled = false;
  }
});

function confirmDeleteItem(item: CareItem): void {
  askConfirm('項目を削除しますか？', `「${item.title}」を削除します。これまでの記録の達成率はそのまま残ります。`, async () => {
    const uid = state.uid;
    if (!uid) return;
    const ok = await withLock(`item:${item.id}`, () => deleteItem(uid, item.id), '削除に失敗しました');
    if (ok) showToast('削除しました');
  });
}

// ============================================================
// Periodic modal
// ============================================================
function renderIntervalChips(): void {
  const current = Number(inputPeriodicInterval.value);
  periodicIntervals.replaceChildren(...INTERVAL_OPTIONS.map((n) =>
    button(`${n}日`, `chip${current === n ? ' is-active' : ''}`, () => {
      inputPeriodicInterval.value = String(n);
      renderIntervalChips();
    })));
}

let periodicDeleteBtn: HTMLButtonElement | null = null;

function openPeriodicModal(item: PeriodicItem | null): void {
  state.editingPeriodicId = item?.id ?? null;
  periodicModalTitle.textContent = item ? '周期ケアを編集' : '周期ケアを追加';
  inputPeriodicTitle.value = item?.title ?? '';
  inputPeriodicInterval.value = String(item?.intervalDays ?? 14);
  inputPeriodicLast.value = item?.lastDone ?? '';
  inputPeriodicLast.max = todayKey();
  renderIntervalChips();
  // 編集時のみ削除ボタンを出す
  periodicDeleteBtn?.remove();
  periodicDeleteBtn = null;
  if (item) {
    periodicDeleteBtn = button('削除', 'btn btn--ghost is-danger modal__delete', () => {
      closePeriodicModal();
      askConfirm('周期ケアを削除しますか？', `「${item.title}」を削除します。元に戻せません。`, async () => {
        const uid = state.uid;
        if (!uid) return;
        const ok = await withLock(`periodic:${item.id}`, () => deletePeriodic(uid, item.id), '削除に失敗しました');
        if (ok) showToast('削除しました');
      });
    });
    periodicForm.querySelector('.modal__actions')?.prepend(periodicDeleteBtn);
  }
  openOverlay(periodicOverlay);
  inputPeriodicTitle.focus();
}

function closePeriodicModal(): void {
  state.editingPeriodicId = null;
  closeOverlay(periodicOverlay);
}

inputPeriodicInterval.addEventListener('input', renderIntervalChips);

periodicForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const uid = state.uid;
  if (!uid) return;
  const title = inputPeriodicTitle.value.trim();
  const interval = Math.floor(Number(inputPeriodicInterval.value));
  const last = inputPeriodicLast.value;
  if (!title) {
    showToast('ケアの名前を入力してください');
    inputPeriodicTitle.focus();
    return;
  }
  if (!Number.isFinite(interval) || interval < 1 || interval > 365) {
    showToast('日数は1〜365で入力してください');
    inputPeriodicInterval.focus();
    return;
  }
  if (last && (!/^\d{4}-\d{2}-\d{2}$/.test(last) || last > todayKey())) {
    showToast('最後にやった日は今日以前の日付にしてください');
    return;
  }
  if (btnPeriodicSubmit.disabled) return;
  btnPeriodicSubmit.disabled = true;
  const id = state.editingPeriodicId;
  try {
    if (id) await updatePeriodic(uid, id, title, interval, last || null);
    else await createPeriodic(uid, title, interval, last || null);
    closePeriodicModal();
    showToast(id ? '更新しました' : '周期ケアを追加しました');
  } catch (err) {
    console.error(err);
    showToast('保存に失敗しました。通信環境を確認してください');
  } finally {
    btnPeriodicSubmit.disabled = false;
  }
});

// ============================================================
// Check modal
// ============================================================
function openCheckModal(mode: CheckMode): void {
  state.checkMode = mode;
  renderCheckModal();
  openOverlay(checkOverlay);
}

function closeCheckModal(): void {
  state.checkMode = null;
  closeOverlay(checkOverlay);
}

// ============================================================
// Events
// ============================================================
tabButtons.forEach((b) => b.addEventListener('click', () => {
  state.tab = (b.dataset.tab as Tab) ?? 'today';
  renderTabs();
  window.scrollTo({ top: 0 });
}));

btnFab.addEventListener('click', () => {
  if (state.tab === 'periodic') openPeriodicModal(null);
  else openItemModal(null);
});
btnAddItemInline.addEventListener('click', () => openItemModal(null));
btnQuick.addEventListener('click', () => openCheckModal({ kind: 'quick' }));

btnSeed.addEventListener('click', async () => {
  const uid = state.uid;
  if (!uid || state.items.length > 0) return;
  // 周期ケアがすでにあるなら、同じ名前のものは入れない
  const existing = new Set(state.periodic.map((p) => p.title));
  const periodic = DEFAULT_PERIODIC.filter((p) => !existing.has(p.title));
  const ok = await withLock('seed', () => seedTemplates(uid, DEFAULT_ITEMS, periodic));
  if (ok) showToast('おすすめの項目を追加しました。「項目」タブで編集できます');
});

function shiftMonth(delta: number): void {
  const d = new Date(state.viewYear, state.viewMonth + delta, 1);
  if (d > new Date()) return;
  state.viewYear = d.getFullYear();
  state.viewMonth = d.getMonth();
  renderRecord();
}
btnPrevMonth.addEventListener('click', () => shiftMonth(-1));
btnNextMonth.addEventListener('click', () => shiftMonth(1));

$('btn-item-close').addEventListener('click', closeItemModal);
$('btn-item-cancel').addEventListener('click', closeItemModal);
$('btn-periodic-close').addEventListener('click', closePeriodicModal);
$('btn-periodic-cancel').addEventListener('click', closePeriodicModal);
$('btn-check-close').addEventListener('click', closeCheckModal);
$('btn-check-done').addEventListener('click', closeCheckModal);

btnConfirmCancel.addEventListener('click', () => {
  state.confirmAction = null;
  closeOverlay(confirmOverlay);
});
btnConfirmOk.addEventListener('click', async () => {
  const action = state.confirmAction;
  state.confirmAction = null;
  closeOverlay(confirmOverlay);
  if (action) await action();
});

// 背景クリック・Escで閉じる（確認ダイアログを最優先）
const overlayClosers: [HTMLElement, () => void][] = [
  [confirmOverlay, () => { state.confirmAction = null; closeOverlay(confirmOverlay); }],
  [itemOverlay, closeItemModal],
  [periodicOverlay, closePeriodicModal],
  [checkOverlay, closeCheckModal],
  [feedbackOverlay, () => closeOverlay(feedbackOverlay)],
];
overlayClosers.forEach(([overlay, close]) => {
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = overlayClosers.find(([o]) => o.classList.contains('is-open'));
  if (open) open[1]();
});

// Feedback
feedbackBtn.addEventListener('click', () => {
  openOverlay(feedbackOverlay);
  inputFeedbackMessage.focus();
});
btnFeedbackClose.addEventListener('click', () => closeOverlay(feedbackOverlay));
btnFeedbackSend.addEventListener('click', async () => {
  const message = inputFeedbackMessage.value.trim();
  if (!message) {
    showToast('メッセージを入力してください');
    return;
  }
  if (btnFeedbackSend.disabled) return;
  btnFeedbackSend.disabled = true;
  btnFeedbackSend.textContent = '送信中…';
  const ok = await submitFeedback(message);
  btnFeedbackSend.disabled = false;
  btnFeedbackSend.textContent = '送信する';
  if (ok) {
    inputFeedbackMessage.value = '';
    closeOverlay(feedbackOverlay);
    showToast('送信しました。ありがとうございます！');
  } else {
    showToast('送信に失敗しました。時間をおいて再度お試しください');
  }
});

// 日付が変わったら表示を更新（開きっぱなし対策）
let lastDay = todayKey();
window.setInterval(() => {
  const t = todayKey();
  if (t !== lastDay) {
    lastDay = t;
    renderAll();
  }
}, 60000);

// ============================================================
// Auth
// ============================================================
btnGoogleLogin.addEventListener('click', async () => {
  if (btnGoogleLogin.disabled) return;
  btnGoogleLogin.disabled = true;
  try {
    await loginWithGoogle();
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
      console.error(err);
      showToast('ログインに失敗しました。もう一度お試しください');
    }
  } finally {
    btnGoogleLogin.disabled = false;
  }
});

btnLogout.addEventListener('click', async () => {
  try {
    await logout();
  } catch (err) {
    console.error(err);
    showToast('ログアウトに失敗しました');
  }
});

const onLoadError = (err: Error): void => {
  console.error(err);
  showToast('データの読み込みに失敗しました。再読み込みしてください');
};

function onLogin(user: User): void {
  state.uid = user.uid;
  loginScreen.classList.add('hidden');
  appEl.classList.remove('hidden');
  userInfo.classList.remove('hidden');
  userAvatar.src = user.photoURL ?? '';
  userAvatar.classList.toggle('hidden', !user.photoURL);
  userAvatar.alt = user.displayName ?? '';
  userName.textContent = user.displayName ?? '';
  state.unsubscribes = [
    subscribeItems(user.uid, (items) => {
      state.items = items;
      state.loaded.items = true;
      renderAll();
    }, onLoadError),
    subscribePeriodic(user.uid, (list) => {
      state.periodic = list;
      state.loaded.periodic = true;
      renderAll();
    }, onLoadError),
    subscribeDays(user.uid, (days) => {
      state.days = days;
      state.loaded.days = true;
      renderAll();
    }, onLoadError),
  ];
  renderAll();
}

function onLogout(): void {
  state.unsubscribes.forEach((u) => u());
  state.unsubscribes = [];
  state.uid = null;
  state.items = [];
  state.periodic = [];
  state.days = new Map();
  state.loaded = { items: false, periodic: false, days: false };
  [itemOverlay, periodicOverlay, checkOverlay, confirmOverlay].forEach(closeOverlay);
  state.checkMode = null;
  appEl.classList.add('hidden');
  loginScreen.classList.remove('hidden');
  userInfo.classList.add('hidden');
}

onAuthChange((user) => (user ? onLogin(user) : onLogout()));
