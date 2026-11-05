import assert from 'node:assert/strict';

/** Real hash navigation and server session; never fabricate an auth response. */
export async function workspaceJourney(page, base, authenticated) {
  await page.goto(`${base}/#/p/`, { waitUntil: 'networkidle' });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  const entry = page.locator('.cp-identity-hero [data-open-workspace]');
  assert.equal(await entry.getAttribute('href'), '#/');
  assert.ok(await entry.isVisible());
  const position = await entry.evaluate(node => {
    const rect = node.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, navBottom: document.querySelector('.public-nav').getBoundingClientRect().bottom, viewport: window.innerHeight };
  });
  assert.ok(position.top >= position.navBottom && position.bottom <= position.viewport, 'Open workspace is visible in the first viewport, clear of the navbar');
  await page.keyboard.press('Tab');
  await entry.focus();
  assert.notEqual(await entry.evaluate(node => window.getComputedStyle(node).outlineStyle), 'none');
  await page.keyboard.press('Enter');
  await page.locator('.overview-facts').waitFor();
  assert.ok(page.url().endsWith('#/'));
  const expected = authenticated ? '#/runs/new' : '#/login';
  assert.equal(await page.locator('[data-overview-primary]').getAttribute('href'), expected);
  if (authenticated) assert.match(await page.locator('.overview-facts').textContent(), /Active/);
  else assert.doesNotMatch(await page.locator('.overview-facts').textContent(), /Active/);
  await page.goBack();
  await page.locator('.cp-identity-hero').waitFor();
  assert.ok(page.url().endsWith('#/p/'));
  await page.goForward();
  await page.locator('.overview-facts').waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.overview-facts').waitFor();
  assert.ok(page.url().endsWith('#/'));
  assert.equal(await page.locator('[data-overview-primary]').getAttribute('href'), expected);
  await page.locator('[data-overview-primary]').click();
  if (authenticated) await page.locator('#draft-intent').waitFor();
  else await page.locator('#login-email').waitFor();
  assert.ok(page.url().endsWith(expected), 'The existing auth-aware action has no redirect loop');
}

/** Check the actual browser layout, including glyph centering inside badges. */
export async function verificationPanel(page) {
  await page.locator('[data-proof-tab=evidence]').click();
  assert.deepEqual(await page.locator('.pilot-evidence-step').allTextContents(), ['01', '02', '03']);
  assert.equal(await page.locator('.pilot-evidence-state').textContent(), '!Incomplete');
  const positions = await page.locator('.pilot-evidence-step').evaluateAll(nodes => nodes.map(node => {
    const badge = node.getBoundingClientRect(), body = node.nextElementSibling.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(node);
    const text = range.getBoundingClientRect();
    return { x: badge.x, centerDelta: Math.abs(badge.y + badge.height / 2 - body.y - body.height / 2),
      textX: Math.abs(badge.x + badge.width / 2 - text.x - text.width / 2),
      textY: Math.abs(badge.y + badge.height / 2 - text.y - text.height / 2), width: badge.width, height: badge.height };
  }));
  assert.ok(positions.every(p => p.width === 28 && p.height === 28 && p.x === positions[0].x && p.centerDelta <= 1 && p.textX <= 2 && p.textY <= 2), `Step badges are centered consistently: ${JSON.stringify(positions)}`);
  const colors = await page.locator('.pilot-evidence-state').evaluate(node => ({ warning: window.getComputedStyle(node).color, step: window.getComputedStyle(document.querySelector('.pilot-evidence-step')).color }));
  assert.notEqual(colors.warning, colors.step, 'Incomplete warning is separate from neutral ordinal badges');
  const surfaces = await page.locator('.pilot-evidence-body, .pilot-evidence-label').evaluateAll(nodes => nodes.map(node => window.getComputedStyle(node).backgroundColor));
  assert.ok(surfaces.every(color => color === 'rgba(0, 0, 0, 0)'), 'Required/incomplete checks must not inherit green success surfaces');
  assert.equal(await page.locator('[data-proof-state=incomplete]').count(), 1);
  return positions;
}

export async function capabilityFolder(page) {
  await page.locator('.cp-workflow-front').click();
  // Normal pointer clicks catch overlapping hit areas; do not force clicks.
  for (const area of ['0', '1', '2', '3', '0']) {
    const sheet = page.locator(`[data-cp-area="${area}"]`);
    await sheet.click();
    assert.ok(await page.locator(`#cp-workflow-area-${area}`).isVisible());
    assert.equal(await sheet.getAttribute('aria-expanded'), 'true');
    assert.equal(await sheet.evaluate(node => window.getComputedStyle(node).opacity), '1', 'The selected control remains visible');
  }
  const last = page.locator('[data-cp-area="3"]');
  await last.focus();
  await page.keyboard.press('Enter');
  assert.ok(await page.locator('#cp-workflow-area-3').isVisible());
  assert.equal(await last.evaluate(node => window.getComputedStyle(node).opacity), '1');
}
