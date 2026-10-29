# DEC3-P1-03 — Phase-1 isolation boundary for the guest runner

**Status:** `accepted` 26 October 2026, with an explicit restriction attached
**Decision class:** `[DERIVED]` — boundary selection. It does **not** relax any isolation requirement.

## Decision

The phase-1 guest runner (WP3-04) targets a **Docker container per run**, with `Docker Desktop` on
Windows 11 Home using the WSL2 backend as the host runtime.

### Mandatory restriction that travels with this decision

A non-root container is **not** sufficient evidence of public hosted readiness. This is stated
directly in three normative places:

- `.prepare/PRD.md` FR3-32: "VM/microVM-per-job or alternative equivalent isolation must prove denial of host
  sockets/cloud metadata, cross-tenant/run network/volumes/cache, control-plane access, privileged
  operations and secrets. **Container-only smoke does not pass public hosted execution.**"
- `.prepare/architecture.md` §17.5: "The minimum sandbox requires a VM/microVM boundary per job or an
  alternative demonstrating equivalent isolation; **non-root containers alone are insufficient
  evidence of public hosted readiness.**"
- `phases/phase-1.md` T1-6: "**Container smoke alone is explicitly insufficient.**"

Therefore this decision carries the following consequences, all of which must appear in the phase
report verbatim in meaning:

| Consequence | Effect |
| --- | --- |
| Service scope | Hosted execution is limited to **allowlisted pilots** while the boundary is unqualified. |
| Public readiness | Any claim of public hosted readiness is **withheld**, not deferred quietly. |
| Boundary class | Evidence produced under this boundary is `container_only`, a distinct class from a qualified VM/microVM boundary. It is never relabeled `qualified`. |
| Escape probes | Probes that cannot be run under this boundary are recorded as `missing check`, never as a pass. |

The runner additionally must still prove, per run: non-root user, dropped capabilities,
`no-new-privileges`, seccomp/AppArmor confinement, CPU/memory/PID/disk caps, read-only protected mount
for the oracle, no Docker socket, no secrets, default-closed egress with only supervisor-allowlisted
private per-run service connections, and cleanup of services/volumes/networks/ephemeral credentials
with a receipt persisted **before** cleanup.

## Why container-only is not accepted as qualified

The threat model is *hostile customer source executing with no ambient authority*. A container shares
the host kernel. Without virtualization, a kernel-level escape reaches the control plane. A VM/microVM
boundary puts a hypervisor between untrusted code and the host, which is the property the requirement
is actually about. Recording the boundary class truthfully is what keeps the pilot restriction
enforceable instead of aspirational.

## Blockers recorded by this decision

| Blocker | Effect on phase-1 |
| --- | --- |
| Docker daemon is not running on this host | Native isolation and cleanup probes cannot run. WP3-04 native evidence is `blocked` until the daemon starts. |
| Windows 11 Home has no Hyper-V; microVMs are Linux-only | A qualified VM/microVM boundary requires a remote-Linux runner or an equivalent boundary that is not available in this session. Not simulated. |

Raising this to a qualified boundary is a **new decision** with its own evidence. It is not a
configuration change.
