const STORAGE_KEY = "watch_continue_v1";
const MAX_ITEMS = 12;

export interface ContinueItem {
  id: string;
  title: string;
  thumb: string;
  url: string;
  source: "free" | "family" | "premium" | "link";
  progress?: number;
  watchedAt: number;
}

export function loadContinueWatching(): ContinueItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ContinueItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveContinueWatching(item: Omit<ContinueItem, "watchedAt">) {
  const list = loadContinueWatching().filter((x) => x.id !== item.id);
  list.unshift({ ...item, watchedAt: Date.now() });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_ITEMS)));
}
