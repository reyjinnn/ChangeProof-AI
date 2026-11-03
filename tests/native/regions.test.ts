import { execFileSync } from 'node:child_process';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  freezeRegionPlan,
  runRegionCampaign,
  type RegionFaultDriver,
  type RegionWorkload,
} from '../../src/modules/verifier/index.js';

/**
 * WP3-19 / T-34 — region supervisor probe over real containers (native).
 *
 * Two real PostgreSQL instances on a private docker network act as regions;
 * partitions are real `docker network disconnect` operations verified by
 * failed `pg_isready` probes from the other side, and heals are real
 * reconnects verified by successful probes. Trial 1 heals without resync
 * and the supervisor must report the RPO failure as a failure; trial 2
 * heals with a labeled test-harness resync and the supervisor must report
 * green checks with a `probe-only` qualification — single-host mechanics
 * evidence, never a qualification result (NEG3-08, NEG3-17, NEG3-40).
 */

const NETWORK = 'changeproof-regions';
const CONTAINERS = [
  { name: 'cpreg-a', region: 'a', port: 5545 },
  { name: 'cpreg-b', region: 'b', port: 5546 },
] as const;

function docker(args: readonly string[]): { ok: boolean; output: string } {
  try {
    const output = execFileSync('docker', [...args], { encoding: 'utf8', timeout: 60_000 });
    return { ok: true, output };
  } catch {
    return { ok: false, output: '' };
  }
}

function poolFor(port: number): Pool {
  return new Pool({ connectionString: `postgresql://postgres:postgres@localhost:${String(port)}/postgres` });
}

const pools = new Map<string, Pool>();

