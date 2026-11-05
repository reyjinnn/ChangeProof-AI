import { afterEach, expect, test } from 'vitest';

import { badge, changeproofMarkSvg, emptyState, enhanceCustomSelects, errorState, esc, field, h, modal } from './components.js';

afterEach(() => {
  document.body.replaceChildren();
});

test('esc neutralizes an XSS payload', () => {
  expect(esc('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
  expect(esc('a&b"c')).toBe('a&amp;b&quot;c');
});

test('h builds elements with text children, never HTML parsing', () => {
  const node = h('p', { class: 'muted' }, ['<b>not bold</b>']);
  expect(node.querySelector('b')).toBeNull();
  expect(node.textContent).toBe('<b>not bold</b>');
});

test('badge carries tone as text, not color alone', () => {
  const node = badge('bad', 'Failed');
  expect(node.getAttribute('data-tone')).toBe('bad');
  expect(node.textContent).toContain('Failed');
});

test('empty and error states announce through live regions', () => {
  expect(emptyState('Empty', 'Nothing here.').getAttribute('aria-live')).toBe('polite');
  expect(errorState('Broken', 'Try again.').getAttribute('role')).toBe('alert');
});

test('error state retry button fires its handler', () => {
  let clicks = 0;
  const block = errorState('Broken', 'Try again.', { label: 'Retry', onClick: () => (clicks += 1) });
  document.body.appendChild(block);
  const button = block.querySelector('button');
  expect(button?.textContent).toBe('Retry');
  button?.click();
  expect(clicks).toBe(1);
});

test('field links its error to the input accessibly', () => {
  document.body.appendChild(field({ id: 'email', label: 'Email', error: 'Enter an email.' }).wrap);
  const input = document.getElementById('email');
  expect(document.querySelector('label[for="email"]')?.textContent).toBe('Email');
  expect(input?.getAttribute('aria-invalid')).toBe('true');
  const described = input?.getAttribute('aria-describedby') ?? '';
  expect(document.getElementById(described)?.textContent).toBe('Enter an email.');
});

test('custom select sync is idempotent: repeat passes keep the trigger nodes', () => {
  // The shell re-runs enhancement on every outlet mutation; a rebuild on
  // every pass refires the observer forever on inline selects (#/team hung).
  const host = h('div', {}, [
    h('select', { id: 'role', name: 'role' }, [
      h('option', { value: 'member' }, ['Member']),
      h('option', { value: 'viewer' }, ['Viewer']),
    ]),
  ]);
  document.body.appendChild(host);
  enhanceCustomSelects(host);
  const trigger = host.querySelector('.cp-select-trigger');
  expect(trigger).not.toBeNull();
  expect(trigger?.getAttribute('aria-label')).toContain('Member');
  const firstChild = trigger?.firstChild ?? null;
  enhanceCustomSelects(host);
  enhanceCustomSelects(host);
  expect(trigger?.firstChild).toBe(firstChild);
  expect(host.querySelectorAll('.cp-select-trigger').length).toBe(1);
});

test('custom select sync rebuilds when the options actually change', () => {
  const host = h('div', {}, [
    h('select', { id: 'role', name: 'role' }, [
      h('option', { value: 'member' }, ['Member']),
      h('option', { value: 'viewer' }, ['Viewer']),
    ]),
  ]);
  document.body.appendChild(host);
  enhanceCustomSelects(host);
  const trigger = host.querySelector('.cp-select-trigger');
  const firstChild = trigger?.firstChild ?? null;
  const select = host.querySelector('select');
  if (select instanceof HTMLSelectElement && select.options[0] !== undefined) {
    select.options[0].textContent = 'Member-plus';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  expect(trigger?.firstChild).not.toBe(firstChild);
  expect(trigger?.getAttribute('aria-label')).toContain('Member-plus');
});

test('document scroll repositions an open custom select instead of throwing', async () => {
  // Scroll targets any scroller including the document, which has no
  // closest(): the handler must guard before calling it.
  const host = h('div', {}, [
    h('select', { id: 'role', name: 'role' }, [
      h('option', { value: 'member' }, ['Member']),
      h('option', { value: 'viewer' }, ['Viewer']),
    ]),
  ]);
  document.body.appendChild(host);
  enhanceCustomSelects(host);
  const trigger = host.querySelector('.cp-select-trigger');
  if (!(trigger instanceof HTMLButtonElement)) throw new Error('Missing select trigger.');
  trigger.click();
  const portal = document.getElementById('customSelectPortal');
  if (!(portal instanceof HTMLElement)) throw new Error('Missing select portal.');
  portal.style.top = '';
  document.dispatchEvent(new Event('scroll'));
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(document.getElementById('customSelectPortal')?.style.top).not.toBe('');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(document.getElementById('customSelectPortal')).toBeNull();
});

test('modal closes on Escape and returns focus to the trigger', () => {
  const trigger = h('button', { type: 'button' }, ['Open']);
  document.body.appendChild(trigger);
  trigger.focus();
  const handle = modal(trigger, 'Confirm', h('p', {}, ['Body.']));
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  handle.close();
});

test('modal backdrop click closes without stranding the dialog', () => {
  const trigger = h('button', { type: 'button' }, ['Open']);
  document.body.appendChild(trigger);
  const handle = modal(trigger, 'Confirm', h('p', {}, ['Body.']));
  const backdrop = document.querySelector('.modal-backdrop');
  backdrop?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  handle.close();
});

test('modal labels its dialog and starts inside it', () => {
  const trigger = h('button', { type: 'button' }, ['Open']);
  document.body.appendChild(trigger);
  const content = h('div', {}, [h('button', { type: 'button' }, ['Act'])]);
  const handle = modal(trigger, 'Confirm payment', content);
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog?.getAttribute('aria-modal')).toBe('true');
  expect(dialog?.textContent).toContain('Confirm payment');
  expect(dialog?.contains(document.activeElement)).toBe(true);
  handle.close();
});

test('changeproof mark matches the favicon artwork and stays decorative', () => {
  const mark = changeproofMarkSvg();
  expect(mark.tagName).toBe('svg');
  expect(mark.getAttribute('viewBox')).toBe('0 0 64 64');
  expect(mark.getAttribute('aria-hidden')).toBe('true');
  const tiles = [...mark.querySelectorAll('rect')].map((tile) => tile.getAttribute('fill'));
  expect(tiles).toEqual(['#365E96', '#FFFFFF']);
  expect(mark.querySelector('g path')?.getAttribute('d')).toContain('M23 6.5');
});
