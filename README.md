# ProofMark

ProofMark is a privacy-preserving assessment platform for running verifiable exams and marking workflows without exposing student identity throughout submission and review.

It combines:

- anonymous eligibility proofs with Semaphore
- tamper-evident audit logs and signed receipts
- deterministic grading proofs for objective questions
- blind marking workflows for subjective questions
- late-stage grade claim so identity is reconnected only when results are finalized

## Known Limitations

- Objective proof artifacts currently run through a development placeholder backend in [`@proofmark/zk-grading-noir`](packages/zk-grading-noir/src/index.ts). The worker, proof artifact persistence, and public verification flow are live, but the production `Noir/Barretenberg` grading circuit is not yet integrated.
- Student claim still depends on the same browser-local Semaphore identity used during submission. If a student loses browser storage before `CLAIMING` and has no exported encrypted wallet backup, recovery is not yet supported in the current release.
- Because of the two points above, ProofMark should currently be described as providing verifiable workflow integrity, signed receipts, and blind marking support, but not yet production objective ZK grading proofs or production-grade claim recovery.

## What ProofMark Supports

- Teacher-facing exam authoring in `/admin`
- JSON, Markdown, and CSV exam import with preview before persistence
- Reusable exam templates and a shared question bank
- Browser-local student identity wallets with encrypted backup and restore
- Anonymous exam submission with nullifier-based double-submit protection
- Signed receipts with local and server-side verification
- Public manifests, audit root history, and proof artifact inspection
- Blind marker assignment, local mark signing, and adjudication support
- Finalized grade claim using the same anonymous identity used during submission

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
docs/                operator, workflow, privacy, and authoring documentation
```

## Requirements

- Node.js 24+
- Docker and Docker Compose
- `pnpm` via Corepack

## Quick Start

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
pnpm db:migrate:deploy
```

Start the applications:

```bash
pnpm --filter @proofmark/api dev
pnpm --filter @proofmark/web dev
```

Seed a local demo exam:

```bash
pnpm seed:demo
```

The default local experience is:

- Web: `http://127.0.0.1:3101`
- API: `http://127.0.0.1:3001`

## Verification

Run the workspace checks:

```bash
pnpm lint
pnpm test
pnpm build
```

Run the full release verification suite:

```bash
pnpm verify:release
pnpm test:smoke
pnpm test:load
pnpm test:playwright
```

Before a production-style rollout, read the go/no-go guidance in [docs/runbooks.md](docs/runbooks.md).

## User-Facing Routes

- `/admin` for exam authoring, import preview, template reuse, question-bank reuse, exam export, and lifecycle actions
- `/student/register` for local identity creation, encrypted backup export/import, and commitment registration
- `/student/exam` for loading the public exam, restoring the wallet, encrypting responses, generating the proof, and submitting anonymously
- `/student/claim` for claiming a finalized result with the same local identity and receipt
- `/verify-receipt` for in-browser receipt verification
- `/auditor` for manifest inspection, audit root history, proof artifact metadata, and stored receipt verification
- `/marker` for blinded task review, local key storage, and signed mark submission

## Public API Highlights

- `GET /api/public/exams/:examId`
- `GET /api/public/exams/:examId/manifest`
- `GET /api/public/exams/:examId/group`
- `GET /api/public/exams/:examId/audit-roots`
- `GET /api/public/exams/:examId/proof-artifacts`
- `GET /api/public/exams/:examId/submissions/:submissionId/finalized-grade`
- `POST /api/public/verify-receipt`
- `POST /api/admin/exams/:examId/markers`
- `POST /api/admin/exams/:examId/assignments`
- `GET /api/admin/exams`
- `GET /api/admin/exams/:examId/export`
- `POST /api/admin/imports/preview`
- `GET/POST /api/admin/templates`
- `GET/POST /api/admin/question-bank`
- `GET /api/marker/exams`
- `GET /api/marker/exams/:examId/tasks`
- `GET /api/marker/tasks/:taskId`
- `POST /api/marker/tasks/:taskId/marks`

## Environment Notes

Copy `.env.example` to `.env` and adjust values if needed. The default local stack expects:

- PostgreSQL on `localhost:55432`
- Redis on `localhost:56379`
- MinIO on `localhost:59000`

Operationally important variables:

- `PUBLIC_API_BASE_URL` for absolute upload URLs
- `BLOB_ENCRYPTION_PRIVATE_KEY` for client-side answer blob encryption and later grading
- `UPLOAD_TOKEN_SECRET` for one-time encrypted upload tokens
- `MANIFEST_SIGNING_KEY` for stable manifest signatures
- `RECEIPT_SIGNING_KEY` for stable receipt signatures
- `ADMIN_IDS` and `ADMIN_MFA_SECRET` for admin mutation authorization
- `LOG_REDACTION_SALT` for privacy-safe principal hashing in logs

## Documentation

- [docs/runbooks.md](docs/runbooks.md): local bring-up, MFA, key rotation, and recovery procedures
- [docs/workflow-and-roles.md](docs/workflow-and-roles.md): lifecycle, role boundaries, and state transitions
- [docs/admin-authoring.md](docs/admin-authoring.md): exam authoring, import formats, templates, and question-bank workflow
- [docs/privacy-model.md](docs/privacy-model.md): identity separation, log redaction, and privacy boundaries
- [docs/wallet-recovery-design.md](docs/wallet-recovery-design.md): recovery package model, lifecycle, and operator approval design
- [docs/demo-operator-quickstart.md](docs/demo-operator-quickstart.md): shortest path to a live local demo
- [docs/demo-walkthrough.md](docs/demo-walkthrough.md): role-by-role live demo script
