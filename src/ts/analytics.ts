// GA4 イベント計測（全アプリ共通）。
// 送るのは「アプリ名・ボタンの識別名・画面パス」などの固定文字だけ。
// ユーザーが入力したテキスト（メモ・タイトル・数値など）は絶対に送らない。

type GtagFn = (command: 'event', name: string, params?: Record<string, string | number>) => void;
type Params = Record<string, string | number>;

const CLICKABLE = 'button, a[href], [role="button"], summary, [data-track]';
const DATA_KEYS = ['view', 'filter', 'verdict', 'act', 'action', 'status', 'sort', 'tab'];
const MAX_LABEL = 60;

export function track(name: string, params: Params = {}): void {
  const gtag = (window as unknown as { gtag?: GtagFn }).gtag;
  if (typeof gtag !== 'function') return;
  try {
    gtag('event', name, { page_path: location.pathname, ...params });
  } catch {
    // 計測の失敗でアプリを止めない
  }
}

function labelOf(el: Element): string {
  const explicit = el.getAttribute('data-track');
  if (explicit) return explicit.slice(0, MAX_LABEL);

  // 動的に増える ID（item-abc123 など）は集計が散らばるので除外する
  const id = el.id;
  if (id && !/\d/.test(id)) return id.slice(0, MAX_LABEL);

  const parts: string[] = [];
  const firstClass = el.classList[0];
  if (firstClass) parts.push(firstClass);
  for (const key of DATA_KEYS) {
    const value = (el as HTMLElement).dataset?.[key];
    if (value && value.length <= 24) parts.push(`${key}=${value}`);
  }
  return (parts.join(' ') || el.tagName.toLowerCase()).slice(0, MAX_LABEL);
}

export function initClickTracking(): void {
  document.addEventListener(
    'click',
    (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const el = target.closest(CLICKABLE);
      if (!el) return;
      if (el instanceof HTMLButtonElement && el.disabled) return;

      const params: Params = {
        click_label: labelOf(el),
        click_type: el instanceof HTMLAnchorElement ? 'link' : 'button',
      };
      if (el instanceof HTMLAnchorElement && el.host && el.host !== location.host) {
        // 外部リンクはドメインだけ（パス・クエリは送らない）
        params.link_host = el.host.slice(0, MAX_LABEL);
      }
      track('ui_click', params);
    },
    { capture: true, passive: true },
  );
}
