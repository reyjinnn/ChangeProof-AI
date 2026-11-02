import { describe, expect, it } from 'vitest';

import { DependencyBroker } from '../../src/modules/dependencies/index.js';
import { MigrationRunner } from '../../src/modules/migrations/index.js';
import { composeMigrations } from '../../src/orchestrator/index.js';

describe('composeMigrations wires broker and database handle (WP3-10)', () => {
  it('plans upgrades through the broker and creates runners', () => {
    const db = {
      query: () => Promise.reject(new Error('no database in this test')),
      connect: () => Promise.reject(new Error('no database in this test')),
    };
    const broker = new DependencyBroker({
      allowlistedRegistries: ['https://registry.npmjs.org'],
      allowlistedPackages: ['semver'],
      installScriptsAllowed: false,
    });
    const composed = composeMigrations(db, broker);
    const planned = composed.planUpgrade({
      schemaVersion: '1',
      components: [
        {
          name: 'app',
          requirements: [
            {
              packageName: 'semver',
              version: '7.7.3',
              registry: 'https://registry.npmjs.org',
              manifest: { name: 'semver', version: '7.7.3', integrity: 'sha512-x', scripts: {} },
            },
          ],
        },
      ],
    });
    expect(Object.keys(planned.lockfile.packages)).toEqual(['semver@7.7.3']);
    expect(() => { composed.assertManifestLockfileMatch({ dependencies: { semver: '7.7.3' } }, planned.lockfile); },
    ).not.toThrow();
    const runner = composed.createRunner({
      schemaVersion: '1',
      migrationId: 'wiring-probe',
      table: 'orders',
      idColumn: 'id',
      batchSize: 10,
      expandSql: ['SELECT 1'],
      backfillSql: 'UPDATE orders SET a = 1 WHERE id > $1 AND id <= $2',
      remainingSql: 'SELECT 0',
      contractSql: ['SELECT 1'],
      journal: {
        table: 'op_journal',
        seqColumn: 'op_seq',
        idColumn: 'op_id',
        kindColumn: 'op_kind',
        rowColumn: 'row_id',
        tenantColumn: 'tenant_id',
      },
      verify: { nullColumns: [], sumChecks: [] },
    });
    expect(runner).toBeInstanceOf(MigrationRunner);
  });
});
