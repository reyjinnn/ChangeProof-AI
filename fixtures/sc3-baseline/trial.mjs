// sc3-baseline trial entry (fixture, not product code).
//
// One trial: place K orders against the service URL, poll until all fulfill.
// Exit 0 with a JSON summary iff every order fulfills within budget;
// exit 1 otherwise. The supervisor (executor) owns timeouts, faults, and
// receipts — this file only performs the workload and reports.
//
// Usage: node trial.mjs --service-url http://127.0.0.1:PORT --orders 2 \
//   --budget-ms 10000 --tenant tenant-a
function arg(name, fallback = undefined) {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
}

const serviceUrl = arg('service-url');
const orderCount = Number(arg('orders', '1'));
const budgetMs = Number(arg('budget-ms', '10000'));
const tenant = arg('tenant', 'tenant-a');
if (!serviceUrl || !Number.isInteger(orderCount) || orderCount <= 0 || !Number.isInteger(budgetMs) || budgetMs <= 0) {
  console.error('usage: trial.mjs --service-url <url> --orders <n> --budget-ms <ms> [--tenant <t>]');
  process.exit(2);
}

async function status(orderId) {
  const response = await fetch(`${serviceUrl}/orders/${orderId}`);
  const body = await response.json();
  return body.status;
}

const started = Date.now();
const orderIds = [];
for (let i = 0; i < orderCount; i += 1) {
  const response = await fetch(`${serviceUrl}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tenant, amountCents: 1200 + i }),
  });
  if (response.status !== 201) {
    console.log(JSON.stringify({ ok: false, placed: orderIds.length, failedAt: 'create' }));
    process.exit(1);
  }
  orderIds.push((await response.json()).orderId);
}
for (;;) {
  const states = await Promise.all(orderIds.map(status));
  if (states.every((state) => state === 'fulfilled')) {
    console.log(JSON.stringify({ ok: true, orders: orderCount, durationMs: Date.now() - started }));
    process.exit(0);
  }
  if (Date.now() - started > budgetMs) {
    console.log(JSON.stringify({ ok: false, placed: orderIds.length, failedAt: 'fulfill-budget' }));
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
}
