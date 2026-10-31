# T-08 runner qualification: blocked, no qualified host (dangling probe declaration removed)

**Date:** 30 October 2026
**Task:** T-08 / T1-6 / WP3-04
**Owner:** Reyn
**Requirements:** NFR3-04..08; NEG3-10/24
**Prior record:** `docs/decisions/phase1-isolation-boundary.md` (accepted `container_only` boundary with pilot-only restriction)

## Decision

Qualified guest isolation stays **`blocked`** on this host. No qualified
VM/microVM (or proven-equivalent) boundary is available, so no native
qualification evidence is claimed. The dangling
`test:runner-security:native` declaration is removed instead of implemented:
a probe script that can only ever report `container_only` on this host would
add code without changing the verdict.

## Host evidence (read-only checks, this run)

- `Test-Path scripts` → `False`: the `scripts/` tree does not exist, so
  `node scripts/runner-security-probes.mjs` never had a target.
- OS: `Windows 10 Home Single Language` (Home edition ships no Hyper-V).
- `(Get-CimInstance Win32_ComputerSystem).HypervisorPresent` → `True`: a
  hypervisor runs (consistent with a WSL2 backend), but that is **not** a
  qualified per-job VM/microVM guest boundary for hostile customer source —
  containers still share a kernel, per the accepted boundary decision.
- `docker version` shows client `29.0.1`; the server section was not captured
  and daemon reachability was not re-proven in this run. It does not matter
  for the verdict: even with a running daemon the boundary class stays
  `container_only`, which the spec explicitly refuses as qualification
  (PRD FR3-32, architecture §17.5, phase-1 T1-6).
- `wsl --status` did not return promptly and was terminated; no conclusion is
  drawn from it.

## What changed in this task

1. `package.json`: removed the `test:runner-security:native` line (dangling
   declaration; target never existed in history). Native runner probes now
   have no runner on this host — recorded as absent, never as passing.
2. `README.md`: removed the run instruction and the scripts-table row for the
   deleted command, replaced with a pointer to this decision.
3. This decision record.

## What was deliberately not changed

- `src/modules/verifier`: reviewed, no edit. `RunnerProfileSchema` still
  forbids root, Docker-socket mounts, secrets in guests, and host/bridge
  networking; `buildRunnerProfile` still hardcodes a non-root user with no
  socket and no secrets, defaulting to `boundaryClass: 'container_only'`.
  No boundary class was added, renamed, or relabeled.
- `tests/security/runner.test.ts`: untouched contract-level tests (14 tests);
  they do not claim native qualification and are reported separately below.
- `task-brief.md` and `docs/phase-reports/`: untouched. They already record
  T-08/WP3-04 as blocked and the probe script as a missing check; history is
  not rewritten. This record links back to T-08 instead.

## Mock vs native, commands recorded

- `pnpm test:security` (contract-level, mock/synthetic): exit 0, 14 tests.
- Native qualification probes: no runner — not run, not passing, not skipped
  silently. Historical 6/6 Docker denial probes remain `container_only`
  evidence and are not re-claimed here.
- `pnpm typecheck`, `pnpm lint` (incl. dependency-cruiser): exit 0.

## Update: E1 VM probe passed on Modal (authorized spend, same day)

Modal credentials (`MODAL_TOKEN_ID`/`MODAL_TOKEN_SECRET` in gitignored
`.env`) and CLI 1.6.3 verified; `modal app list` exit 0. SDK confirms
`Sandbox.create(..., runtime='vm')`. Ran one bounded probe (scratch script
`%TEMP%\modal-probe\probe_vm.py`, kept out of the repo; no secrets passed to
the guest, no GPU):

- Attempt 1 exit 1: `Sandbox.create` needs an `App` outside a container —
  fixed with an ephemeral `App` (no deployed residue).
- Attempt 2 exit 1: local Python 3.10 rejected by the image builder — pinned
  `debian_slim(python_version="3.12")`.
- Attempt 3 exit 0, sandbox `sb-01M69VKV2HMZTSEE51ZS92QFF3`,
  `runtime='vm'`, 2026-10-31T20:49:52Z → 20:50:16Z (~24 s):
  - P1 metadata endpoint `169.254.169.254` unreachable (`TimeoutError`) → pass.
  - P2 `/var/run/docker.sock` absent → pass.
  - P5 `terminate()` + poll loop confirmed dead (`final_returncode: 137`) → pass.
  - Informational: in-VM `uid=0(root)` (boundary is the VM, not the in-VM
    user); egress reachable on the default network (product runs would use
    `block_network`). Prior run's sandbox was verified dead the same way, so
    no stray spend; exact cents not measured, bounded by seconds of CPU-only
    VM time under the $30 usage limit.
- Verdict: `vm_boundary_evidence_single_run`. Limits stated honestly: single
  run, no cross-tenant case, no cancel-mid-workload case.

## Unblock path (E1 executed — see update above)

Provision a VM/microVM-capable Linux host (or a boundary proven equivalent
with its own qualification decision), implement the probe script there, and
re-prove escape/cancel/cleanup/quarantine with receipts on that host.
Raising the boundary is a new decision with its own evidence, not a config
change. Public hosted readiness stays withheld until then; hosted execution
stays limited to allowlisted pilots.
