"""T-08 / WP3-04 — Modal Sandbox qualification probes (NEG3-10, NEG3-24).

Each probe runs inside one ephemeral Modal Sandbox (microVM) and checks a
single denial or isolation property a qualified guest boundary must hold:
no Docker socket, no cloud metadata, no guest secrets, no privileged device
creation, and a recorded non-root expectation. Cleanup terminates the
sandbox and confirms it before the receipt is printed.

Credentials come only from the MODAL_TOKEN_ID / MODAL_TOKEN_SECRET
environment variables. Secret values are never printed (only set/unset)
and never forwarded into the guest.

Real mode spends Modal credits. `--dry-run` performs zero network calls
and spends nothing; it only reports local wiring readiness.

Stdout carries exactly one JSON document: the dry-run report or the probe
receipt. Diagnostics go to stderr. Exit codes: 0 = document produced
(probe failures are evidence, not errors), 2 = fail-closed config error.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time

RECEIPT_SCHEMA = "t08-probe/1"
BOUNDARY_CLASS = "microvm"
APP_NAME = "changeproof-t08-probes"
IMAGE_REF = "modal.Image.debian_slim()"
SANDBOX_CPU = 0.25
SANDBOX_MEMORY_MB = 256
SANDBOX_TIMEOUT_S = 600
SECRET_NAME_HINTS = ("TOKEN", "SECRET", "PASSWORD", "PRIVATE_KEY", "API_KEY")


def eprint(message: str) -> None:
    print(message, file=sys.stderr)


def make_run_id() -> str:
    return f"run-{int(time.time())}-{random.randint(100000, 999999)}"


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run T-08 guest-isolation probes in a Modal Sandbox."
    )
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args(argv)


def dry_run() -> int:
    try:
        import modal  # noqa: F401

        modal_state = f"installed ({modal.__version__})"
    except Exception as exc:  # fail closed: report, do not proceed
        modal_state = f"missing ({exc})"
    print(
        json.dumps(
            {
                "schemaVersion": RECEIPT_SCHEMA,
                "mode": "dry-run",
                "modal": modal_state,
                "credentials": {
                    "MODAL_TOKEN_ID": "set"
                    if os.environ.get("MODAL_TOKEN_ID")
                    else "unset",
                    "MODAL_TOKEN_SECRET": "set"
                    if os.environ.get("MODAL_TOKEN_SECRET")
                    else "unset",
                },
                "note": "DRY RUN — wiring only, NOT qualification evidence. "
                "No network call was made and no credit was spent.",
            }
        )
    )
    return 0


def exec_in(sandbox: object, argv: list[str]) -> dict:
    """Run one command in the sandbox; transport errors become inconclusive."""
    try:
        proc = sandbox.exec(*argv)  # type: ignore[attr-defined]
        stdout = proc.stdout.read()
        stderr = proc.stderr.read()
        return {
            "exitCode": proc.wait(),
            "stdout": stdout[-2000:],
            "stderr": stderr[-2000:],
            "transportError": None,
        }
    except Exception as exc:
        return {
            "exitCode": None,
            "stdout": "",
            "stderr": "",
            "transportError": str(exc),
        }


def check_denied(result: dict) -> str:
    # Exit 2 means the probe itself could not run (e.g. python3 absent for
    # the metadata check). That is inconclusive — never a pass.
    if result["transportError"] is not None or result["exitCode"] in (None, 2):
        return "inconclusive"
    return "pass" if result["exitCode"] != 0 else "fail"


PROBES: tuple[tuple[str, str, list[str]], ...] = (
    (
        "no-docker-socket",
        "Guest must not see a Docker socket (NEG3-24).",
        ["sh", "-c", "test ! -e /var/run/docker.sock && test ! -e /run/docker.sock"],
    ),
    (
        "non-root-uid",
        "Guest must not run as root.",
        ["sh", "-c", "test $(id -u) -ne 0"],
    ),
    (
        "no-device-creation",
        "Guest must not create device nodes (no privileged ops).",
        ["sh", "-c", "mknod /tmp/t08-probe-dev c 1 3 2>/dev/null; test $? -ne 0"],
    ),
    (
        "metadata-unreachable",
        "Cloud metadata endpoint must be unreachable from the guest.",
        [
            "sh",
            "-c",
            "if command -v python3 >/dev/null; then python3 -c "
            "'import urllib.request; urllib.request.urlopen"
            "(\"http://169.254.169.254/\", timeout=5)' 2>/dev/null; "
            "test $? -ne 0; else exit 2; fi",
        ],
    ),
)


def run_probes(sandbox: object) -> list[dict]:
    results = []
    for probe_id, purpose, argv in PROBES:
        result = exec_in(sandbox, argv)
        results.append(
            {
                "id": probe_id,
                "purpose": purpose,
                "exitCode": result["exitCode"],
                "stdoutTail": result["stdout"],
                "stderrTail": result["stderr"],
                "outcome": check_denied(result),
            }
        )
    env_result = exec_in(sandbox, ["env"])
    if env_result["transportError"] is not None:
        results.append(
            {
                "id": "no-guest-secrets",
                "purpose": "Guest env must carry no secret-bearing names.",
                "outcome": "inconclusive",
                "detail": f"could not read guest env: {env_result['transportError']}",
            }
        )
    else:
        names = sorted(
            line.split("=", 1)[0]
            for line in env_result["stdout"].splitlines()
            if "=" in line
        )
        leaked = [n for n in names if any(h in n.upper() for h in SECRET_NAME_HINTS)]
        results.append(
            {
                "id": "no-guest-secrets",
                "purpose": "Guest env must carry no secret-bearing names.",
                "outcome": "pass" if not leaked else "fail",
                "guestEnvNames": names,
                "leakedNames": leaked,
            }
        )
    return results


def compute_verdict(probes: list[dict]) -> str:
    outcomes = [p["outcome"] for p in probes]
    if all(o == "pass" for o in outcomes):
        return "pass"
    if any(o == "fail" for o in outcomes):
        return "fail"
    return "inconclusive"


def fail_closed(message: str) -> int:
    eprint(f"modal_sandbox_probe: BLOCKED — {message}")
    print(json.dumps({"ok": False, "error": message}))
    return 2


def create_sandbox(modal: object, run_id: str) -> tuple[object, str, dict]:
    app = modal.App.lookup(APP_NAME, create_if_missing=True)  # type: ignore[attr-defined]
    image = modal.Image.debian_slim()  # type: ignore[attr-defined]
    base: dict = {
        "app": app,
        "image": image,
        "cpu": SANDBOX_CPU,
        "memory": SANDBOX_MEMORY_MB,
        "timeout": SANDBOX_TIMEOUT_S,
    }
    try:
        sandbox = modal.Sandbox.create(**base, block_network=True)  # type: ignore[attr-defined]
        return sandbox, "blocked", base
    except TypeError:
        # Older client without the flag: proceed WITHOUT network isolation
        # and record the fallback honestly — the egress probe then decides.
        sandbox = modal.Sandbox.create(**base)  # type: ignore[attr-defined]
        return sandbox, "fallback-open (client lacks block_network)", base


def do_probes() -> int:
    if not os.environ.get("MODAL_TOKEN_ID") or not os.environ.get("MODAL_TOKEN_SECRET"):
        return fail_closed(
            "MODAL_TOKEN_ID / MODAL_TOKEN_SECRET are not set. "
            "Run `modal setup` or export both vars from workspace anndareynn17; "
            "nothing was spent and no probe ran."
        )
    try:
        import modal
    except Exception as exc:
        return fail_closed(
            f"modal client is not installed in .venv ({exc}). "
            "Run `.venv/Scripts/python -m pip install modal` first."
        )
    run_id = make_run_id()
    try:
        sandbox, network, config = create_sandbox(modal, run_id)
    except Exception as exc:
        return fail_closed(
            f"could not create a Modal Sandbox: {exc}. "
            "Check credentials, workspace, and network; nothing was spent on probes."
        )
    sandbox_id = str(getattr(sandbox, "object_id", run_id))
    probes = run_probes(sandbox)
    cleanup: dict = {"sandboxId": sandbox_id, "terminated": False, "confirmed": False}
    try:
        sandbox.terminate()  # type: ignore[attr-defined]
        cleanup["terminated"] = True
        try:
            sandbox.wait()  # type: ignore[attr-defined]
        except Exception:
            pass
        try:
            cleanup["confirmed"] = sandbox.poll() is not None  # type: ignore[attr-defined]
        except Exception as exc:
            cleanup["confirmError"] = str(exc)
    except Exception as exc:
        cleanup["terminateError"] = str(exc)
    receipt = {
        "schemaVersion": RECEIPT_SCHEMA,
        "mode": "modal-sandbox",
        "runId": run_id,
        "boundaryClass": BOUNDARY_CLASS,
        "provider": "modal-sandbox",
        "app": APP_NAME,
        "imageRef": IMAGE_REF,
        "imageDigestPinned": False,
        "sandboxId": sandbox_id,
        "limits": {
            "cpu": SANDBOX_CPU,
            "memoryMb": SANDBOX_MEMORY_MB,
            "timeoutS": SANDBOX_TIMEOUT_S,
        },
        "network": network,
        "probes": probes,
        "cleanup": cleanup,
        "verdict": compute_verdict(probes),
        "notes": [
            "imageDigestPinned=false: Modal resolves debian_slim server-side; "
            "pin the image before claiming full qualification.",
            "A revised candidate requires fresh proof; this receipt covers "
            "only this runId.",
        ],
    }
    print(json.dumps(receipt))
    return 0


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    if args.dry_run:
        return dry_run()
    return do_probes()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

