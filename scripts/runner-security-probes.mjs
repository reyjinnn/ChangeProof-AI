#!/usr/bin/env node
/**
 * Native runner security probes (WP3-04 / T1-6).
 *
 * These probes run against a **real** container runtime. They are the native
 * evidence for the guest boundary: they observe what a guest can and cannot
 * reach, and they observe that a terminated run leaves nothing behind.
 *
 * Scope and honest limits:
 *
 *  - The boundary exercised here is a container on Docker Desktop's WSL2
 *    backend. Per `PRD` FR3-32 and `architecture.md` §17.5, container-only
 *    evidence does **not** qualify public hosted execution. This script reports
 *    `boundaryClass: container_only` and the phase report withholds any public
 *    readiness claim. Raising the class needs a VM/microVM boundary and its
 *    own evidence.
 *  - Every probe is expected to FAIL from inside the guest: the assertions are
 *    about denial, not about capability.
 *
 * Exit code 0 means every probe denied what it had to deny and cleanup held.
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const IMAGE = process.env['PROBE_IMAGE'] ?? 'alpine:3.20';

function docker(args, options = {}) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 120_000,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function dockerAvailable() {
  try {
    docker(['info', '--format', '{{.ServerVersion}}'], { timeoutMs: 15_000 });
    return true;
  } catch {
    return false;
  }
}

const results = [];

function record(name, denied, detail) {
  results.push({ name, denied, detail });
  const status = denied ? 'DENIED (expected)' : 'NOT DENIED (probe failure)';
  process.stdout.write(`${denied ? 'ok  ' : 'FAIL'} ${name}: ${status} — ${detail}\n`);
}

function runInGuest(script) {
  try {
    const output = docker([
      'run', '--rm',
      '--network', 'none',
      '--memory', '256m',
      '--pids-limit', '64',
      '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges',
      '--user', '65534:65534',
      IMAGE,
      'sh', '-c', script,
    ], { timeoutMs: 120_000 });
    return { ran: true, output };
  } catch (error) {
    const failure = error;
    return {
      ran: false,
      output: `${failure.stdout ?? ''}\n${failure.stderr ?? ''}`,
      exitCode: failure.status ?? 1,
    };
  }
}

if (!dockerAvailable()) {
  process.stdout.write('BLOCKED: no container runtime is reachable on this host.\n');
  process.stdout.write('Native isolation evidence is a missing check, not a pass.\n');
  process.exit(2);
}

process.stdout.write(`boundaryClass: container_only\nimage: ${IMAGE}\n\n`);

// 1. The guest must not be able to reach the host network.
{
  const result = runInGuest('wget -q -T 3 -O- http://host.docker.internal/ >/dev/null 2>&1 && echo REACHED || echo BLOCKED');
  const denied = !result.output.includes('REACHED');
  record('host-network-egress', denied, result.output.trim().split('\n').pop() ?? '');
}

// 2. The guest must not see a Docker socket.
{
  const result = runInGuest('ls -l /var/run/docker.sock 2>/dev/null && echo SOCKET_PRESENT || echo NO_SOCKET');
  const denied = !result.output.includes('SOCKET_PRESENT');
  record('docker-socket-absent', denied, result.output.trim().split('\n').pop() ?? '');
}

// 3. The guest must not see cloud instance metadata.
{
  const result = runInGuest('wget -q -T 3 -O- http://169.254.169.254/latest/meta-data/ >/dev/null 2>&1 && echo REACHED || echo BLOCKED');
  const denied = !result.output.includes('REACHED');
  record('cloud-metadata-unreachable', denied, result.output.trim().split('\n').pop() ?? '');
}

// 4. The guest must run as a non-root user.
{
  const result = runInGuest('id -u');
  const uid = Number.parseInt(result.output.trim(), 10);
  record('non-root-user', Number.isFinite(uid) && uid !== 0, `uid=${result.output.trim()}`);
}

// 5. The guest must have no capabilities.
{
  const result = runInGuest('grep CapEff /proc/self/status');
  const effective = result.output.split('CapEff:')[1]?.trim() ?? '';
  const isZero = effective === '0000000000000000';
  record('no-capabilities', isZero, `CapEff=${effective}`);
}

// 6. A killed container must leave no container behind.
{
  const name = `changeproof-cleanup-${randomUUID().slice(0, 8)}`;
  const id = docker(['run', '-d', '--name', name, IMAGE, 'sh', '-c', 'sleep 300']).trim();
  const removed = docker(['rm', '-f', name]).trim();
  let stillPresent = true;
  try {
    docker(['inspect', name], { timeoutMs: 15_000 });
  } catch {
    stillPresent = false;
  }
  record('container-removed-on-kill', !stillPresent, `removed=${removed.length > 0} id=${id.slice(0, 12)}`);
}

const failed = results.filter((result) => !result.denied);
process.stdout.write(`\n${results.length - failed.length}/${results.length} probes denied as required.\n`);

if (failed.length > 0) {
  process.stdout.write('A probe was NOT denied: the boundary did not hold for that path.\n');
  process.exit(1);
}
process.exit(0);
