/* global process, console, global, Buffer */
import { readdirSync } from 'node:fs';

/**
 * T-35 soak worker fixture (trusted test harness, not customer code).
 *
 * Runs a frozen number of allocation cycles and prints one JSON line per
 * cycle with real process metrics. `flat` drops every batch (GC keeps the
 * heap level); `leak` retains every batch so the heap genuinely grows.
 * Usage: node --expose-gc soak-worker.mjs <cycles> <opsPerCycle> <flat|leak>
 */

const cycles = Number(process.argv[2]);
const opsPerCycle = Number(process.argv[3]);
const mode = process.argv[4];
if (!Number.isInteger(cycles) || cycles <= 0 || !Number.isInteger(opsPerCycle) || opsPerCycle <= 0) {
  console.error('usage: soak-worker.mjs <cycles> <opsPerCycle> <flat|leak>');
  process.exit(2);
}
if (mode !== 'flat' && mode !== 'leak') {
  console.error('mode must be flat or leak');
  process.exit(2);
}

function settleGc() {
  if (global.gc !== undefined) {
    global.gc();
    global.gc();
  }
}

// Warm up once so cycle 0 starts past the startup ramp: touch pages, drop
// them, and settle the heap. This is fixture stabilization, not bound tuning.
{
  const warm = Buffer.alloc(32 * 1024 * 1024, 7);
  let warmSink = 0;
  for (let i = 0; i < warm.length; i += 4096) {
    warmSink += warm[i];
  }
  if (warmSink === -1) {
    console.error('unreachable warmup guard');
    process.exit(3);
  }
  settleGc();
}

const retained = [];
// Silent warmup: identical workload, discarded, so cycle 0 starts on the
// plateau. The measured cycles below are the only observed evidence.
const WARMUP = 12;
for (let warm = 0; warm < WARMUP; warm += 1) {
  const batch = [];
  for (let op = 0; op < opsPerCycle; op += 1) {
    batch.push({ op, payload: 'x'.repeat(64) });
  }
  let sink = 0;
  for (const item of batch) {
    sink += item.payload.length;
  }
  if (sink === -1) {
    console.error('unreachable warmup guard');
    process.exit(3);
  }
  if (mode === 'leak') {
    retained.push(batch);
  }
  settleGc();
}
for (let cycle = 0; cycle < cycles; cycle += 1) {
  const batch = [];
  for (let op = 0; op < opsPerCycle; op += 1) {
    batch.push({ op, payload: 'x'.repeat(64) });
  }
  let sink = 0;
  for (const item of batch) {
    sink += item.payload.length;
  }
  if (mode === 'leak') {
    retained.push(batch);
  }
  settleGc();
  const mem = process.memoryUsage();
  let fds;
  try {
    fds = readdirSync('/proc/self/fd').length;
  } catch {
    fds = undefined;
  }
  console.log(
    JSON.stringify({
      cycleIndex: cycle,
      heapUsedBytes: mem.heapUsed,
      rssBytes: mem.rss,
      ...(fds === undefined ? {} : { fds }),
      attempted: opsPerCycle,
      completed: opsPerCycle,
      dropped: 0,
      timeouts: 0,
      sink,
    }),
  );
}
