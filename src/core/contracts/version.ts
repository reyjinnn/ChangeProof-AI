import { SchemaVersionUnknownError } from '../errors/index.js';

/**
 * Contract version registry.
 *
 * AGENTS.md §13: schemas are explicitly versioned from the start, and a
 * semantic change bumps the version and gets a decision record. Nothing may
 * read a version it does not know — `resolveSchemaVersion` fails closed.
 *
 * Version strings are intentionally strings rather than numbers so that a
 * future non-linear version ("1.2", "2-rc1") does not require a type change.
 * Only the values listed here are known; adding one is a deliberate act.
 */
export const SCHEMA_VERSIONS = {
  // Engine contracts (PRD §8)
  ChangeIntent: '1',
  InterventionManifest: '1',
  ProjectInventory: '1',
  CapabilityRecord: '1',
  SystemGraph: '1',
  VerificationPlan: '1',
  RepairPlan: '1',
  CandidateBundle: '1',
  StageResult: '1',
  TargetAssessment: '1',
  BundleAssessment: '1',
  ExecutionBudget: '1',
  IncidentEvidence: '1',
  HypothesisRecord: '1',
  ExperimentPlan: '1',
  TrialReceipt: '1',
  DimensionAssessment: '1',
  CharacterizationRecord: '1',
  OutcomeValidation: '1',
  VerifyResult: '1',

  // Readiness, reuse and evaluation contracts (PRD §20)
  ReadinessAssessment: '1',
  InvariantProposal: '1',
  PreparationReuseRecord: '1',
  RunForecast: '1',
  EvaluationArmManifest: '1',
  EnvironmentProfileRevision: '1',

  // Hosted contracts (PRD §16)
  TenantContext: '1',
  RepositoryConnection: '1',
  HostedRunRequest: '1',
  JobLease: '1',
  UsageLedgerEntry: '1',
  ArtifactAccessGrant: '1',
  DataLifecycleRecord: '1',
  HostedServiceProfile: '1',
} as const satisfies Record<string, string>;

export type ContractName = keyof typeof SCHEMA_VERSIONS;

/** The version of the verdict policy itself. Changes here are semantic. */
export const POLICY_VERSION = '1' as const;

/** The version of the adapter contract surface (FR3-02). */
export const ADAPTER_CONTRACT_VERSION = '1' as const;

export type SchemaVersion = (typeof SCHEMA_VERSIONS)[ContractName];

const KNOWN_CONTRACTS = Object.keys(SCHEMA_VERSIONS) as ContractName[];

/**
 * Resolve and verify a contract version.
 *
 * @throws {SchemaVersionUnknownError} when the contract or version is unknown.
 */
export function resolveSchemaVersion(contract: string, received: string): SchemaVersion {
  const known = (SCHEMA_VERSIONS as Record<string, string | undefined>)[contract];

  if (known === undefined) {
    throw new SchemaVersionUnknownError(contract, received, []);
  }
  if (known !== received) {
    throw new SchemaVersionUnknownError(contract, received, [known]);
  }
  return known as SchemaVersion;
}

export function isContractName(value: string): value is ContractName {
  return KNOWN_CONTRACTS.includes(value as ContractName);
}

export function knownContracts(): readonly ContractName[] {
  return KNOWN_CONTRACTS;
}
