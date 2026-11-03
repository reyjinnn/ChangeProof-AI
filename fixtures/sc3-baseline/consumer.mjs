// sc3-baseline fulfillment consumer (fixture, not product code).
//
// Pinned to the v1 event schema: any event that is not exactly
// {schema:'v1', orderId, tenant, amountCents>0} is dead-lettered, never
// applied. Runs until SIGTERM.
//
// Usage: node consumer.mjs --database-url postgresql://... --redis-url redis://...
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

const pool = new pg.Pool({ connectionString: databaseUrl });
const redis = createClient({ url: redisUrl });
redis.on('error', (error) => console.error(JSON.stringify({ event: 'redis-error', message: String(error) })));

let stopped = false;
process.on('SIGTERM', () => {
  stopped = true;
});
process.on('SIGINT', () => {
  stopped = true;
});

function validV1(fields) {
  const amount = Number(fields.amountCents);
  return (
    fields.schema === 'v1' &&
    typeof fields.orderId === 'string' &&
    fields.orderId.length > 0 &&
    typeof fields.tenant === 'string' &&
    fields.tenant.length > 0 &&
    Number.isInteger(amount) &&
    amount > 0
  );
}

await redis.connect();
console.log(JSON.stringify({ event: 'consumer-ready' }));
// From the beginning, not '$': the stream is cleaned between runs, so no
// event placed after startup is ever missed, and there is nothing stale.
let lastId = '0';
while (!stopped) {
  const streams = await redis.xRead({ key: 'order-events', id: lastId }, { COUNT: 10, BLOCK: 1000 });
  if (streams === null) {
    continue;
  }
  for (const stream of streams) {
    for (const message of stream.messages) {
      lastId = message.id;
      if (validV1(message.message)) {
        await pool.query(`UPDATE sc3_orders SET status = 'fulfilled' WHERE id = $1`, [message.message.orderId]);
        console.log(JSON.stringify({ event: 'order-fulfilled', orderId: message.message.orderId }));
      } else {
        await redis.xAdd('order-deadletters', '*', {
          orderId: String(message.message.orderId ?? ''),
          cause: 'unsupported-event-schema',
        });
        console.log(
          JSON.stringify({ event: 'order-deadlettered', orderId: String(message.message.orderId ?? '') }),
        );
      }
    }
  }
}
await redis.quit().catch(() => undefined);
await pool.end().catch(() => undefined);
