# ProofMark

ProofMark is a privacy-preserving, verifiable exam and marking workflow. The initial MVP focuses on anonymous submission, deterministic grading proofs, tamper-evident audit logs, and verifiable receipts.

## Workspace

```txt
apps/
  api/       NestJS API
  web/       Next.js web application
  worker/    background jobs and proof workers
packages/
  shared/            shared types and helpers
  crypto/            cryptographic wrappers and canonical encoding primitives
  audit-log/         append-only audit log and Merkle proof helpers
  zk-semaphore/      Semaphore integration
  zk-grading-noir/   Noir grading package
prisma/              database schema and migrations
infra/               local infrastructure notes and future deployment assets
```

## Requirements

- Node.js 24+
- Docker and Docker Compose
- `pnpm` via Corepack

## Local Development

Enable `pnpm` through Corepack:

```bash
corepack prepare pnpm@10.10.0 --activate
```

Install dependencies:

```bash
pnpm install
```

Start local services:

```bash
docker compose up -d
```

Run the workspace checks:

```bash
pnpm lint
pnpm test
pnpm build
```

Run the beta verification matrix:

```bash
pnpm verify:beta
pnpm test:smoke
pnpm test:load
```

Run the applications in development mode:

```bash
pnpm --filter @proofmark/api dev
pnpm --filter @proofmark/web dev
pnpm --filter @proofmark/worker dev
```

## Environment

Copy `.env.example` to `.env` and adjust values if needed. The default local stack expects:

- PostgreSQL on `localhost:55432`
- Redis on `localhost:56379`
- MinIO on `localhost:59000`

## Current Status

The repository currently includes:

- Phase 0 foundation scaffolding
- Phase 1 core exam domain schema and lifecycle guards
- Phase 2 canonical hashing, audit chaining, Merkle proofs, and signed receipts
- Phase 3 local Semaphore identity wallet and commitment registration
- Phase 4 anonymous submission verification and receipt issuance
- Phase 5 admin authoring plus signed public manifests
- Phase 6 student MCQ exam-taking flow with encrypted blob upload, Web Worker proof generation, encrypted local draft recovery, and browser-side receipt verification
- Phase 7 objective grading proof generation in the worker
- Phase 8 finalized anonymous grades and claim flow
- Phase 9 public auditor console, audit root history, proof artifact explorer, and server-side receipt verification
- Phase 10 blind marking workflow with subjective submission slicing, deterministic assignment generation, local marker pseudonym signing, adjudication, and subjective grade aggregation
- Phase 12 beta hardening with privacy-safe structured request logs, admin MFA gates, rate limits, payload guards, CSP/security headers, operator runbooks, and automated smoke/load/browser verification
- an execution-ready implementation plan in [`docs/implementation-plan.md`](docs/implementation-plan.md)

## Public Routes

- `/student/register` for local Semaphore wallet creation, backup export, import, and roster commitment registration
- `/student/exam` for loading the public exam, restoring encrypted drafts, encrypting answer blobs, generating the proof in a worker, and submitting anonymously
- `/verify-receipt` for browser-side receipt verification without privileged API access
- `/auditor` for manifest inspection, audit root history, group root history, proof artifact metadata, and receipt verification against stored server records
- `/marker` for blinded task review, local pseudonym-key storage, signed mark submission, and adjudication handling

## Public API Highlights

- `GET /api/public/exams/:examId` for published exam metadata
- `GET /api/public/exams/:examId/manifest` for the signed public manifest
- `GET /api/public/exams/:examId/group` for the active Semaphore group snapshot
- `GET /api/public/exams/:examId/audit-roots` for cumulative audit root and group root history
- `GET /api/public/exams/:examId/proof-artifacts` for verified proof artifact metadata
- `GET /api/public/exams/:examId/submissions/:submissionId/finalized-grade` for finalized grade and proof metadata
- `POST /api/public/verify-receipt` for server-side receipt validation against stored records
- `POST /api/admin/exams/:examId/markers` to enroll marker pseudonyms and issue local signing keys
- `POST /api/admin/exams/:examId/assignments` to slice subjective parts and generate deterministic blind marking tasks
- `GET /api/marker/exams`, `GET /api/marker/exams/:examId/tasks`, `GET /api/marker/tasks/:taskId`, and `POST /api/marker/tasks/:taskId/marks` for the blinded marker workflow

## Additional Environment Notes

- `PUBLIC_API_BASE_URL` is used by the submission upload flow to mint absolute upload URLs
- `BLOB_ENCRYPTION_PRIVATE_KEY` controls the RSA key used for client-side answer blob encryption; `dev-static-proofmark-key` is only for local development
- `UPLOAD_TOKEN_SECRET` signs one-time upload tokens for encrypted submission blobs
- `MANIFEST_SIGNING_KEY` and `RECEIPT_SIGNING_KEY` should be set to stable long-lived Ed25519 keys outside local development if public verification needs to survive service restarts
- `ADMIN_IDS` and `ADMIN_MFA_SECRET` protect all admin mutation endpoints; local examples are included in `.env.example`
- `LOG_REDACTION_SALT` salts hashed principals in structured request logs

## Verification and Operations

- `pnpm seed:demo` seeds one committed exam in `REGISTRATION`, ready for a browser wallet to register before admin publish/open
- `pnpm test:smoke` runs the full register -> submit -> mark -> grade -> claim -> verify lifecycle
- `pnpm test:load` runs a concurrent registration/submission/grading smoke for capacity regression checks
- `pnpm test:playwright` runs a browser-level registration/submission/receipt verification smoke
- `npm_config_registry=https://registry.npmjs.org pnpm audit --prod` reports one remaining moderate advisory in Prisma's bundled dev tooling; details live in [`docs/runbooks.md`](docs/runbooks.md)
- [`docs/runbooks.md`](docs/runbooks.md) covers bring-up, MFA, key rotation, and recovery steps
- [`docs/privacy-model.md`](docs/privacy-model.md) documents the identity-separation and log-redaction model
- [`docs/demo-operator-quickstart.md`](docs/demo-operator-quickstart.md) gives the fastest path to a live local demo
- [`docs/demo-walkthrough.md`](docs/demo-walkthrough.md) gives a role-by-role demo script for admin, students, markers, and auditor
