import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { z } from 'zod';

// NEG3-28 guard: pilot preparation must never read as user impact.
// The register parses against a closed schema and contains zero
// records claiming adoption or repair until a real owner validates.
const CandidateSchema = z
  .object({
    pilotId: z.string().min(1),
    origin: z.enum(['current_organic', 'historical_organic']),
    status: z.enum(['proposed', 'authorized', 'running', 'blocked']),
    outcomeClaimed: z.literal(false),
  })
  .strict();

const RegisterSchema = z
  .object({ version: z.literal(1), updated: z.string().min(1), candidates: z.array(CandidateSchema) })
  .strict();

const register = RegisterSchema.parse(
  JSON.parse(readFileSync(new URL('../../config/pilot/register.json', import.meta.url), 'utf8')),
);

test('pilot register holds no adoption or repair claims', () => {
  expect(register.candidates.filter((c) => c.status === 'authorized')).toHaveLength(0);
  for (const c of register.candidates) expect(c.outcomeClaimed).toBe(false);
});

test('controlled mutations are rejected as SC3-06 provenance', () => {
  expect(() =>
    CandidateSchema.parse({ pilotId: 'x', origin: 'controlled_change', status: 'proposed', outcomeClaimed: false }),
  ).toThrow();
});
