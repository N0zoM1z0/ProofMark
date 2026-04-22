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
- an execution-ready implementation plan in [`docs/implementation-plan.md`](docs/implementation-plan.md)

## Phase 6 Routes

- `/student/register` for local Semaphore wallet creation, backup export, import, and roster commitment registration
- `/student/exam` for loading the public exam, restoring encrypted drafts, encrypting answer blobs, generating the proof in a worker, and submitting anonymously
- `/verify-receipt` for browser-side receipt verification without privileged API access

## Additional Environment Notes

- `PUBLIC_API_BASE_URL` is used by the submission upload flow to mint absolute upload URLs
- `BLOB_ENCRYPTION_PRIVATE_KEY` controls the RSA key used for client-side answer blob encryption; `dev-static-proofmark-key` is only for local development
- `UPLOAD_TOKEN_SECRET` signs one-time upload tokens for encrypted submission blobs
