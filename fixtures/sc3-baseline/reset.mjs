// sc3-baseline reset entry (fixture, not product code).
//
// Declared restore between trials: empty the orders table and the event
// streams. Prints a reset receipt. Exit nonzero on any failure — a failed
// reset invalidates the trial, it never passes quietly.
//
// Usage: node reset.mjs --database-url postgresql://... --redis-url redis://...
import pg from 'pg';
import { createClient } from 'redis';

function arg(name) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

const databaseUrl = arg('database-url') ?? process.env.DATABASE_URL;
const redisUrl = arg('redis-url') ?? process.env.REDIS_URL;
if (!databaseUrl || !redisUrl) {
  console.error('missing --database-url / --redis-url');
  process.exit(2);
}

const started = Date.now();
const pool = new pg.Pool({ connectionString: databaseUrl });
const redis = createClient({ url: redisUrl });
try {
  await redis.connect();
  await pool.query(`DELETE FROM sc3_orders`);
  await redis.del('order-events');
  await redis.del('order-deadletters');
  console.log(JSON.stringify({ ok: true, durationMs: Date.now() - started }));
} finally {
  await redis.quit().catch(() => undefined);
  await pool.end().catch(() => undefined);
}
