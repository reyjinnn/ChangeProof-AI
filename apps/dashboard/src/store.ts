/* Browser persistence (T-42). Only theme, sidebar state, and
 * account-scoped non-secret drafts. File bytes, passwords, sessions,
 * reset tokens, BYOK material, and API keys must never be stored here:
 * saveDraft refuses secret-shaped keys outright. */

export type Theme = 'light' | 'dark';

/** Dispatched after login/logout so the shell re-renders in place. */
export const SESSION_CHANGED_EVENT = 'cp:session-changed';

const THEME_KEY = 'changeproof-modern-theme';
const SIDEBAR_KEY = 'changeproof-sidebar-collapsed';
const DRAFT_PREFIX = 'changeproof-draft:';

const SECRET_KEY_PARTS = ['password', 'passwd', 'secret', 'token', 'session', 'apikey', 'api_key', 'byok'];

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function read(key: string): string | undefined {
  try {
    return storage()?.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function write(key: string, value: string): void {
  try {
    storage()?.setItem(key, value);
  } catch {
    // Storage unavailable (private mode, quota): the app keeps working
    // with in-memory defaults instead of throwing.
  }
}

function remove(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // Same fallback as write: ignore and continue in-memory.
  }
}

export function loadTheme(): Theme {
  const saved = read(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

export function saveTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme;
  write(THEME_KEY, theme);
}

export function loadSidebarCollapsed(): boolean {
  return read(SIDEBAR_KEY) === '1';
}

export function saveSidebarCollapsed(collapsed: boolean): void {
  write(SIDEBAR_KEY, collapsed ? '1' : '0');
}

export class SecretDraftError extends Error {
  constructor(key: string) {
    super(`Draft key "${key}" looks like a secret; secrets must never enter browser storage.`);
    this.name = 'SecretDraftError';
  }
}

/** Drafts are namespaced per account so two accounts never share form state. */
export function saveDraft(accountId: string, key: string, value: string): void {
  const lowered = `${accountId}:${key}`.toLowerCase();
  const hit = SECRET_KEY_PARTS.find((part) => lowered.includes(part));
  if (hit !== undefined) throw new SecretDraftError(key);
  write(`${DRAFT_PREFIX}${accountId}:${key}`, value);
}

export function loadDraft(accountId: string, key: string): string | undefined {
  return read(`${DRAFT_PREFIX}${accountId}:${key}`);
}

export function clearDraft(accountId: string, key: string): void {
  remove(`${DRAFT_PREFIX}${accountId}:${key}`);
}
