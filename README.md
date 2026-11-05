# ChangeProof AI

## What is this?

**ChangeProof AI** is a tool that investigates, fixes, and proves the impact of software changes. A change counts as safe only when execution evidence says so.

The problem it solves: a small change rarely stays in one file. It propagates to other services, database schemas, event payloads, cache contents, and dependency versions. The breakage only surfaces later, somewhere else.

The workflow looks like this:

```text
intent / issue
  → impact graph
  → diagnosis
  → coordinated patch bundle
  → real execution
  → independent verification
  → immutable evidence
  → evidence-based PR
```

Core principles:

- A claim of "fixed" counts only when real execution results back it.
- Verdicts come only from deterministic policy applied to verifier evidence. The AI that did the work never grades its own output.
- Any gate that claims build, server, database, broker, or browser coverage must exercise the real system rather than mocks or cached results.
- When evidence is insufficient, the system still returns a diagnosis, explicit obstacles, and the next safe step. Obstacles are never disguised as success.

This repository is open for development contributions. Hosted/customer features mentioned in the specification documents are **product targets**, not claims that everything is already implemented.

---

## What can it do?

| Capability | Description |
| --- | --- |
| Impact graph | Builds a change impact graph with explicit per-edge confidence: `proven`, `inferred`, `unresolved`. `inferred` edges are never silently promoted to `proven`. |
| Diagnosis + patch bundle | Produces a diagnosis and a candidate bundle of coordinated patches across files, repositories, and languages instead of a single-file workaround. |
| Real-runtime verification | Runs actual compilers, servers, databases, brokers, and browsers, then evaluates each evidence dimension separately (never averaged into one score). |
| Permanent evidence | Stores immutable per-run evidence artifacts, so results can be re-audited at any time. |
| Web dashboard | UI for landing pages, registration/login (email plus optional GitHub OAuth), projects, runs, evidence, notifications, billing, teamwork, and enterprise pages. |
| Operator CLI (`changeproof`) | Self-hosting: `install`, `upgrade`, `backup`, `restore`, `teardown`, `status`, plus BYOK management (`byok-provision`, `byok-rotate`, `byok-revoke`). |
| Live probes | Verifies one real integration seam per command: `model-live` (one bounded model call), `modal-probe` (Modal sandbox isolation), `github-probe` (GitHub installation access). |
| JSON HTTP API | Auth, organization, runs, notifications, teamwork, billing, and enterprise endpoints behind the same server that hosts the dashboard. |

Language and framework support is delivered through **adapters** (TypeScript, Python, Go, PHP, .NET, native). Framework knowledge lives only in adapters, and verdict rules never change when an adapter is added.

---

## How to try it with Docker (recommended)

This is the easiest way. A single command starts the full stack: the application, PostgreSQL 16, and Mailpit (a fake SMTP server that captures verification emails).

### 1. Prerequisites

- **Git**
- **Docker Desktop** (includes `docker compose`), running
- Free ports: **4179** (application) and **8025** (Mailpit)

Verify the installation:

```powershell
git --version
docker --version
docker compose version
```

### 2. Clone the repository

```powershell
git clone <repository-url>
cd ChangeProof-AI
```

> Replace `<repository-url>` with the repository URL shared with you.

### 3. Prepare the `.env` file

Compose reads the `.env` file, and the server **refuses to start** without `CP_CHALLENGE_SECRET` (minimum 32 characters):

```powershell
Copy-Item .env.example .env
```

Then generate a random secret and add it to `.env`:

```powershell
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | ForEach-Object {[char]$_})
```

Add this line to `.env` (using the generated output above):

```text
CP_CHALLENGE_SECRET=<generated-40-character-output>
```

Notes on `.env`:

- `DATABASE_URL` and the SMTP settings do not need to be filled in. `compose.yaml` already wires them to the database and Mailpit inside the stack.
- GitHub login is **optional**: leave the `CP_GITHUB_*` variables empty and the application still runs (GitHub sign-in stays disabled). To enable it, all three of `CP_GITHUB_CLIENT_ID`, `CP_GITHUB_CLIENT_SECRET`, and `CP_GITHUB_REDIRECT_URL` must be set **together**. A partial set makes the server refuse to start.
- Model credentials (`CHANGEPROOF_MODEL_*`), Modal tokens (`MODAL_TOKEN_*`), and the GitHub installation token are only needed for advanced live probes and CLI usage, not for trying the dashboard.

### 4. Run

```powershell
docker compose up --build
```

The first build takes a while (dependency install, TypeScript compilation, dashboard build). Once a log line like this appears, the stack is ready:

```text
changeproof http listening on http://0.0.0.0:4179/
```

Open in a browser:

- Application: <http://127.0.0.1:4179>
- Mailpit (dev mailbox): <http://127.0.0.1:8025>

Suggested first steps: browse the public pages, register a new account, then pick up the verification link in Mailpit (no real emails are ever sent).

