import { createHash } from 'node:crypto';

import {
  ChangeProofError,
  CounterexampleSchema,
  FiniteModelSchema,
  InstantSchema,
  ModelCheckReceiptSchema,
  ModelCheckReportSchema,
  ModelTransitionSchema,
  NonEmptyStringSchema,
  type Counterexample,
  type FiniteModel,
  type ModelCheckReceipt,
  type ModelCheckReport,
  type ModelTransition,
} from '../../core/index.js';

/**
 * Finite schedule/model checker (WP3-33, MVP §20).
 *
 * The checker explores every schedule within a frozen bound through an
 * injected invariant oracle, then validates each counterexample by replaying
 * it on the actual system through an injected replayer. An unexhausted
 * bound reports `bound_incomplete` — never holds — and a counterexample
 * the replayer refutes invalidates the model instead of passing it
 * (NEG3-40). Claims never generalize beyond the declared model.
 *
 * There is no simulated oracle or replayer in product code: tests inject
 * fakes and the native check replays schedules through a real target
 * process. Full registered-model campaigns belong to phase-7.
 */

export interface InvariantOracle {
  check(state: string, schedule: readonly string[]): string[];
}

export interface ScheduleReplayer {
  replay(schedule: readonly string[]): { endState: string; violated: string[] };
}

function digestOf(body: object): string {
  return createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex');
}

export function freezeFiniteModel(input: {
  modelId: string;
  states: readonly string[];
  initial: string;
  transitions: readonly unknown[];
  invariants: readonly string[];
  bound: { maxDepth: number; maxSchedules: number };
  frozenAt: string;
}): FiniteModel {
  const staged = FiniteModelSchema.parse({
    schemaVersion: '1',
    modelId: NonEmptyStringSchema.parse(input.modelId),
    states: [...input.states],
    initial: NonEmptyStringSchema.parse(input.initial),
    transitions: input.transitions.map((transition) => ModelTransitionSchema.parse(transition)),
    invariants: [...input.invariants],
    bound: { ...input.bound },
    frozenAt: InstantSchema.parse(input.frozenAt),
    digest: '0'.repeat(64),
  });
  const body: Record<string, unknown> = { ...staged };
  delete body['digest'];
  return FiniteModelSchema.parse({ ...body, digest: digestOf(body) });
}

export function verifyFiniteModel(model: unknown): FiniteModel {
  const parsed = FiniteModelSchema.parse(model);
  const { digest, ...body } = parsed;
  if (digestOf(body) !== digest) {
    throw new ChangeProofError('Finite model drifted from its frozen digest; the proof is invalid.');
  }
  return parsed;
}

export function exploreModel(
  model: FiniteModel,
  oracle: InvariantOracle,
  exploredAt: string,
): ModelCheckReceipt {
  const verified = verifyFiniteModel(model);
  const declared = new Set(verified.invariants);
  const byFrom = new Map<string, ModelTransition[]>();
  for (const transition of verified.transitions) {
    const list = byFrom.get(transition.from) ?? [];
    list.push(transition);
    byFrom.set(transition.from, list);
  }
  const { maxDepth, maxSchedules } = verified.bound;
  const frontier: { state: string; schedule: string[] }[] = [
    { state: verified.initial, schedule: [] },
  ];
  const seenCounterexamples = new Set<string>();
  const counterexamples: Counterexample[] = [];
  let schedulesExplored = 1;
  let boundExhausted = true;

  while (frontier.length > 0) {
    const current = frontier.shift();
    if (current === undefined) {
      break;
    }
    for (const invariant of oracle.check(current.state, current.schedule)) {
      if (!declared.has(invariant)) {
        throw new ChangeProofError('Oracle reported an invariant the model never declared; refusing.');
      }
      if (current.schedule.length === 0) {
        continue;
      }
      const key = `${current.schedule.join(' ')}#${invariant}`;
      if (seenCounterexamples.has(key)) {
        continue;
      }
      seenCounterexamples.add(key);
      counterexamples.push(
        CounterexampleSchema.parse({
          schedule: [...current.schedule],
          invariant,
          endState: current.state,
        }),
      );
    }
    if (current.schedule.length >= maxDepth) {
      continue;
    }
    for (const transition of byFrom.get(current.state) ?? []) {
      if (schedulesExplored >= maxSchedules) {
        boundExhausted = false;
        frontier.length = 0;
        break;
      }
      schedulesExplored += 1;
      frontier.push({ state: transition.to, schedule: [...current.schedule, transition.op] });
    }
  }

  return ModelCheckReceiptSchema.parse({
    schemaVersion: '1',
    modelDigest: verified.digest,
    schedulesExplored,
    boundExhausted,
    counterexamples,
    exploredAt: InstantSchema.parse(exploredAt),
  });
}

export function validateCounterexamples(
  model: FiniteModel,
  receipt: ModelCheckReceipt,
  replayer: ScheduleReplayer,
  reportedAt: string,
): ModelCheckReport {
  const verified = verifyFiniteModel(model);
  const parsed = ModelCheckReceiptSchema.parse(receipt);
  if (parsed.modelDigest !== verified.digest) {
    throw new ChangeProofError('Receipt belongs to a different model; refusing.');
  }
  if (!parsed.boundExhausted) {
    return report(verified, 'bound_incomplete', [], [], reportedAt);
  }
  if (parsed.counterexamples.length === 0) {
    return report(verified, 'holds_within_bound', [], [], reportedAt);
  }
  const confirmed: Counterexample[] = [];
  const refuted: Counterexample[] = [];
  for (const counterexample of parsed.counterexamples) {
    const actual = replayer.replay(counterexample.schedule);
    if (actual.endState === counterexample.endState && actual.violated.includes(counterexample.invariant)) {
      confirmed.push(counterexample);
    } else {
      refuted.push(counterexample);
    }
  }
  return report(
    verified,
    confirmed.length > 0 ? 'violated' : 'model_invalid',
    confirmed,
    refuted,
    reportedAt,
  );
}

function report(
  model: FiniteModel,
  verdict: 'holds_within_bound' | 'violated' | 'bound_incomplete' | 'model_invalid',
  confirmed: readonly Counterexample[],
  refuted: readonly Counterexample[],
  reportedAt: string,
): ModelCheckReport {
  return ModelCheckReportSchema.parse({
    schemaVersion: '1',
    modelDigest: model.digest,
    verdict,
    confirmed: [...confirmed],
    refuted: [...refuted],
    claimScope: {
      modelId: model.modelId,
      maxDepth: model.bound.maxDepth,
      maxSchedules: model.bound.maxSchedules,
    },
    reportedAt: InstantSchema.parse(reportedAt),
  });
}
