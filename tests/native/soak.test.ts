import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  freezeSoakPlan,
  runSoakCampaign,
  type SoakSampler,
  type SoakWorkload,
} from '../../src/modules/verifier/index.js';

/**
 * WP3-19 / T-35 — soak profiler smoke over a real worker process (native).
 *
 * A real node worker runs frozen allocation cycles and reports genuine
 * process metrics per cycle; the campaign reduces those observations with
 * the frozen plan. The flat worker must yield green checks labeled
 * `smoke-only` — never qualified — and the leaking worker must fail its
 * heap series with `invalid` (NEG3-40, NEG3-18 workload accounting).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER = join(HERE, 'soak-worker.mjs');
const CYCLES = 10;
const OPS = 50;

interface WorkerLine {
  cycleIndex: number;
  heapUsedBytes: number;
  rssBytes: number;
  fds?: number;
  attempted: number;
  completed: number;
  dropped: number;
  timeouts: number;
}

function runWorker(mode: 'flat' | 'leak'): WorkerLine[] {
  const output = execFileSync(
    process.execPath,
    ['--expose-gc', WORKER, String(CYCLES), String(OPS), mode],
    { encoding: 'utf8', timeout: 60_000 },
  );
  const lines = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length !== CYCLES) {
    throw new Error(`Worker emitted ${String(lines.length)} lines, expected ${String(CYCLES)}; refusing.`);
  }
  return lines.map((line, index) => {
    const parsed = JSON.parse(line) as WorkerLine;
    if (parsed.cycleIndex !== index || parsed.attempted !== OPS) {
      throw new Error('Worker line is out of order or miscounts ops; refusing.');
    }
    return parsed;
  });
}

function planFor() {
  return freezeSoakPlan({
    planId: 'soak-smoke-1',
    profileId: 'node-api-smoke',
    provenance: { kind: 'smoke', detail: 'short local worker fixture, 10 cycles' },
    knownOnset: { cycles: 5, minDurationMs: 5 },
    horizon: { cycles: CYCLES, minDurationMs: 10 },
    workload: { opsPerCycle: OPS, description: 'frozen allocation batches per cycle' },
    runtime: {
      runtime: 'node',
      runtimeVersion: process.versions.node,
      allocator: 'v8-default',
      gcSettings: '--expose-gc forced per cycle',
      profiler: 'process.memoryUsage sampler',
      profilerVersion: process.versions.node,
    },
    requiredSeries: ['heapUsedBytes', 'rssBytes'],
    slopeBounds: { heapUsedBytes: 50_000, rssBytes: 200_000 },
    minSamplesPerSegment: 8,
    workloadTolerance: { maxDroppedOps: 0, maxTimeoutOps: 0 },
    restartPolicy: { kind: 'forbidden' },
    frozenAt: new Date().toISOString(),
  });
}

function seamsOf(lines: readonly WorkerLine[]): { workload: SoakWorkload; sampler: SoakSampler } {
  const workload: SoakWorkload = {
    runCycle: (cycleIndex: number) => {
      const line = lines[cycleIndex];
      if (line === undefined) {
        return Promise.reject(new Error(`No worker line for cycle ${String(cycleIndex)}; refusing.`));
      }
      return Promise.resolve({
        attempted: line.attempted,
        completed: line.completed,
        dropped: line.dropped,
        timeouts: line.timeouts,
      });
    },
  };
  const sampler: SoakSampler = {
    sample: (cycleIndex: number) => {
      const line = lines[cycleIndex];
      if (line === undefined) {
        return Promise.reject(new Error(`No worker sample for cycle ${String(cycleIndex)}; refusing.`));
      }
      return Promise.resolve({
        heapUsedBytes: line.heapUsedBytes,
        rssBytes: line.rssBytes,
        ...(line.fds === undefined ? {} : { fds: line.fds }),
      });
    },
  };
  return { workload, sampler };
}

describe('soak profiler over a real worker (native)', () => {
  it('labels a green flat-worker run as smoke-only, never qualified', async () => {
    const lines = runWorker('flat');
    for (const line of lines) {
      expect(line.heapUsedBytes).toBeGreaterThan(0);
      expect(line.rssBytes).toBeGreaterThan(0);
    }
    const { workload, sampler } = seamsOf(lines);
    const { receipt, report } = await runSoakCampaign({
      plan: planFor(),
      workload,
      sampler,
      profiler: { overheadCalibrated: true, calibrationRef: 'smoke-sampler-note' },
      nowIso: () => new Date().toISOString(),
      sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
      cycleMs: 5,
    });
    expect(receipt.cyclesCompleted).toBe(CYCLES);
    expect(receipt.totalCompletedOps).toBe(CYCLES * OPS);
    expect(receipt.peakRssBytes).toBeGreaterThan(0);
    expect(report.checks.every((check) => check.pass)).toBe(true);
    expect(report.qualification).toBe('smoke-only');
  }, 120_000);

  it('fails the heap series on a genuinely leaking worker', async () => {
    const lines = runWorker('leak');
    const first = lines[0]?.heapUsedBytes ?? 0;
    const last = lines[lines.length - 1]?.heapUsedBytes ?? 0;
    expect(last).toBeGreaterThan(first);
    const { workload, sampler } = seamsOf(lines);
    const { report } = await runSoakCampaign({
      plan: planFor(),
      workload,
      sampler,
      profiler: { overheadCalibrated: true, calibrationRef: 'smoke-sampler-note' },
      nowIso: () => new Date().toISOString(),
      sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
      cycleMs: 5,
    });
    expect(report.checks.find((check) => check.id === 'series-heapUsedBytes')?.pass).toBe(false);
    expect(report.qualification).toBe('invalid');
  }, 120_000);
});
