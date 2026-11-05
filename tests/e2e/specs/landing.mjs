// Real browser rendering, media preference and cleanup for the root mockup port.
import assert from 'node:assert/strict';
import { axeScan } from '../helpers.mjs';

export async function spec({ base, browser, rootDir }) {
  for (const fallback of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    try {
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(forceFallback => {
        window.__landingDraws = 0;
        const getContext = window.HTMLCanvasElement.prototype.getContext;
        window.HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
          if (forceFallback && kind === 'webgl2') return null;
          return getContext.call(this, kind, ...args);
        };
        const drawArrays = window.WebGL2RenderingContext.prototype.drawArrays;
        window.WebGL2RenderingContext.prototype.drawArrays = function (...args) {
          window.__landingDraws += 1;
          return drawArrays.apply(this, args);
        };
        const drawImage = window.CanvasRenderingContext2D.prototype.drawImage;
        window.CanvasRenderingContext2D.prototype.drawImage = function (...args) {
          window.__landingDraws += 1;
          return drawImage.apply(this, args);
        };
      }, fallback);
      await page.goto(`${base}/#/p/`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      const renderer = await page.locator('.landing-hero').getAttribute('data-fiber-renderer');
      assert.ok(['webgl2', 'canvas2d'].includes(renderer), 'Native particle renderer initialized');
      if (fallback) assert.equal(renderer, 'canvas2d', 'Real 2D drawing when WebGL is unavailable');
      await page.waitForFunction(() => window.__landingDraws > 0);
      const still = await page.evaluate(() => window.__landingDraws);
      // A full scheduler interval is required to verify that reduced motion
      // actually pauses rendering, rather than merely hiding a moving canvas.
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => window.__landingDraws), still);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.waitForFunction(count => window.__landingDraws > count, still);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForTimeout(100);
      const paused = await page.evaluate(() => window.__landingDraws);
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => window.__landingDraws), paused);
      await page.getByRole('button', { name: 'Dark mode', exact: true }).click();
      assert.deepEqual((await axeScan(page, rootDir)).map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, reason: n.failureSummary })) })), []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
      await page.locator('.cp-identity-hero').getByRole('link', { name: 'View pricing', exact: true }).click();
      await page.getByRole('heading', { name: 'Start small. Stay in control.', exact: true }).waitFor();
      const departed = await page.evaluate(() => window.__landingDraws);
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => window.__landingDraws), departed, 'Departed landing stops its renderer');
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
}
