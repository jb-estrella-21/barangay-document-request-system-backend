# Barangay Document Request API

Backend-only REST API for anonymous resident document requests, private tracking, and staff processing. It uses NestJS, TypeScript, PostgreSQL, and Prisma as a single-barangay modular monolith. The separately maintained Cloudflare Pages frontend reaches this API through its same-origin Pages Function proxy.

## Local development

Requirements: Node.js 22.23.2 or later within Node 22, and PostgreSQL 16 or Docker Compose.

```sh
cp .env.example .env
npm ci
docker compose up -d postgres
```

Generate an idempotency encryption key and place it in the untracked `.env` file:

```sh
openssl rand -base64 32
```

Then create the schema and start the API:

```sh
npx prisma migrate deploy
npm run start:dev
```

The local API listens on `http://localhost:3000`. OpenAPI UI and JSON are at `/api/docs` and `/api/docs-json`; the database-backed health endpoint is `/health`. `.env.example` uses the local-only PostgreSQL credentials from `docker-compose.yml`, a local cookie setting, and the two local frontend origins. Never put real resident data or production secrets in this local database or commit `.env`.

After applying migrations and building, create the first administrator from an interactive terminal:

```sh
npm run build
npm run staff:create-admin
```

The command refuses to create an administrator after any administrator record exists. It does not echo the password. Administrators create processor accounts through the API; deliver temporary passwords separately through a secure channel and require a password change at first sign-in.

## Frontend API contract

All application routes except `/health` and OpenAPI documentation use `/api/v1`.

- `GET /document-types` lists active document types with their current version, requirements, and field definitions for the resident form.
- `POST /requests` submits a request. Send an `Idempotency-Key` for each new user action and reuse that key only to retry the same body after an uncertain response. The successful response returns a human-readable reference and a separate `trackingCredential`; show them once and tell the resident to save both.
- `POST /requests/track` accepts `{ "reference": "…", "trackingCredential": "…" }` in the body. It returns limited status and release information, never applicant data. Keep the credential out of URLs, analytics, browser logs, and support screenshots.
- Staff sign in at `POST /staff/auth/login`. The API sets an HttpOnly session cookie and returns a session-bound CSRF token. `GET /staff/auth/me` restores session and CSRF state after reload. Send browser requests with credentials enabled. Every state-changing staff request requires the configured `Origin` and `X-CSRF-Token`; login also rejects any supplied Origin that is not an exact configured origin. Requests without Origin remain supported for non-browser clients.
- Staff request details include an `ETag`. Send that exact value in `If-Match` for transition and release-date updates; refresh details after `409 Conflict`.
- `GET /staff/requests` accepts non-search filters: `status`, `documentTypeId`, `releaseDateFrom`, `releaseDateTo`, `overdue`, `limit`, and `cursor`. Use `POST /staff/requests/search` with those filters plus `search` in a JSON body to search authorized applicant/reference fields. The old GET `search` query is rejected to keep personal data out of URLs. Queue responses use `{ data, nextCursor }`.

Processors can view and process requests. Administrators can also create and manage document types and staff accounts, reset passwords, and read audit events. The OpenAPI document is generated from the same application configuration used by the running API; use it as the detailed source for schemas, response codes, and headers.

Document types are configurable and versioned. Do not create or seed a type until the barangay confirms its name, field definitions, and requirements. Catalog edits create a new immutable version; existing requests remain pinned to their submission version. Deactivation blocks new submissions and preserves existing requests.

The Pages proxy forwards browser Origin, staff cookies, CSRF tokens, idempotency keys, and ETags. It signs client IP metadata with a shared 32-byte base64 secret using this exact UTF-8 payload, separated by newlines and with no trailing newline:

```text
v1\n<unix timestamp seconds>\n<client IP>\n<uppercase HTTP method>\n<pathname>
```

The API accepts signatures for 60 seconds and uses the verified IP only for rate-limit attribution. The signature is not authentication, covers neither query nor body, and can be replayed temporarily into the same method/path/IP bucket. Keep `TRUST_PROXY=false`; raw forwarding headers are ignored.

Application access logs preserve method, sanitized route template, status, duration, and request ID while excluding raw URLs, query strings, bodies, and sensitive headers. Keep request-body and credential capture disabled in Cloudflare, Render, and any external observability tooling as well.

## Deployment configuration

`render.yaml` describes a Render Node web service. Its build runs `npm ci --include=dev && npm run build`, because Nest CLI and Prisma CLI are required during build; start runs `npm run start`. Render supplies `PORT`. The service does not run database migrations at startup and does not configure a periodic database health check. Node is pinned to 22.23.2 in the blueprint, and `package.json` bounds the supported major to Node 22.

Configure these values in the Render service’s environment settings or secret store, not in this repository:

