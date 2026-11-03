import { afterEach, expect, test } from 'vitest';

import {
  clearDraft,
  loadDraft,
  loadSidebarCollapsed,
  loadTheme,
  saveDraft,
  saveSidebarCollapsed,
  saveTheme,
  SecretDraftError,
} from './store.js';

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.dataset['theme'] = 'light';
  document.body.classList.remove('nav-open', 'sidebar-collapsed');
});

test('theme round-trips through storage and the document', () => {
  saveTheme('dark');
  expect(document.documentElement.dataset['theme']).toBe('dark');
  expect(loadTheme()).toBe('dark');
  saveTheme('light');
  expect(loadTheme()).toBe('light');
});

test('sidebar collapse persists as a flag', () => {
  expect(loadSidebarCollapsed()).toBe(false);
  saveSidebarCollapsed(true);
  expect(loadSidebarCollapsed()).toBe(true);
});

test('drafts are namespaced per account', () => {
  saveDraft('alice', 'run-title', 'Fix checkout');
  expect(loadDraft('alice', 'run-title')).toBe('Fix checkout');
  expect(loadDraft('bob', 'run-title')).toBeUndefined();
  clearDraft('alice', 'run-title');
  expect(loadDraft('alice', 'run-title')).toBeUndefined();
});

test('secret-shaped draft keys are refused, never stored', () => {
  for (const key of ['password', 'reset-token', 'session-id', 'api_key', 'byok-handle', 'passwd2']) {
    expect(() => {
      saveDraft('alice', key, 'x');
    }).toThrow(SecretDraftError);
    expect(loadDraft('alice', key)).toBeUndefined();
  }
});
