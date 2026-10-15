# Barangay Document Request API

Backend-only REST API for anonymous resident document requests, private public tracking, and staff processing. The service uses NestJS, TypeScript, PostgreSQL, and Prisma. It is a single-barangay modular monolith; no frontend is included.

## Local setup

Requirements: Node.js 20.11 or newer and PostgreSQL 16 or newer. Docker Compose is an optional local database path.

```sh
cp .env.example .env
npm ci
docker compose up -d postgres
npx prisma migrate deploy
npm run start:dev
```

The API listens on `http://localhost:3000`. OpenAPI UI is at `/api/docs`, its JSON document at `/api/docs-json`, and the database health check at `/health`.

Replace the example IDEMPOTENCY_ENCRYPTION_KEY before using non-local data. Generate a 32-byte base64 key with openssl rand -base64 32. Production startup requires COOKIE_SECURE=true, at least one exact CORS_ORIGINS entry, a non-example encryption key, a distinct 32-byte base64 CLIENT_IP_HMAC_SECRET, HTTPS termination, and a restricted database role. Keep TRUST_PROXY=false behind the prepared Pages proxy; signed client-IP metadata is only rate-limit attribution.

After applying migrations and building, create the first administrator from an interactive terminal:

```sh
npm run build
npm run staff:create-admin
```

The bootstrap command refuses to create an administrator once any administrator record exists. It does not echo the password. Administrators create processor accounts through the staff API; the one-time temporary password must be delivered to the staff member through a separate secure channel and changed at first sign-in.

## API overview

All routes except `/health` and OpenAPI documentation use the `/api/v1` prefix.

- `GET /document-types` lists active types and the requirements/field definitions used by the submission form.
- `POST /requests` submits a request. Send a fresh `Idempotency-Key` for each user action and reuse it only for network retries. A successful response contains a human-readable `reference` and a separate `trackingCredential`; show both once and tell the resident to save them.
- `POST /requests/track` accepts `{ "reference": "…", "trackingCredential": "…" }` in the body. It returns status, public status message, expected date, ready time, and release time, without applicant data.
- Staff sign in at `POST /staff/auth/login`. The server sets an HttpOnly session cookie and returns a session-bound CSRF token. Send that token in `X-CSRF-Token` and the configured `Origin` on staff `POST` and `PATCH` requests, including queue search. `GET /staff/auth/me` returns the active session's CSRF token so browser clients can restore state after reload.
- Staff request details return a version ETag. Send it in `If-Match` on status and release-date updates; refresh after a `409 Conflict`.
- `GET /staff/requests` supports the non-search filters `status`, `documentTypeId`, `releaseDateFrom`, `releaseDateTo`, `overdue`, `limit`, and `cursor`. Use `POST /staff/requests/search` with the same filters plus `search` in a JSON body for applicant or reference searches; search terms in the former GET query are rejected. Queue sorting is stable by newest submission, then ID.

Application access logs contain the request method, sanitized route template, status, duration, and request ID. Configure reverse proxies and observability agents not to record full URLs, request bodies, or sensitive headers.

Staff routes require a session. Processors can read and process requests. Administrators can additionally manage staff and the document catalog, and read full audit events. Public tracking always requires both credentials; the request reference alone grants no access.

Create document types only after the barangay confirms its launch catalog and requirements. Catalog edits create immutable versions; requests retain the version used when they were submitted. Deactivation blocks new requests and preserves existing ones.

## Development checks

```sh
npm run build
npm test -- --runInBand
npm run test:e2e:safety -- --runInBand
npm run test:e2e -- --runInBand
```

End-to-end tests reset their tables before creating temporary staff and request data. They require all four E2E settings to be explicitly exported in the test process: `NODE_ENV=test`, `E2E_DATABASE_URL` (a dedicated PostgreSQL URL), `E2E_DATABASE_NAME` (the exact database name, ending in `_test`), and `E2E_ALLOW_DATABASE_RESET` (the exact same database name as a deliberate reset confirmation). The test runner never falls back to `DATABASE_URL`; after validating these settings, it uses only `E2E_DATABASE_URL`, checks PostgreSQL's live `current_database()` value, and refuses a URL that matches the configured application `DATABASE_URL`. Provision and migrate a separate disposable database before running E2E tests. Never point this runner at development, staging, or production data. Keep the E2E URL and reset confirmation out of committed files and shell history.

Run `npm run test:e2e:safety -- --runInBand` to test the gate without connecting to PostgreSQL. Run the full `npm run test:e2e -- --runInBand` only when the explicit disposable database settings are configured. `npx prisma migrate deploy` applies checked-in migrations to the URL supplied to Prisma; use `npm run prisma:migrate:dev -- --name describe-change` when creating a development migration.

## Current operational boundaries

Request attachments, messages, payments, resident account creation, online identity checks, assignment, and multi-barangay tenancy are not implemented. Data retention remains a barangay decision and must be approved before launch; this MVP does not automatically delete historical resident requests. The in-process rate limiter is intended for a single API instance; multiple replicas need a shared rate-limit store or equivalent edge limits.


## Phase 5B deployment preparation

The Render blueprint prepares a Free Node service with the existing build/start scripts, platform-provided PORT, no startup migrations, and no scheduled database health probe. Complete unresolved values only after separate Phase 5C approval. Runtime DATABASE_URL should be Neon's pooled TLS URL; use the direct TLS URL only for a controlled migration or backup.

Before a later migration, connect to the intended database and verify its identity with SELECT current_database(). Apply checked-in migrations manually using DATABASE_URL="$NEON_DIRECT_URL" npm run prisma:migrate:deploy; never configure migrations to run at service startup. Phase 5B makes no cloud connection or database change.

The Pages proxy signs a versioned payload containing timestamp, edge IP, method, and path. The API verifies it in constant time within a 60-second window and uses the IP only for rate-limit tracking. The signature is not authentication and can be replayed temporarily into the same IP/method/path bucket. Raw forwarding headers remain untrusted. The in-memory rate limiter resets on process restart; the database-backed staff sessions do not, subject to normal expiry and revocation.
