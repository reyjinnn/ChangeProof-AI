// sc3-baseline order service (fixture, not product code).
//
// A minimal real order workflow for WP3-06 baseline runs: orders persist in
// PostgreSQL, fulfillment events flow through a Redis stream, and a pinned-v1
// consumer fulfills them. Two versions share the exact HTTP contract:
//   v1 (old-valid):  emits {schema:'v1', amountCents} -> consumer fulfills.
//   v2 (new):        emits {schema:'v2', totalMinor}   -> pinned consumer rejects,
//                    the order is never fulfilled (the attributed failure).
// API-level checks stay green on both; only the workflow outcome differs.
//
// Usage: node service.mjs --port 45501 --version v1 \
//   --database-url postgresql://... --redis-url redis://...
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createClient } from 'redis';

function arg(name, fallback = undefined) {
  const flag = `--${name}`;
  const at = process.argv.indexOf(flag);
  if (at === -1 || at + 1 >= process.argv.length) return fallback;
  return process.argv[at + 1];
}

const port = Number(arg('port', '0'));
const version = arg('version', 'v1');
const databaseUrl = arg('database-url', process.env.DATABASE_URL);
const redisUrl = arg('redis-url', process.env.REDIS_URL);
if (!databaseUrl || !redisUrl) {
  console.error('missing --database-url / --redis-url');
  process.exit(2);
}
if (version !== 'v1' && version !== 'v2') {
  console.error(`unknown --version ${version}`);
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const redis = createClient({ url: redisUrl });
redis.on('error', (error) => console.error(JSON.stringify({ event: 'redis-error', message: String(error) })));

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function eventFor(order) {
  return version === 'v1'
    ? { schema: 'v1', orderId: order.id, tenant: order.tenant_id, amountCents: String(order.amount_cents) }
    : { schema: 'v2', orderId: order.id, tenant: order.tenant_id, totalMinor: String(order.amount_cents) };
}

const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SC3 baseline orders</title></head>
<body><h1>Place an order (${version})</h1>
<form method="post" action="/orders">
<label>Tenant <input name="tenant" value="tenant-a"></label>
<label>Amount (cents) <input name="amountCents" value="1200"></label>
<button type="submit">Place order</button></form></body></html>`;

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://local');
    if (request.method === 'GET' && url.pathname === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true, version }));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(page);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/orders') {
      const raw = await readBody(request);
      const contentType = request.headers['content-type'] ?? '';
      let tenant;
      let amountCents;
      if (contentType.includes('application/json')) {
        const parsed = JSON.parse(raw);
        tenant = parsed.tenant;
        amountCents = parsed.amountCents;
      } else {
        const params = new URLSearchParams(raw);
        tenant = params.get('tenant');
        amountCents = Number(params.get('amountCents'));
      }
      if (typeof tenant !== 'string' || tenant.length === 0 || !Number.isInteger(amountCents) || amountCents <= 0) {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'tenant and a positive integer amountCents are required' }));
        return;
      }
      const id = `ord-${randomBytes(8).toString('hex')}`;
      await pool.query(
        `INSERT INTO sc3_orders (id, tenant_id, amount_cents, status) VALUES ($1, $2, $3, 'created')`,
        [id, tenant, amountCents],
      );
      await redis.xAdd('order-events', '*', eventFor({ id, tenant_id: tenant, amount_cents: amountCents }));
      console.log(JSON.stringify({ event: 'order-created', orderId: id, version }));
      if (contentType.includes('application/json')) {
        response.writeHead(201, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ orderId: id, status: 'created' }));
      } else {
        response.writeHead(201, { 'content-type': 'text/html; charset=utf-8' });
        response.end(
          `<!doctype html><html lang="en"><body><h1>Order placed</h1><p>Order <strong>${id}</strong> is created.</p><p><a href="/orders/${id}">Check status</a></p></body></html>`,
        );
      }
      return;
    }
    if (request.method === 'GET' && url.pathname.startsWith('/orders/')) {
      const id = url.pathname.slice('/orders/'.length);
      const found = await pool.query(`SELECT id, tenant_id, amount_cents, status FROM sc3_orders WHERE id = $1`, [id]);
      if (found.rows.length === 0) {
        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'unknown order' }));
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(found.rows[0]));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not found' }));
  } catch (error) {
    console.error(JSON.stringify({ event: 'request-error', message: String(error) }));
    if (!response.headersSent) {
      response.writeHead(500, { 'content-type': 'application/json' });
    }
    response.end(JSON.stringify({ error: 'internal error' }));
  }
});

await redis.connect();
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
console.log(JSON.stringify({ event: 'listening', port: server.address().port, version }));

async function shutdown() {
  server.close();
  await redis.quit().catch(() => undefined);
  await pool.end().catch(() => undefined);
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
