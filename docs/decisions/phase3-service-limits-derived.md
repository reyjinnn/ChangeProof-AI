# Decision: provisional service limits and blocker status [DERIVED]

Date: 2026-11-02. Status: provisional, to be replaced by calibrated values before acceptance.

## Decided (derived defaults, not measured)

- Free plan credit: USD 5/month per tenant (user-selected earlier).
- Internal hard cap: USD 5/month per tenant, enforced by `usage`. Meta only provides spend alerts, so the cap must be enforced on our side. Budget is never reset by retry/resume/cancel.
- Production latency target: p95 120 s per run `[DERIVED]`. It has not been measured and is not an SLO.
- Email vendor: undecided. The email adapter stays fail-closed (specific error, no silent default) until a vendor is chosen.

## Still blocked (needs the owner)

| Item | Needs | Gate effect |
| --- | --- | --- |
| Live Muse Spark evidence | Smoke call done (reachability only); live repair run still needs a bounded budget | proposalMode `live_model` unproven |
| Email vendor | Vendor choice and credentials | Live email integration blocked |
| GitHub App | Owner authorization/installation | G3-08/G3-10 stay `blocked` |

## Model smoke call (2026-11-02, owner-authorized in session)

- Endpoint `https://api.meta.ai/v1/chat/completions`, model `muse-spark-1.3`, HTTP 200, usage 12 prompt + 8 completion tokens (6 reasoning), `finish_reason=length`, content null because max_tokens was too small for reasoning.
- Up to 2 requests were made (the first PowerShell attempt printed no output, so it may also have reached the API). Cost is negligible but not measured.
- Proves only: key, endpoint and model name are reachable. Does NOT prove live repair capability; `live_model` proposal evidence remains unproven.

No other paid call was made. SC3-01 oracle remains sandbox-fixture only and does not complete WP3-06.
