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
- an execution-ready implementation plan in [`docs/implementation-plan.md`](docs/implementation-plan.md)

Subsequent phases will add the core Prisma model, audit log primitives, anonymous submission flow, and grading proof pipeline.