| Variable | Deployment value or purpose |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Neon pooled TLS URL for runtime queries. Use a direct TLS URL only for a controlled migration or dump. |
| `IDEMPOTENCY_ENCRYPTION_KEY` | Random base64-encoded 32-byte secret. |
| `CLIENT_IP_HMAC_SECRET` | Separate random base64-encoded 32-byte secret; it must differ from the encryption key. Set the same decoded key in the Pages proxy secrets. |
| `CORS_ORIGINS` | Exact comma-separated origins: `https://barangay-document-resident.pages.dev,https://barangay-document-staff.pages.dev` (adjust only to the approved deployed origins). |
| `COOKIE_SECURE` / `COOKIE_SAME_SITE` | `true` / `lax` for HTTPS. |
| `TRUST_PROXY` | `false`; signed Pages metadata supplies rate-limit attribution. |
| `SESSION_TTL_HOURS` | Session lifetime; currently 8 hours in the blueprint. |
| `LOG_LEVEL` | Usually `info`; never enable body or credential logging. |

Before a migration, use a direct database connection in a controlled operator shell, verify `SELECT current_database()` against the intended target, then run `DATABASE_URL="$NEON_DIRECT_URL" npm run prisma:migrate:deploy`. Never run migrations automatically in the web service start command. The Prisma schema has no separate `directUrl`, so the override is explicit. The checked-in migration history has no down migrations; rollback planning must account for this.

The Render blueprint service is named `barangay-document-request-api`, while the known Pages upstream hostname is `barangay-document-request-system-backend.onrender.com`. A Render service name and hostname slug can be independently configured; verify in the Render dashboard that the blueprint targets the existing service and hostname before applying it. `autoDeployTrigger` is intentionally omitted: Render retains an existing service’s configured trigger, while a newly created service follows Render’s default. Confirm the live setting manually. This repository has no GitHub Actions workflow, so there is no checked-in CI gate before deployment.

Do not infer that a local build or test proves hosted environment values, service identity, proxy secrets, database health, or successful deployment. No hosted configuration is managed by this repository’s local checks.

## Safe verification

```sh
npm run build
npm test -- --runInBand
npm run test:e2e:safety -- --runInBand
```

The full E2E suite resets application tables before inserting fixtures. It requires all four variables to be explicitly exported into the test process: `NODE_ENV=test`, `E2E_DATABASE_URL` (a dedicated PostgreSQL URL), `E2E_DATABASE_NAME` (the exact database name ending in `_test`), and `E2E_ALLOW_DATABASE_RESET` (the same exact database name as deliberate reset confirmation). The test runner never falls back to `DATABASE_URL`; it connects only to `E2E_DATABASE_URL`, checks PostgreSQL’s live `current_database()`, and refuses a URL that resolves to the configured application `DATABASE_URL`.

Provision and migrate a separate disposable `_test` database before running `npm run test:e2e -- --runInBand`. A database name is only a guardrail, not proof that its contents are disposable. Never point E2E tests at development, staging, or production data. Keep the E2E URL and reset confirmation out of committed files and shell history. Do not run full E2E tests unless the disposable target is positively identified.

For non-destructive deployment smoke checks, request `GET /health`, `GET /api/v1/document-types`, and (with a valid staff session) `GET /api/v1/staff/auth/me`. Health checks connect to PostgreSQL and may wake a sleeping database. Direct hosted requests should only be made under the project’s separately approved deployment procedure.

## Recovery and operational limits

The current backend has no scheduled backup job or verified restore procedure. Current Neon Free documentation describes a 6-hour instant-restore history window (capped at 1 GB of changes), one manual snapshot, and no scheduled backups; verify the account’s plan and settings before relying on provider history ([Neon plans](https://neon.com/docs/introduction/plans)). For a fictional demo, create a custom-format `pg_dump` before a schema change or significant demo period, verify the archive with `pg_restore --list`, then encrypt the archive with the project’s approved encryption tool before storing it outside the repository. Record its owner/date and keep the decryption key separately. Use a libpq service entry and protected password file rather than putting credentials in shell history. Restore only into a new isolated project or empty database, then verify the restored database identity and run safe read-only checks. Never restore over the live database as a routine test.

Because there are no down migrations, prefer a tested corrective forward migration when the old application can no longer safely use the new schema. Roll back application code only when schema compatibility is established. For data loss or an incompatible schema, restore a known-good snapshot into a separate target and follow an explicit cutover plan; never edit Prisma’s migration ledger manually as a shortcut.

The service is intentionally small and the in-memory throttler resets on restart; multiple API replicas need shared rate limits or equivalent edge enforcement. Render Free instances can sleep after 15 minutes without inbound activity, take about a minute to wake, and have ephemeral filesystems; Render says Free instances are for testing/previews, not production. Keep backups outside the service ([Render Free limits](https://render.com/docs/free)). Neon Free computes scale to zero after five minutes of inactivity ([Neon plans](https://neon.com/docs/introduction/plans)). A sleeping service/database can make the first request slow. Staff mutations use `If-Match` and clients should refresh after an unknown timeout; public submissions support safe same-key retries. The API does not implement resident accounts, uploads, notifications, payments, request assignment, or multi-barangay tenancy. The barangay must approve a retention/deletion policy before real resident data is accepted.
