// sc3-convergence fulfillment consumer (fixture, not product code).
//
// Reads one Redis stream with plain xRead, applies each operation exactly once
// against PostgreSQL (op_log primary key), and checkpoints the last applied
// stream id in PG. At-least-once redelivery after a kill is absorbed by the
// op_log: a redelivered op is logged as a duplicate, never re-applied.
// --no-dedup disables the guard for the NEG3-11 negative (double effect).
// Exits 0 after --idle-ms with no new messages.
//
// Usage: node consumer.mjs --database-url ... --redis-url ... --stream conv-1 \
//   --consumer c1 --idle-ms 1500 [--no-dedup]
import pg from 'pg';
import { createClient } from 'redis';

function arg(name, fallback = undefined) {
  const flag = `--${name}`;
  const at = process.argv.indexOf(flag);
  if (at === -1 || at + 1 >= process.argv.length) return fallback;
  return process.argv[at + 1];
}

const databaseUrl = arg('database-url', process.env.DATABASE_URL);
const redisUrl = arg('redis-url', process.env.REDIS_URL);
const stream = arg('stream');
const consumer = arg('consumer', 'c1');
const idleMs = Number(arg('idle-ms', '1500'));
const paceMs = Number(arg('pace-ms', '0'));
const noDedup = process.argv.includes('--no-dedup');
if (!databaseUrl || !redisUrl || !stream) {
  console.error('missing --database-url / --redis-url / --stream');
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const redis = createClient({ url: redisUrl });
redis.on('error', (error) => console.error(JSON.stringify({ event: 'redis-error', message: String(error) })));

function log(record) {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), consumer, ...record })}\n`);
}

async function apply(client, opId, orderId, amount) {
  if (noDedup) {
    // NEG3-11 negative: the effect re-applies on every delivery; only the
    // log insert is tolerant so the double effect stays observable.
    await client.query(
      'UPDATE convergence_orders SET status = $1, fulfill_count = fulfill_count + 1 WHERE id = $2',
      ['fulfilled', orderId],
    );
    await client.query('INSERT INTO op_log(op_id, order_id) VALUES ($1, $2) ON CONFLICT (op_id) DO NOTHING', [
      opId,
      orderId,
    ]);
    return 'applied';
  }
  const inserted = await client.query(
    'INSERT INTO op_log(op_id, order_id) VALUES ($1, $2) ON CONFLICT (op_id) DO NOTHING',
    [opId, orderId],
  );
  if ((inserted.rowCount ?? 0) === 0) return 'duplicate';
  await client.query(
    'UPDATE convergence_orders SET status = $1, fulfill_count = fulfill_count + 1 WHERE id = $2 AND status = $3',
    ['fulfilled', orderId, 'pending'],
  );
  return 'applied';
}

async function checkpoint(client, streamId) {
  await client.query(
    `INSERT INTO consumer_checkpoint(stream, last_id) VALUES ($1, $2)
     ON CONFLICT (stream) DO UPDATE SET last_id = EXCLUDED.last_id`,
    [stream, streamId],
  );
}

async function lastCheckpoint(client) {
  const result = await client.query('SELECT last_id FROM consumer_checkpoint WHERE stream = $1', [stream]);
  const row = result.rows[0];
  return row === undefined ? '0' : String(row.last_id);
}

let fulfilled = 0;
let duplicates = 0;
let deliveries = 0;

await redis.connect();
const holder = await pool.connect();
let lastId;
try {
  lastId = await lastCheckpoint(holder);
} finally {
  holder.release();
}

let idleSince = Date.now();
for (;;) {
  const pages = await redis.xRead({ key: stream, id: lastId }, { COUNT: 25, BLOCK: 400 });
  if (pages === null || pages.length === 0) {
    if (Date.now() - idleSince >= idleMs) break;
    continue;
  }
  idleSince = Date.now();
  for (const page of pages) {
    for (const entry of page.messages) {
      const id = entry.id;
      const fields = entry.message;
      // xRead replays the id we already hold; skip it without counting a delivery.
      if (id === lastId) continue;
      deliveries += 1;
      const opId = String(fields.op_id ?? '');
      const orderId = String(fields.order_id ?? '');
      const amount = String(fields.amount ?? '');
      log({ event: 'delivery', op_id: opId, stream_id: id });
      if (opId.length === 0 || orderId.length === 0) {
        log({ event: 'poison', stream_id: id });
        const poisoned = await pool.connect();
        try {
          await checkpoint(poisoned, id);
        } finally {
          poisoned.release();
        }
        lastId = id;
        continue;
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        let outcome;
        try {
          outcome = await apply(client, opId, orderId, amount);
          await checkpoint(client, id);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
        if (outcome === 'applied') fulfilled += 1;
        else duplicates += 1;
        log({ event: outcome, op_id: opId, stream_id: id });
        lastId = id;
        if (paceMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, paceMs));
        }
      } finally {
        client.release();
      }
    }
  }
}

log({ event: 'done', fulfilled, duplicates, deliveries });
await redis.quit().catch(() => undefined);
await pool.end();
