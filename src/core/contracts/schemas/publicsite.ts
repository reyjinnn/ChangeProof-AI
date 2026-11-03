import { z } from 'zod';

import { IdSchema, NonEmptyStringSchema } from '../primitives.js';

/**
 * Public website contracts (FR3-37, WP3-27).
 *
 * Everything a guest may read without login: routes, FAQs, templates, sample
 * reports, changelog, roadmap, and pricing. Every object is closed
 * (`strictObject`), so tenant-shaped fields are rejected at parse time
 * (NEG3-21, first layer). Samples are synthetic by construction and carry
 * provenance; design notes and releases are separate kinds; pricing always
 * carries its source version so a price is never guessed.
 */

export const PublicCtaSchema = z.strictObject({
  label: NonEmptyStringSchema,
  destination: NonEmptyStringSchema,
  kind: z.enum(['public', 'requires-login']),
});
export type PublicCta = z.infer<typeof PublicCtaSchema>;

export const PublicRouteSchema = z.strictObject({
  path: z.string().regex(/^\//, 'public route paths start with /'),
  title: NonEmptyStringSchema,
  summary: NonEmptyStringSchema,
  section: z.enum(['product', 'docs', 'company', 'legal']),
  ctas: z.array(PublicCtaSchema),
});
export type PublicRoute = z.infer<typeof PublicRouteSchema>;

export const PublicFaqSchema = z.strictObject({
  id: IdSchema,
  question: NonEmptyStringSchema,
  answer: NonEmptyStringSchema,
  topics: z.array(NonEmptyStringSchema).min(1),
  updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'updatedAt is a calendar date'),
});
export type PublicFaq = z.infer<typeof PublicFaqSchema>;

export const PublicTemplateFieldSchema = z.strictObject({
  name: IdSchema,
  label: NonEmptyStringSchema,
  help: NonEmptyStringSchema,
});
export type PublicTemplateField = z.infer<typeof PublicTemplateFieldSchema>;

export const PublicTemplateSchema = z.strictObject({
  id: IdSchema,
  title: NonEmptyStringSchema,
  description: NonEmptyStringSchema,
  requiresLogin: z.literal(true),
  fields: z.array(PublicTemplateFieldSchema).min(1),
});
export type PublicTemplate = z.infer<typeof PublicTemplateSchema>;

export const SampleProvenanceSchema = z
  .strictObject({
    datasetId: IdSchema,
    datasetVersion: NonEmptyStringSchema,
    capturedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'capturedAt is a calendar date'),
    synthetic: z.literal(true),
    source: z.literal('static-sample-dataset'),
    label: NonEmptyStringSchema,
  })
  .describe('Samples come only from the separate static dataset and say so');
export type SampleProvenance = z.infer<typeof SampleProvenanceSchema>;

export const SampleReportSchema = z.strictObject({
  id: IdSchema,
  title: NonEmptyStringSchema,
  summary: NonEmptyStringSchema,
  provenance: SampleProvenanceSchema,
});
export type SampleReport = z.infer<typeof SampleReportSchema>;

export const ChangelogEntrySchema = z.strictObject({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date is a calendar date'),
  kind: z.enum(['design', 'release']),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'releases carry a semver version').optional(),
  title: NonEmptyStringSchema,
  body: NonEmptyStringSchema,
}).superRefine((entry, ctx) => {
  if (entry.kind === 'release' && entry.version === undefined) {
    ctx.addIssue({ code: 'custom', path: ['version'], message: 'A release entry needs its version.' });
  }
});
export type ChangelogEntry = z.infer<typeof ChangelogEntrySchema>;

export const RoadmapItemSchema = z.strictObject({
  id: IdSchema,
  title: NonEmptyStringSchema,
  status: z.enum(['supported', 'in-qualification', 'planned']),
  evidenceRef: NonEmptyStringSchema.optional(),
});
export type RoadmapItem = z.infer<typeof RoadmapItemSchema>;

export const PricingTierSchema = z.strictObject({
  id: IdSchema,
  name: NonEmptyStringSchema,
  notes: NonEmptyStringSchema,
});
export type PricingTier = z.infer<typeof PricingTierSchema>;

export const PricingSnapshotSchema = z.strictObject({
  pricingVersion: NonEmptyStringSchema,
  currency: z.string().regex(/^[A-Z]{3}$/, 'currency is an ISO code'),
  tiers: z.array(PricingTierSchema).min(1),
});
export type PricingSnapshot = z.infer<typeof PricingSnapshotSchema>;

export const PublicSiteManifestSchema = z.strictObject({
  schemaVersion: z.literal('1'),
  contentVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'contentVersion is a calendar date'),
  routes: z.array(PublicRouteSchema).min(1),
  faqs: z.array(PublicFaqSchema).min(1),
  templates: z.array(PublicTemplateSchema).min(1),
  samples: z.array(SampleReportSchema).min(1),
  changelog: z.array(ChangelogEntrySchema).min(1),
  roadmap: z.array(RoadmapItemSchema).min(1),
  pricing: PricingSnapshotSchema,
});
export type PublicSiteManifest = z.infer<typeof PublicSiteManifestSchema>;