> To run in the background and keep the terminal free: `docker compose up --build -d`. View logs at any time with `docker compose logs -f app`.

### 5. Shut down

```powershell
docker compose down
```

This stops and removes the containers. **This stack is disposable by design:** there are no persistent volumes, so database contents are lost on every `down`. This is intentional for try-outs, so do not store anything important here.

### Other useful Docker commands

```powershell
docker compose ps              # show container status (app, pg, mailpit)
docker compose logs -f app     # follow the application log (Ctrl+C exits, app keeps running)
docker compose stop            # stop everything (containers are kept)
docker compose start           # start again after stop
docker compose up --build      # rebuild the image after code changes, then run
docker compose down            # stop and remove containers (data is lost)
```

Change ports in case of conflicts (for example, if port 4179 is already taken):

```powershell
$env:APP_PORT = '4180'; $env:MAILPIT_PORT = '8026'; docker compose up --build
```

> When GitHub login is used, the application port must match the callback URL registered on the GitHub OAuth App.

### Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| `CP_CHALLENGE_SECRET is required ...`, then the container exits | `.env` is missing or the variable is not set. Repeat step 3, then run `docker compose up --build` again. |
| `refusing a weak HMAC secret` | The secret is shorter than 32 characters. Generate a new 40-character one. |
| `port is already allocated` | Port 4179 or 8025 is used by another application. Change ports via `APP_PORT`/`MAILPIT_PORT` (see above) or stop the conflicting application. |
| `pg` keeps restarting, or the app waits for the database | Wait 10 to 30 seconds (initial migrations V1 to V13 run on first start). If it still fails: `docker compose down`, then `docker compose up --build` again. |
| Pages load but login/registration fails | Open <http://127.0.0.1:8025> (Mailpit) for the verification link; registration requires the email verification step. For other errors, check `docker compose logs app`. |
| Docker Desktop is not running | Start Docker Desktop first, wait until it is ready, then run compose. |

---

## Running without Docker (dev mode)

For contributors who want to work on the code rather than just try it. Requires the pinned versions: **Node.js 26.12.1** and **pnpm 12.5.1**.

```powershell
corepack enable
corepack prepare pnpm@12.5.1 --activate
node --version   # expected: v26.12.1
pnpm --version   # expected: 12.5.1

pnpm install --frozen-lockfile
pnpm build
pnpm build:ui
```

Then start the server (requires your own PostgreSQL and SMTP, or the `cp-dev-pg`/`cp-dev-mail` dev containers plus `./scripts/dev-local.ps1`, which loads `.env`):

```powershell
$env:PORT = '4179'
node dist/http/start.js
```

Commonly used dev and test commands:

```powershell
pnpm dev              # dashboard via Vite (proxies /api to port 4179)
pnpm typecheck        # strict type checking
pnpm lint             # ESLint plus inter-module boundary checks
pnpm test             # full test suite (Vitest)
pnpm test:e2e         # browser E2E with disposable Postgres/Mailpit
pnpm verify           # typecheck + lint + test in one go
```

---

## Repository contents (summary)

```text
src/                  TypeScript engine: core (contracts), modules (25 modules),
                      orchestrator (composition root), http (API + server),
                      cli (the changeproof binary)
apps/dashboard        product UI (Vite app)
apps/trace-viewer     trace viewer
config/ fixtures/     configuration, test data, runner/probe scripts
tests/ bench/         Vitest suites (unit, adapter, negative, security, E2E)
infra/                Postgres migrations (V1 to V13), self-host profiles, Docker init
docs/                 phase reports, feature coverage, decision records
.prepare/             specification package: BRD → PRD → MVP → architecture
phases/               execution playbooks for phases 1 to 7 plus the hackathon slice
compose.yaml          disposable Docker stack (app + pg + mailpit)
Dockerfile            application image (node 26.12.1, pnpm 12.5.1)
```

To contribute, read in order: `AGENTS.md` (working contract), then `SKILL.md` (playbook), then `.prepare/BRD.md`, `PRD.md`, `MVP.md`, and `architecture.md`. Never commit credentials or `.env` files.

---

## Status and limitations

- The Docker stack in this repository is **for development and try-outs only, not production**: disposable, no volumes, dev-only secrets.
- `src/http` and `apps/dashboard` exist and run; there is no worker entry point (`src/workers` is absent).
- Live integrations (a real GitHub App, isolated guest execution, model broker) require operator credentials and a security-boundary qualification that is still blocked. Without them, related claims stay unproven.
- Target figures in the specification documents (SLOs, cost, adoption) **have not been measured**. Do not quote them as results.

---

## License

The license field in `package.json` reads `SEE LICENSE IN docs/decisions/`. Check `docs/decisions/` for the exact license status before redistribution.

The bundled **Inter** and **Plus Jakarta Sans** fonts are licensed under the **SIL Open Font License 1.1** and self-hosted with zero external requests.
