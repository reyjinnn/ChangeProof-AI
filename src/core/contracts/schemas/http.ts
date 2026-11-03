import { z } from 'zod';

import { NonEmptyStringSchema } from '../primitives.js';

/**
 * HTTP API envelope (WP3-25/27, phase-6).
 *
 * Every JSON response from `src/http` uses this shape so the dashboard can
 * narrow success from failure at runtime without guessing. Error codes are
 * closed enums per surface; messages are human-readable and carry no tenant
 * internals. Browser-safe: the dashboard imports the types only.
 */

export const ApiErrorSchema = z.strictObject({
  code: NonEmptyStringSchema,
  message: NonEmptyStringSchema,
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const ApiOkSchema = z.strictObject({
  ok: z.literal(true),
  data: z.unknown(),
});
export type ApiOk = z.infer<typeof ApiOkSchema>;

export const ApiFailSchema = z.strictObject({
  ok: z.literal(false),
  error: ApiErrorSchema,
});
export type ApiFail = z.infer<typeof ApiFailSchema>;

export const ApiEnvelopeSchema = z.union([ApiOkSchema, ApiFailSchema]);
export type ApiEnvelope = z.infer<typeof ApiEnvelopeSchema>;

export const HealthDataSchema = z.strictObject({
  status: z.literal('ok'),
  service: z.literal('changeproof'),
  contentVersion: NonEmptyStringSchema,
});
export type HealthData = z.infer<typeof HealthDataSchema>;
