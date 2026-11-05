// Native browser E2E helpers (T-42). Real chromium against the real
// server: bundled playwright chromium first, then system Edge/Chrome.
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

export const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
export const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
];

export async function launchBrowser() {
  try {
    return await chromium.launch();
  } catch {
    // Bundled chromium missing or mismatched: fall back to system browsers.
  }
  for (const path of [...EDGE_PATHS, ...CHROME_PATHS]) {
    if (path !== '' && existsSync(path)) return chromium.launch({ executablePath: path });
  }
  throw new Error(
    'No usable chromium found: bundled launch failed and no system Edge/Chrome exists. ' +
      'Install a browser to run native E2E; this is a missing check, never a pass.',
  );
}

/** axe-core scan injected from the pinned devDependency (no CDN). */
export async function axeScan(page, rootDir) {
  // Capture the settled interface. Do not disable rules or infinite motion;
  // only await finite decorative transitions already in progress.
  await page.evaluate(async () => {
    const finite = document.getAnimations().filter(animation => {
      const timing = animation.effect?.getTiming();
      return animation.playState === 'running' && timing?.iterations !== Infinity && typeof timing?.duration === 'number' && timing.duration <= 1000;
    });
    await Promise.allSettled(finite.map(animation => animation.finished));
  });
  const axePath = `${rootDir}/node_modules/axe-core/axe.min.js`;
  if (!existsSync(axePath)) {
    throw new Error('axe-core is not installed; the accessibility scan cannot run.');
  }
  await page.addScriptTag({ content: readFileSync(axePath, 'utf8') });
  const violations = await page.evaluate(async () => window.axe.run(document, { resultTypes: ['violations'] }));
  if ((violations.violations ?? []).length > 0) console.error(JSON.stringify(violations.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, reason: n.failureSummary })) }))));
  return violations.violations ?? [];
}

export async function waitForHealth(base, timeoutMs = 30_000) {
  const started = Date.now();
  for (;;) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {
      // Server not up yet.
    }
    if (Date.now() - started > timeoutMs) throw new Error(`Server at ${base} never became healthy.`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Optional real-fixture visual evidence. Restores the original viewport/theme. */
export async function captureVisualMatrix(page, name, rootDir) {
  const directory = process.env.CP_E2E_ARTIFACT_DIR;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  const originalViewport = page.viewportSize();
  const originalTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  const setTheme = async theme => {
    if (await page.evaluate(() => document.documentElement.dataset.theme) === theme) return;
    if (await page.evaluate(() => document.body.classList.contains('auth-surface'))) {
      // Modal backdrops are inert. Use the real stored preference instead of
      // clicking controls behind a dialog or leaving a single-use ticket page.
      await page.evaluate(theme => { window.localStorage.setItem('changeproof-modern-theme', theme); document.documentElement.dataset.theme = theme; }, theme);
    } else await page.locator('[data-theme-toggle]').filter({ visible: true }).first().click();
  };
  const records = [];
  for (const theme of ['dark', 'light']) for (const [device, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
    await setTheme(theme);
    await page.evaluate(async () => { await document.fonts.ready; window.scrollTo({ top: 0, behavior: 'instant' }); });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    const violations = await axeScan(page, rootDir);
    await page.screenshot({ path: `${directory}/${name}-${theme}-${device}.png`, fullPage: true });
    records.push({ name, theme, device, overflow, violations: violations.map(v => v.id), evidence: 'Local controlled fixture with actual HTTP services; not customer/AI repair proof' });
    writeFileSync(`${directory}/${name}.visual.json`, JSON.stringify(records, null, 2));
    if (overflow || violations.length) throw new Error(`Visual fixture ${name}/${theme}/${device}: overflow=${overflow}, axe=${violations.map(v => v.id).join(',')}`);
  }
  if (originalViewport) await page.setViewportSize(originalViewport);
  await setTheme(originalTheme);
}
