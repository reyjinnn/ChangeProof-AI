// Exercise the actual Vite configuration against the real HTTP server.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createServer as createNetServer } from 'node:net';
import { createServer, loadConfigFromFile } from 'vite';

export async function spec({ base, rootDir }) {
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' }, join(rootDir, 'apps/dashboard/vite.config.ts'));
  const proxy = loaded?.config.server?.proxy?.['/api'];
  assert.ok(proxy, 'The dev UI must route API requests to its backend');
  // Vite treats port 0 as its default port, so reserve a free loopback port.
  const reservation = createNetServer();
  await new Promise(resolve => { reservation.listen(0, '127.0.0.1', resolve); });
  const reserved = reservation.address();
  assert.ok(reserved && typeof reserved !== 'string');
  await new Promise(resolve => { reservation.close(resolve); });
  // Only the destination changes to the test's ephemeral backend port. Keep
  // the real shorthand/object behavior, including its Host handling.
  const server = await createServer({
    ...loaded.config, configFile: false, root: join(rootDir, 'apps/dashboard'), logLevel: 'error',
    server: { ...loaded.config.server, host: '127.0.0.1', port: reserved.port, strictPort: true,
      proxy: { '/api': typeof proxy === 'string' ? base : { ...proxy, target: base } } },
  });
  try {
    await server.listen();
    const address = server.httpServer.address();
    assert.ok(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;
    const health = await fetch(origin + '/api/health');
    assert.equal(health.status, 200);
    assert.equal((await health.json()).data.service, 'changeproof');
    const mutate = requestOrigin => fetch(origin + '/api/site/templates/bugfix-run/apply', {
      method: 'POST', body: '{}',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ChangeProofUI', Origin: requestOrigin },
    });
    const gated = await mutate(origin);
    assert.equal(gated.status, 401, 'Same-origin POST reaches the real login gate');
    assert.equal((await gated.json()).error.code, 'login_required');
    assert.equal((await mutate('http://other.example')).status, 403, 'Cross-origin refusal stays enforced');
  } finally {
    await server.close();
  }
}
