/**
 * T-53 / T7-4 — consolidated negative suite (NEG3-01..40 entry point).
 *
 * Thin suite: no duplicated test bodies. It imports every default-config
 * test module whose body references a NEG3-xx pin, so `pnpm test:negative`
 * (script already in package.json) executes the per-module negatives in one
 * command. Mechanical membership rule — regenerate/verify with:
 *
 *   rg -l 'NEG3-' tests --glob '*.test.ts' | grep -v tests/native | grep -v tests/e2e
 *
 * Excluded on purpose:
 * - tests/native/** (separate vitest config; needs disposable DB/Redis/Mailpit;
 *   run via `DATABASE_URL=… REDIS_URL=… [MAILPIT_*=…] pnpm test:identity:native`
 *   with file filters — see docs/phase-reports/slices/T-53.md for the list).
 * - tests/e2e/** (separate node runner: `pnpm test:e2e`).
 * - Untagged files: they run under their own family scripts; the T-53 matrix
 *   cites them only as supporting evidence, never as NEG pins.
 *
 * labels: origin=controlled_change, executionMode=mock, proposalMode=human_reference
 */

// Engine negatives: contracts, policy, graph, adapters, agent, verifier.
import '../adapters/l1-extraction.test.js';
import '../adapters/python-l1.test.js';
import '../adapters/registry.test.js';
import '../adapters/t07-acceptance.test.js';
import '../adapters/t21-l3-tuples.test.js';
import '../adapters/t22-l2-candidates.test.js';
import '../agent/broker.test.js';
import '../agent/gateway.test.js';
import '../agent/ledger.test.js';
import '../contracts/outcome-and-budget.test.js';
import '../contracts/semantic-validation.test.js';
import '../contracts/version-and-identity.test.js';
import '../contracts/vocabulary-and-capability.test.js';
import '../dependencies/broker.test.js';
import '../fixtures/oracle-freeze.test.js';
import '../fixtures/t36-legacy.test.js';
import '../graph/detector-analyzer-graph.test.js';
import '../migrations/manifest.test.js';
import '../migrations/t38-transfer.test.js';
import '../migrations/upgrade.test.js';
import '../observability/t26-sc3-09.test.js';
import '../observability/telemetry-quality.test.js';
import '../orchestrator/t24-bundle-coordination.test.js';
import '../orchestrator/t25-publication.test.js';
import '../policy/precedence.test.js';
import '../verifier/campaign-accounting.test.js';
import '../verifier/measurement-reducers.test.js';
import '../verifier/t26-suite-negatives.test.js';
import '../verifier/t34-regions.test.js';
import '../verifier/t35-soak.test.js';
import '../verifier/t37-checker.test.js';

// Hosted negatives: identity, jobs, usage, lifecycle, evidence, github,
// engagement/teamwork/publicsite/providers/distribution/evaluation/pilot.
import '../distribution/t31-byok.test.js';
import '../distribution/t31-deployment.test.js';
import '../distribution/t39-cloud.test.js';
import '../evaluation/t33-manifest.test.js';
import '../evaluation/t33-policy.test.js';
import '../evaluation/t33-roles.test.js';
import '../evidence/t25-evidence-store.test.js';
import '../github/webhooks.test.js';
import '../http/t48-teamwork.test.js';
import '../identity/challenges.test.js';
import '../identity/grants.test.js';
import '../identity/t32-saml.test.js';
import '../identity/t32-scim.test.js';
import '../jobs/lease-fencing.test.js';
import '../jobs/t40-operations.test.js';
import '../lifecycle/t40-deletion.test.js';
import '../pilot/t41-register.test.js';
import '../providers/t32-gitlab-bitbucket.test.js';
import '../publicsite/boundary.test.js';
import '../publicsite/manifest.test.js';
import '../security/runner.test.js';
import '../usage/ledger.test.js';
import '../usage/t40-billing.test.js';
