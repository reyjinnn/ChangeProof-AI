# DEC3-P3-01 — SC3-01 sandbox calibration freeze

**Status:** accepted (1 November 2026)  
**Decision class:** owner-approved, scope-limited calibration decision  
**Scope:** disposable SC3-01 baseline fixture only

## Decision

Freeze the existing sandbox proposal for the disposable SC3-01 fixture:

- Absolute order-fulfilled p50 threshold: 2000ms, evaluated with
  `lower-median-p50` and `{comparison:'lt'}`.
- Candidate relative margin: +20% on the pooled lower-median.
- Baseline stability: 3 consecutive fulfilled orders per baseline.

The +20% comparison applies only after a candidate arm exists. The baseline
measurements remain the recorded local measurements; this decision does not
alter the application, intent, oracle, dataset, or measured receipts.

## Limits

These values are not qualified-hardware SLOs, HostedServiceProfile values,
customer promises, or evidence that a candidate passes. The local rig's
100ms polling observer effect remains; a qualified campaign must use
server-side fulfillment timestamps. The candidate arm, frozen arrival model,
warmup/measurement/cooldown, independent windows, Amax/Qmax, pool/lock bounds,
dataset scale, and cost cap remain open.

This decision does not freeze usage/free-tier caps, a `rateVersion`, any
HostedServiceProfile field, or a paid model-call budget.

## Evidence and traceability

- Proposal and measured context: `fixtures/sc3-baseline/CALIBRATION-PROPOSAL.md`
- Requirement: FR3-27.2/FR3-27.6; MVP §16
- No schema or policy semantics changed; no contract version bump is required.
- This decision alone does not complete WP3-17 or pass a G3 gate.