async function waitReady(name: string): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const ready = docker(['exec', name, 'pg_isready', '-U', 'postgres']);
    if (ready.ok) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Container ${name} never became ready; refusing.`);
}

beforeAll(async () => {
  for (const container of CONTAINERS) {
    docker(['rm', '-f', container.name]);
  }
  docker(['network', 'rm', NETWORK]);
  const created = docker(['network', 'create', NETWORK]);
  if (!created.ok) {
    throw new Error('Could not create the probe network; refusing.');
  }
  for (const container of CONTAINERS) {
    const started = docker([
      'run',
      '-d',
      '--name',
      container.name,
      '--network',
      NETWORK,
      '-e',
      'POSTGRES_PASSWORD=postgres',
      '-p',
      `${String(container.port)}:5432`,
      'postgres:16-alpine',
    ]);
    if (!started.ok) {
      throw new Error(`Could not start ${container.name}; refusing.`);
    }
    await waitReady(container.name);
    const pool = poolFor(container.port);
    pools.set(container.region, pool);
    await pool.query(
      `CREATE TABLE IF NOT EXISTS region_journal (
         seq BIGINT PRIMARY KEY,
         region TEXT NOT NULL,
         payload TEXT NOT NULL,
         acked BOOLEAN NOT NULL,
         written_at TIMESTAMPTZ NOT NULL
       )`,
    );
  }
}, 180_000);

afterAll(async () => {
  for (const pool of pools.values()) {
    await pool.end();
  }
  pools.clear();
  for (const container of CONTAINERS) {
    docker(['rm', '-f', container.name]);
  }
  docker(['network', 'rm', NETWORK]);
});

function poolOf(region: string): Pool {
  const pool = pools.get(region);
  if (pool === undefined) {
    throw new Error(`No pool for region ${region}; refusing.`);
  }
  return pool;
}

let globalSeq = 0;

function makeDriver(): RegionFaultDriver {
  return {
    applyFault: (input) => {
      const peer = input.fault.targets.includes('a-b') ? 'cpreg-b' : null;
      if (peer === null) {
        return Promise.resolve({ appliedAt: new Date().toISOString(), applied: false });
      }
      docker(['network', 'disconnect', NETWORK, peer]);
      // The partition is real only if the other side proves it cannot connect.
      const probe = docker(['exec', 'cpreg-a', 'pg_isready', '-h', peer, '-p', '5432']);
      return Promise.resolve({ appliedAt: new Date().toISOString(), applied: !probe.ok });
    },
    healFault: () => {
      docker(['network', 'connect', NETWORK, 'cpreg-b']);
      const probe = docker(['exec', 'cpreg-a', 'pg_isready', '-h', 'cpreg-b', '-p', '5432']);
      const aliasProbe = docker(['exec', 'cpreg-b', 'pg_isready', '-h', 'cpreg-a', '-p', '5432']);
      const verified = probe.ok && aliasProbe.ok;
      return Promise.resolve({ healedAt: new Date().toISOString(), healed: verified, verified });
    },
    roles: () => Promise.resolve({ a: 'primary', b: 'replica' }),
  };
}

function makeWorkload(): RegionWorkload {
  return {
    write: async (region: string) => {
      globalSeq += 1;
      const seq = globalSeq;
      await poolOf(region).query(
        `INSERT INTO region_journal (seq, region, payload, acked, written_at)
         VALUES ($1, $2, $3, true, $4)`,
        [seq, region, `payload-${String(seq)}`, new Date().toISOString()],
      );
      return { seq, acked: true };
    },
    read: async (region: string, seq: number) => {
      const found = await poolOf(region).query(`SELECT 1 FROM region_journal WHERE seq = $1`, [seq]);
      return { present: found.rows.length > 0 };
    },
    journal: async (region: string) => {
      const found = await poolOf(region).query(
        `SELECT seq, acked FROM region_journal ORDER BY seq`,
      );
      return (found.rows as { seq: string; acked: boolean }[]).map((row) => ({
        seq: Number(row.seq),
        acked: row.acked,
      }));
    },
  };
}

function makePlan(planId: string) {
  return freezeRegionPlan({
    planId,
    planHash: 'f'.repeat(64),
    topology: {
      schemaVersion: '1',
      topologyId: 'docker-probe-1',
      regions: [
        { regionId: 'a', role: 'primary', endpointRef: 'cpreg-a:5432' },
        { regionId: 'b', role: 'replica', endpointRef: 'cpreg-b:5432' },
      ],
      provenance: { kind: 'single-host-probe', detail: 'two postgres:16-alpine containers, real network disconnect' },
      consistencyClaimed: 'eventual',
      clockSource: 'host-clock',
    },
    faults: [
      {
        faultId: 'partition-a-b',
        kind: 'partition',
        targets: ['a-b'],
        startAfterMs: 100,
        durationMs: 500,
        heal: { kind: 'reconnect', verifyWithinMs: 10_000 },
      },
    ],
    trials: 1,
    workload: { writesPerTrial: 5, writeRegion: 'a', readRegions: ['a', 'b'] },
    orderingBound: { maxSeqGap: 0, maxDuplicates: 0 },
    rpoBound: { maxLostAckedWrites: 0 },
    rtoBound: { maxRestoreMs: 10_000 },
    frozenAt: new Date().toISOString(),
  });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const nowIso = (): string => new Date().toISOString();

describe('region probe over real partitions (native)', () => {
  it('reports divergence as failure when nothing resyncs', async () => {
    const plan = makePlan('region-probe-no-resync');
    const report = await runRegionCampaign({
      plan,
      driver: makeDriver(),
      workload: makeWorkload(),
      nowIso,
      sleep,
    });
    expect(report.receipts).toHaveLength(1);
    expect(report.receipts[0]).toMatchObject({ faultApplied: true, faultHealed: true, healVerified: true });
    expect(report.receipts[0]?.measuredRpoLostWrites).toBeGreaterThan(0);
    expect(report.receipts[0]?.measuredRtoMs).not.toBeNull();
    expect(report.consistency.qualification).toBe('invalid');
    const rpo = report.consistency.checks.find((check) => check.id === 'rpo-within-bound');
    expect(rpo?.pass).toBe(false);
    const heal = report.consistency.checks.find((check) => check.id === 'heal-verified');
    expect(heal?.pass).toBe(true);
  }, 120_000);

  it('reports green checks as probe-only after a labeled harness resync', async () => {
    await poolOf('a').query(`TRUNCATE region_journal`);
    await poolOf('b').query(`TRUNCATE region_journal`);
    const plan = makePlan('region-probe-resync');
    const report = await runRegionCampaign({
      plan,
      driver: makeDriver(),
      workload: makeWorkload(),
      resync: {
        by: 'test-harness-copy',
        run: async () => {
          const source = await poolOf('a').query(
            `SELECT seq, payload, acked, written_at FROM region_journal ORDER BY seq`,
          );
          for (const row of source.rows as { seq: string; payload: string; acked: boolean; written_at: Date }[]) {
            await poolOf('b').query(
              `INSERT INTO region_journal (seq, region, payload, acked, written_at)
               VALUES ($1, 'b', $2, $3, $4)
               ON CONFLICT (seq) DO NOTHING`,
              [Number(row.seq), row.payload, row.acked, row.written_at.toISOString()],
            );
          }
        },
      },
      nowIso,
      sleep,
    });
    expect(report.receipts[0]).toMatchObject({
      faultApplied: true,
      faultHealed: true,
      measuredRpoLostWrites: 0,
      resyncBy: 'test-harness-copy',
    });
    expect(report.consistency.qualification).toBe('probe-only');
    expect(report.consistency.checks.every((check) => check.pass)).toBe(true);
    expect(report.consistency.reasons.join(' ')).toMatch(/single-host/);
  }, 120_000);
});
