# Ona Polisi

Ona Polisi is a citizen police-accountability tracker built with HTML, CSS, vanilla JavaScript, Node.js, Express, and PostgreSQL.

## Run locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Install Docker Desktop, then start the local support services:

   ```bash
   docker compose -f infra/docker-compose.yml up -d redis clamav
   ```

   This starts Redis on `localhost:6379` and ClamAV on `127.0.0.1:3310`. The current local setup uses the installed PostgreSQL service on `localhost:5432`.

   A containerized PostGIS database is available through the `container-db` profile when the host PostgreSQL port is free:

   ```bash
   docker compose -f infra/docker-compose.yml --profile container-db up -d postgres
   ```

3. Copy `.env.example` to `.env` and update values if needed.

4. If the database volume already existed before the current schema, apply the schema manually:

   ```bash
   psql "$DATABASE_URL" -f schema.sql
   ```

5. Start the server:

   ```bash
   npm run dev
   ```

Open `http://localhost:3000` in a browser.

## Current slice

- Public home page
- Guided `/report` incident wizard
- Public `/case/:caseId` tracking page
- `POST /api/incidents` endpoint
- `GET /api/incidents/:caseId` endpoint
- Persisted `case_events` timeline records with canonical case states
- Moderation-first evidence upload endpoint with file hashing, size/type validation, private storage abstraction, and authorized downloads
- Public account registration, login, logout, and HTTP-only session endpoints
- Admin-only evidence moderation queue with approve, reject, and quarantine actions
- Lawyer/journalist verification requests with admin approval workflow
- Verified lawyer workspaces for available cases, claimed cases, and case release
- Layered privacy flow: public case redaction, account-linked private reports, and lawyer contact requests
- Verified journalist workspace with thresholded, aggregated CSV exports (no case IDs or exact locations)

## Local infrastructure

The compose file is intentionally separate from the app process. PostgreSQL/PostGIS is the source of truth for cases, Redis is reserved for queues and rate limits, and S3-compatible object storage is reserved for evidence objects. The default local workflow runs PostgreSQL on Windows plus Redis and ClamAV in Docker. MinIO remains an optional S3 profile because its community image registry availability is changing; keep `EVIDENCE_STORAGE=local` until an S3-compatible image or managed bucket is configured.

Evidence uploads are stored locally under `data/evidence/` by default, or in a private MinIO/S3 bucket when `EVIDENCE_STORAGE=s3`. Uploads require the reporter, assigned lawyer, or admin; downloads are authorized and audited. Images are metadata-stripped with Sharp. ClamAV scanning is supported through `CLAMAV_HOST`/`CLAMAV_PORT`; PDF and MP4 metadata processing requires a future media-tool adapter. Production must keep `ALLOW_UNSCANNED_EVIDENCE=false`; the local `.env` enables the override only so the prototype remains usable while Docker/ClamAV is unavailable.

Press exports currently group reports by month, category, and status, and suppress groups with fewer than five reports. They are intended for trend reporting, not as proof that every report is substantiated.

Reporters may submit anonymously. If signed in, they can optionally add an encrypted contact detail. A verified lawyer sees only redacted intake details until claiming a case; they must then request contact access, and the reporter approves or declines from `/my-reports`. Approved contact reveals are written to `sensitive_access_logs`. Set `APP_ENCRYPTION_KEY` to a base64-encoded 32-byte key before using this feature.

## Create a local admin account

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in the environment, then run:

```bash
npm run admin:create
```

The command creates or updates that account as a verified `admin`. Keep the credentials local and do not commit them.

This is an early prototype. Evidence encryption at rest, PostGIS heatmaps, rate limiting, retention controls, and production security review still need to be completed before handling real reports. Run `npm run test:smoke` after starting the server to verify the report, evidence, moderation, privacy, lawyer-claim, and confidential-contact workflow locally.
