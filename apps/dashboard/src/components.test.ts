import { afterEach, expect, test } from 'vitest';

import { badge, emptyState, errorState, esc, field, h, modal } from './components.js';

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
