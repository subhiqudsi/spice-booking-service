# Spice Booking Service

![Draft v0.5](https://img.shields.io/badge/design-draft%20v0.5-3546c8) ![Pilot](https://img.shields.io/badge/status-pilot-9a6200) ![NestJS](https://img.shields.io/badge/NestJS-11-e0234e) ![First platform: SevenRooms](https://img.shields.io/badge/first%20platform-SevenRooms-1a2030)

One API for Spice apps to look up shift times and book tables on outside reservation platforms. SevenRooms has no
usable API, so the pilot drives its public booking page with a headless browser. When a script fails, an AI agent
repairs it. Every booking ends `confirmed` or `failed`, and the result is pushed to the caller through a signed webhook.

The full design, with every decision and open point, is in [DESIGN.md](DESIGN.md). This README is the summary.

- [Quick start](#quick-start)
- [1. Architecture](#1-architecture)
- [2. Authentication](#2-authentication)
- [3. API](#3-api)
- [4. Booking flow](#4-booking-flow)
- [5. Self-healing scripts](#5-self-healing-scripts)
- [6. Audit and error logs](#6-audit-and-error-logs)
- [7. SevenRooms findings](#7-sevenrooms-findings)
- [8. Configuration](#8-configuration)
- [9. Decisions and open points](#9-decisions-and-open-points)
- [Project layout](#project-layout)

---

## Quick start

Needs Node 20.19+ and Docker.

```bash
npm install
```

```bash
docker compose up -d --wait
```

```bash
cp .env.example .env
```

Fill in `.env` (every value is checked at startup; see [Configuration](#8-configuration)). Then:

```bash
npx prisma migrate deploy
```

```bash
npm run apikey:create -- --client "Spice backend" --scopes shifts:read,reservations:write,reservations:read
```

```bash
npm run dev:api
```

```bash
npm run dev:worker
```

The API listens on `PORT` (default 3000); `GET /health` needs no auth. Tests:

```bash
npm test
```

> **What works today:** everything below runs against a deterministic **fake provider** (platform id `fake`).
> The SevenRooms provider and the repair agent are still placeholders (delivery-plan steps 2 and 5–6 in DESIGN.md §12).

---

## 1. Architecture

**Two apps, one queue between them.** The `api` app answers HTTP requests and never opens a browser. Anything slow or
heavy goes through BullMQ to the `worker` app, which runs Playwright, the AI agents and the webhook sender. Generated
scripts live in their own git repo, so fixing a script doesn't need a deploy.

![Architecture: the api app checks the API key and JWT, caches shift times, queues bookings and writes audit rows; the worker runs browser scripts against sevenrooms.com, queues a repair on a script failure, and pushes every final booking status to the status webhook](docs/diagrams/architecture.svg)

*Figure 1.* The two apps talk only through Redis and Postgres. The highlighted boxes are the trust boundaries: the guards
in front of the API and the sandbox around generated code. A script failure goes straight to the repair trigger. Every
final booking status is saved to a Postgres outbox, and the webhook sender delivers it to `RESERVATION_WEBHOOK_URL`.

---

## 2. Authentication

**Two credentials on every call** (only `/health` is exempt).

| Header | Proves | Checked by | Failure |
|---|---|---|---|
| `x-api-key` | The calling system may use the booking service. Scoped: `shifts:read`, `reservations:write`, `reservations:read`, `admin` | `ApiKeyGuard`: looks up the key by prefix, compares hashes in constant time, checks scopes | `401 UNAUTHORIZED` · `403 FORBIDDEN` |
| `Authorization: Bearer` | Who the caller is in Spice's other services. A JWT | `ServiceAuthGuard`: `jose` + cached JWKS. Only RS256/ES256 accepted. Checks `iss`, `aud`, `exp` (30 s skew) and that `sub` is present | `401 INVALID_SERVICE_TOKEN` · `503 SERVICE_AUTH_UNAVAILABLE` |

![Where the JWT may travel: only to the Contact system and Spice services; never to queue jobs, scripts, agents, sevenrooms.com, logs, audit rows or error rows](docs/diagrams/jwt-boundary.svg)

*Figure 2.* The JWT stays inside the API request. Bookings finish in the background after the token may have expired, so
the contact lookup runs before the job is queued. The worker gets encrypted contact details and never the token.
Background jobs call other services with the booking service's own credentials.

---

## 3. API

| Endpoint | Scope | What it does |
|---|---|---|
| `GET /v1/restaurants/:id/shifts?date&party_size` | `shifts:read` | Lists the slots the automation can book. `party_size` is required. Each slot has a signed `slot_token` (venue, shift, time, party size). Cached 1–3 min |
| `POST /v1/reservations` | `reservations:write` | Requires an `Idempotency-Key` header. Looks up the venue, fetches contact details with the JWT, queues the booking, returns `202 pending` |
| `GET /v1/reservations?filter=upcoming\|previous\|all` | `reservations:read` | The calling user's reservations (same API client, same JWT user). `upcoming`: soonest first; `previous` and `all`: latest first. Optional `status`, `limit` (≤100), `cursor` |
| `GET /v1/reservations/:id` | `reservations:read` | One reservation, only for the user who made it. A fallback: the final status is pushed through the status webhook |
| `/internal/*` | `admin` | Restaurants (by hand / CSV), venue-mapping review, scripts and rollback, agent runs, API keys, audit-log and error-log search, webhook deliveries and replay |

**Submit request**

```http
POST /v1/reservations
x-api-key: bks_live_a1b2c3d4_…
Authorization: Bearer eyJhbGciOiJSUzI1NiIs…
Idempotency-Key: 6f1c…

{
  "restaurant_id": "spice-123",
  "datetime": "2026-11-20T19:00:00+04:00",
  "party_size": 4,
  "slot_token": "opaque-abc"
}
```

**Every error has the same shape**

```json
{
  "error": {
    "code": "VENUE_NOT_MAPPED",
    "message": "Restaurant spice-123 has no verified SevenRooms venue.",
    "request_id": "01JD3K…",
    "details": []
  }
}
```

`400 VALIDATION_ERROR` · `401 UNAUTHORIZED / INVALID_SERVICE_TOKEN` · `403 FORBIDDEN` · `404 *_NOT_FOUND` ·
`409 IDEMPOTENCY_CONFLICT` · `422 VENUE_NOT_MAPPED / VENUE_NOT_BOOKABLE` · `429 RATE_LIMITED` ·
`502 CONTACT_LOOKUP_FAILED` · `503 SERVICE_AUTH_UNAVAILABLE` · `500 INTERNAL_ERROR`

---

## 4. Booking flow

**From request to confirmed table.** A browser booking takes 10–40 seconds, so the API replies at once and the worker
finishes the booking. Before reporting success, the script reads SevenRooms' confirmation screen and checks the date,
time and party size against the request. Users never have to act: every booking ends `confirmed` or `failed`, and the
final status is pushed through the status webhook, so nobody has to poll.

![Booking sequence: guards check the key and JWT, the API fetches contact details with the JWT, queues a job with encrypted contact data and no token, and replies 202; the worker fills the booking form, checks the confirmation and the status webhook delivers reservation.confirmed](docs/diagrams/booking-sequence.svg)

*Figure 3.* Accent arrows mark where the token boundary matters: the JWT goes to the Contact system, and the queued job
carries no token. The last arrow is the status webhook (signed, retried) that pushes the result. Solid arrows are calls
and dashed arrows are replies.

![Reservation states: pending, then confirmed or failed; both send one event to the status webhook](docs/diagrams/reservation-states.svg)

*Figure 4.* There are only three states, and no state waits on a user. Each reservation sends exactly one status event,
when it leaves `pending`. A failure before the confirm click may be retried twice. If the click happened but no
confirmation was read, the result is `OUTCOME_UNKNOWN`, which is never retried so nothing is booked twice.

![Status webhook delivery: status and outbox row in one transaction, BullMQ job keyed by event id, signed POST, 2xx delivered, errors retried with backoff, dead after max attempts, sweeper re-queues stuck rows](docs/diagrams/status-webhook.svg)

*Figure 5.* Status webhook delivery, the same for `reservation.confirmed` and `reservation.failed`. The status change and
its outbox row are saved together, so an event survives a Redis outage. Delivery is at-least-once: the receiver should
de-duplicate on `event_id`, check the `x-booking-signature` HMAC, and reject timestamps older than 5 minutes. The
payload never includes contact details or tokens.

**Status event**

```http
POST $RESERVATION_WEBHOOK_URL
x-booking-event-id: evt_01JD3K…
x-booking-timestamp: 1763287331
x-booking-signature: sha256=…

{
  "type": "reservation.confirmed",
  "status": "confirmed",
  "reservation_id": "res_01JD3J…",
  "restaurant_id": "spice-123",
  "venue_id": "rowon45",
  "datetime": "2026-11-20T15:00:00.000Z",
  "party_size": 4,
  "platform_confirmation_code": "ABC123",
  "error_code": null,
  "error_message": null,
  "submitted": true,
  "request_id": "01JD3J…"
}
```

A `reservation.failed` event has the same shape, with `platform_confirmation_code: null` and `error_code` /
`error_message` filled in. The signature is `sha256=<hex HMAC-SHA256(RESERVATION_WEBHOOK_SECRET, timestamp + "." + raw body)>`.

**Failure codes in `reservation.failed`**

| Code | Meaning |
|---|---|
| `PLATFORM_BLOCKED` | Challenge page at checkout; nothing submitted |
| `UNEXPECTED_STEP` | An unknown screen or field; nothing submitted; **starts a repair** |
| `SLOT_UNAVAILABLE` | The time was taken before booking |
| `CONFIRMATION_MISMATCH` | Confirmation details differ from the request; **starts a repair** |
| `OUTCOME_UNKNOWN` | Confirm clicked, no confirmation read. `submitted: true`; check with the venue |
| `PLATFORM_UNAVAILABLE` | SevenRooms down or timing out after retries |
| `SCRIPT_FAILED` | The script broke; **starts a repair** |

---

## 5. Self-healing scripts

**A script failure starts the repair.**

![Repair loop: script failure, repair queue (one per script, budget), script agent, validation gates, commit, canary at 10% of traffic, active; failed validation retries up to 3 times then alerts a person; a canary that does worse is rolled back](docs/diagrams/repair-loop.svg)

*Figure 6.* The repair loop starts on a failure. There is no schedule and no error-rate threshold. `SCRIPT_FAILED`,
`UNEXPECTED_STEP` and `CONFIRMATION_MISMATCH` (or a broken shift-times script) queue a repair with job id
`<platform>-<operation>`. More failures while it is queued, running or in its 30-minute cooldown are folded into it.
`PLATFORM_BLOCKED` and `PLATFORM_UNAVAILABLE` don't start one, because a new script won't fix them; they alert a person.
Every step is audited.

**Validation gates**

1. **Static:** ESLint bans `fs`, `child_process`, `net`, `process.env` and `eval`; `tsc` checks the script against the contract
2. **Replay:** runs on every canary venue for two dates; output must pass the zod schema
3. **Agreement:** results mostly match the old script where both work
4. **Dry run:** the booking script reaches the confirm screen and stops there
5. **Diff limit:** an unusually large change goes to a person for review

**Agents and models**

| Job | Model |
|---|---|
| Venue mapping | `claude-haiku-5-5` |
| Shift-times script | `claude-sonnet-5-5` → Opus if needed |
| Booking script | `claude-sonnet-5-5` → Opus if needed |

The agents never complete a real booking. They only see fake contact data and never the JWT.

---

## 6. Audit and error logs

**One `request_id` ties it all together.** It comes from the caller's `x-request-id` (or a new ULID) and appears in the
response header, log lines, audit rows, error rows and queue jobs.

**Audit log: who did what**
- Append-only `audit_logs` table. A database trigger rejects `UPDATE`, `DELETE` and `TRUNCATE`.
- Records: actor, `api_key_prefix`, `user_ref` (a hash of the JWT `sub`), action, resource, outcome, `request_id`.
- Covers rejected keys and tokens, API key changes, every booking status and retry, status-webhook deliveries, retries,
  dead events and replays, repair requests, restaurant and mapping edits, script commits, promotions and rollbacks, and agent runs.
- Written through a queue so it never slows a request.

**Error log: what broke**
- `nestjs-pino` JSON logs with redaction: the API key, the JWT and all contact details are blanked.
- `error_logs` table for things someone may need to act on: every 5xx, failed jobs, script failures, agent crashes,
  repairs that need a person (`SCRIPT_REPAIR_NEEDED`), and webhook events that went `dead` (`WEBHOOK_DELIVERY_FAILED`).
- Errors with the same fingerprint are grouped.
- Stack traces stay on the server. Clients only see `code` + `request_id`.

---

## 7. SevenRooms findings

Checked 2026-11-16 on one Dubai venue. Settings vary by venue, so the venue-mapping agent records them for each restaurant.

| Area | Seen | Design impact |
|---|---|---|
| Availability | Plain JSON GETs (`/api-yoa/availability/…`), no CAPTCHA | The shift-times script reads these responses rather than scraping the page |
| reCAPTCHA | Enterprise. Set per venue: always on, invisible, or step-up (only on a low risk score). This venue: step-up. Applies at checkout only | Some checkouts will hit a challenge, which ends in `failed / PLATFORM_BLOCKED` plus a `reservation.failed` event (no repair). Venues with it always on, or blocked most of the time, are set `bookable=false` and return `422 VENUE_NOT_BOOKABLE` |

---

## 8. Configuration

Every outside address comes from the environment. The settings are checked at startup with a zod schema
(`libs/common/src/config/env.schema.ts`), so a missing or malformed value stops the app from booting. The full list is in
[`.env.example`](.env.example).

| Variable | Default | Purpose |
|---|---|---|
| `RESERVATION_WEBHOOK_URL` | required | Where every final booking status (confirmed and failed) is pushed |
| `RESERVATION_WEBHOOK_SECRET` | required | HMAC-SHA256 signing key |
| `RESERVATION_WEBHOOK_TIMEOUT_MS` | `5000` | Per-attempt timeout |
| `RESERVATION_WEBHOOK_MAX_ATTEMPTS` | `8` | Attempts before an event is marked dead |
| `CONTACT_API_BASE_URL` | required | Contact system base URL; its host is added to the token-forwarding allowlist |
| `CONTACT_API_CONTACT_PATH` | required | Endpoint returning the caller's name, phone and email |
| `CONTACT_API_TIMEOUT_MS` | `3000` | Per-call timeout |
| `CONTACT_API_RETRIES` | `1` | Retries on timeout or 5xx only |
| `SERVICE_AUTH_JWKS_URL`, `_ISSUER`, `_AUDIENCE` | required | JWT validation |
| `SERVICE_AUTH_ALGORITHMS` | `RS256,ES256` | Allowed JWT signing algorithms |

---

## 9. Decisions and open points

| Topic | Status | Notes |
|---|---|---|
| Stack | decided | NestJS 11, Prisma/Postgres, Redis/BullMQ, Playwright |
| Authentication | decided | `x-api-key` + JWT on every call |
| Party size | decided | Required in both APIs; checked on the confirmation screen |
| Restaurants | decided | Own table for the pilot; Spice sync script later; mapping table always stays here |
| User action | decided | Never. A booking is confirmed or failed, nothing in between |
| Reservation status | decided | Pushed by a signed webhook to `RESERVATION_WEBHOOK_URL` for confirmed and failed, with an outbox and retries. `GET` stays as a fallback |
| Self-healing trigger | decided | The first script failure starts a repair; one repair per script, 30-minute cooldown |
| Reservation list | decided | `GET /v1/reservations`, filter `upcoming` / `previous` / `all`, per user |
| SevenRooms terms of service | accepted risk | Pilot only; low request rate; adapter can be swapped for a partner API |
| JWT details | **open** | JWKS URL, `iss`, `aud`, algorithm, tenant claim, header name |
| Contact system | **partly open** | Endpoints come from `CONTACT_API_*` env vars; the response field mapping is still open |
| Audit retention | assumed | 12 months, unless a regulation needs longer |

---

## Project layout

```text
apps/
  api/        HTTP app: guards, shifts, reservations, /internal admin, API-key CLI
  worker/     BullMQ processors: shifts, submit, status webhook, audit writer, outbox sweeper, script repair
libs/
  common/     env schema, error catalog, crypto, slot tokens, request context, queues, Redis
  database/   Prisma service
  logging/    pino + redaction, error log, global exception filter
  audit/      @Audit decorator, interceptor, audit service
  contact/    Contact system client, allowlisted HTTP client that carries the JWT
  providers/  ReservationProvider interface, platform router, fake provider, SevenRooms placeholder
  webhooks/   reservation status webhook: outbox, signer, sender, delivery policy
prisma/       schema and migrations (incl. the append-only audit trigger)
docs/diagrams the figures in this README
DESIGN.md     full design
```
