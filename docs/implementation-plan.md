# ProofMark Implementation Plan

## 1. Purpose

This document converts the research blueprint into an execution-ready implementation plan for `ProofMark`.

The immediate goal is not to build a fully generalized exam platform. The immediate goal is to deliver a technically credible MVP that proves four core properties end to end:

1. Eligible candidates can submit anonymously.
2. Each eligible identity can submit only once per exam scope.
3. Deterministic grading can be verified with zero-knowledge proofs.
4. Critical exam events are tamper-evident through an append-only audit log and verifiable receipts.

## 2. Product Scope

### MVP scope

- Single exam flow
- Objective grading only, initially fixed-size MCQ
- Mock or simplified authentication and roster flow
- Local Semaphore identity generation in the browser
- Anonymous submission with nullifier-based double-submit protection
- Append-only audit events, Merkle roots, inclusion proofs, signed receipts
- Objective grading worker with Noir proof generation and verification
- Student, Admin, and Auditor minimal UIs
- Finalized-grade claim flow that links anonymous results back to a real account only after finalization

### Explicit non-goals for MVP

- Full LMS integration
- Complex exam policy engine
- Subjective marking fairness proof
- Production-grade anonymous credential issuance
- Mainnet deployment
- Full multi-tenant institution support

## 3. Architecture Invariants

These constraints are mandatory across all phases.

1. `identity secret` never leaves the student device.
2. `submissions` must not store `userId`, `sessionId`, `IP`, or `user agent`.
3. Public proof messages must bind at least `examId`, `examVersion`, `questionSetHash`, `answerCommitment`, `encryptedBlobHash`, and `algorithmVersion` where applicable.
4. `nullifierHash` must be transactionally unique per exam.
5. Every critical mutation must append an audit event.
6. Audit events must be hash-linked and phase roots must be reproducible.
7. Sensitive blobs must be encrypted before object storage upload.
8. Marker and auditor views must never receive real candidate identity data.
9. Proof verification must be version-aware. Old proofs must verify against the correct `vkHash` and circuit version, not a moving "latest" verifier.
10. Finalized grades must be append-only. Corrections must create new events, not overwrite old facts.

## 4. Target Repository Layout

```txt
ProofMark/
  apps/
    web/
    api/
    worker/
  packages/
    shared/
    crypto/
    audit-log/
    zk-semaphore/
    zk-grading-noir/
    contracts/
  prisma/
  infra/
  docs/
```

## 5. Delivery Strategy

The work should follow the critical path first:

1. Repository and infrastructure foundation
2. Core data model and deterministic audit primitives
3. Eligibility registration and Semaphore proof verification
4. Anonymous submission and receipt issuance
5. Objective grading proof generation and verification
6. Grade publication and claim
7. Auditor visibility and public verification

Subjective marking, chain anchoring, and hardening should be treated as follow-on phases after the MVP path is operational.

## 6. Detailed Phases

## Phase 0. Repository Foundation and Local Infrastructure

### Objective

Create a clean monorepo foundation so later protocol and product work does not fight the build system.

### Deliverables

- `pnpm` TypeScript monorepo
- `apps/web`, `apps/api`, `apps/worker`
- `packages/shared`, `packages/crypto`, `packages/audit-log`, `packages/zk-semaphore`, `packages/zk-grading-noir`
- Base TypeScript config, ESLint, Prettier, Vitest
- `docker-compose.yml` for PostgreSQL, Redis, and MinIO
- `.env.example`
- Basic CI running lint, test, and build
- API health endpoint
- Root README with local development instructions

### Dependencies

- None

### Implementation checklist

- [ ] Initialize workspace and root package management
- [ ] Add root `tsconfig` and shared lint/format config
- [ ] Scaffold all apps and packages
- [ ] Add Docker services for Postgres, Redis, and MinIO
- [ ] Add environment variable contract for DB, Redis, S3, auth, and signing keys
- [ ] Add `GET /health` or equivalent API health endpoint
- [ ] Add CI workflow for install, lint, test, and build
- [ ] Add smoke tests proving the workspace boots cleanly

### Acceptance checklist

- [ ] `pnpm install` succeeds
- [ ] `pnpm lint` succeeds
- [ ] `pnpm test` succeeds
- [ ] `pnpm build` succeeds
- [ ] `docker compose up` starts all local services
- [ ] API health endpoint returns success
- [ ] README steps are sufficient to start the project locally

### Risks and notes

- Keep initial scaffolding minimal. Do not introduce protocol logic yet.
- Keep all package boundaries explicit from the start to avoid future circular dependencies.

## Phase 1. Core Domain Model and Exam State Machine

### Objective

Establish the persistent model and lifecycle rules before implementing any anonymous workflow.

### Deliverables

- Prisma schema for exams, versions, eligibility commitments, submissions, proof artifacts, grades, claims, audit events, and audit roots
- Explicit `ExamStatus` state machine with guarded transitions
- Initial migrations

### Dependencies

- Phase 0

### Implementation checklist

- [ ] Define `exams`, `exam_versions`, `eligible_commitments`, `submissions`, `proof_artifacts`, `audit_events`, `audit_roots`, `grades`, and `grade_claims`
- [ ] Add `UNIQUE(exam_id, nullifier_hash)` on submissions
- [ ] Separate anonymous submission data from registrar-owned identity linkage data
- [ ] Implement exam lifecycle transitions in code, not only by convention
- [ ] Add unit tests for allowed and disallowed state transitions
- [ ] Add migration and seed support for local development

### Acceptance checklist

- [ ] Schema migrates cleanly on an empty database
- [ ] Illegal state transitions are rejected
- [ ] `submissions` contains no real identity field
- [ ] `grade_claims` or registrar mapping is isolated from anonymous submission flow
- [ ] Schema supports later proof versioning and grade supersession

### Risks and notes

- If the state machine is underspecified here, later flows will become ambiguous and insecure.
- Do not let MVP shortcuts collapse registrar and submission domains into the same data model.

## Phase 2. Audit Log, Canonical Hashing, and Receipt Primitives

### Objective

Build the tamper-evident foundation that every later phase will depend on.

### Deliverables

- Canonical JSON serialization helper
- Stable SHA-256 or field hashing helpers for canonical payloads
- Append-only audit event writer
- Hash-chained event model using `prevEventHash`
- Merkle root calculation and inclusion proof generation
- Inclusion proof verifier
- Signed receipt primitive

### Dependencies

- Phase 1

### Implementation checklist

- [ ] Implement canonical serialization in `packages/shared` or `packages/crypto`
- [ ] Hash event payloads deterministically
- [ ] Include `prevEventHash` in the event hash chain
- [ ] Build Merkle tree and inclusion proof utilities in `packages/audit-log`
- [ ] Implement receipt schema and signing utilities
- [ ] Add tests for canonical stability across field order changes
- [ ] Add tamper-detection tests for mutated payloads and broken proofs

### Acceptance checklist

- [ ] Reordered JSON fields produce the same canonical hash
- [ ] Event chain is deterministic and reproducible
- [ ] Inclusion proof verifies for untouched events
- [ ] Inclusion proof fails for modified payloads
- [ ] Signed receipt verification fails after any field mutation

### Risks and notes

- Canonicalization bugs here will contaminate every commitment and receipt later.
- Receipt format must be stable enough to verify offline and across versions.

## Phase 3. Eligibility Registration and Semaphore Integration

### Objective

Enable eligible candidates to create a local anonymous identity and register only the public commitment.

### Deliverables

- `packages/zk-semaphore` wrapper for identity, group, proof generation, and proof verification
- Browser-side identity generation flow
- Student commitment registration endpoint
- Group root snapshot tracking
- Audit event for commitment addition
- Local demo or script for multi-identity group verification

### Dependencies

- Phase 0
- Phase 1
- Phase 2

### Implementation checklist

- [ ] Wrap Semaphore V4 APIs with a typed local adapter
- [ ] Add a demo script with at least three local identities
- [ ] Implement `POST /api/student/exams/:examId/register-commitment`
- [ ] Store only `identityCommitment` on the server
- [ ] Track group roots and root history
- [ ] Add audit event `IdentityCommitmentAdded`
- [ ] Build basic student registration UI with local encrypted identity storage
- [ ] Support export and import of the encrypted identity backup

### Acceptance checklist

- [ ] Browser network traffic never contains the identity secret
- [ ] Stored identity can be decrypted and reused after refresh
- [ ] Exported and imported identity yields the same commitment
- [ ] Group root changes after a commitment is added
- [ ] Root history is queryable for later proof validation

### Risks and notes

- Browser storage and passphrase handling must be treated as part of the security model.
- Group root history matters because submissions may be generated against a prior valid root.

## Phase 4. Anonymous Submission Gateway

### Objective

Accept anonymous exam submissions only when the candidate proves group membership and one-time eligibility.

### Deliverables

- Public exam metadata endpoint
- Blob upload presign flow
- Anonymous submission endpoint
- Semaphore proof verification
- Message binding verification
- Nullifier uniqueness enforcement
- Submission persistence without identity leakage
- Signed receipt with audit inclusion proof

### Dependencies

- Phase 1
- Phase 2
- Phase 3

### Implementation checklist

- [ ] Implement `GET /api/public/exams/:examId`
- [ ] Implement `POST /api/public/exams/:examId/submissions/presign-upload`
- [ ] Implement `POST /api/public/exams/:examId/submissions`
- [ ] Validate payload shape with runtime schemas
- [ ] Verify exam status is open
- [ ] Verify submitted group root is current or allowed historical root
- [ ] Verify Semaphore proof
- [ ] Verify message hash binds `examId`, `questionSetHash`, `answerCommitment`, and `encryptedBlobHash`
- [ ] Persist submission and audit event in one transaction
- [ ] Enforce nullifier uniqueness transactionally
- [ ] Return a receipt containing the audit inclusion proof and server signature

### Acceptance checklist

- [ ] Valid proof submission succeeds
- [ ] Duplicate nullifier submission is rejected
- [ ] Unknown group root is rejected
- [ ] Altered answer commitment causes message binding failure
- [ ] `submissions` contains no direct identity field
- [ ] Receipt verifies client-side after submission

### Risks and notes

- The proof is not enough by itself. Message binding correctness is mandatory.
- Do not make submission acceptance depend on cookies or user sessions.

## Phase 5. Admin Authoring, Commitments, and Public Manifest

### Objective

Allow exam authorities to prepare and publish an exam in a way that freezes the public facts required for later verification.

### Deliverables

- Admin exam creation flow
- Question set hash generation
- Answer key commitment generation
- Grading policy hash generation
- Public exam manifest
- Signed manifest publication
- Audit events for exam commitments and publication

### Dependencies

- Phase 1
- Phase 2

### Implementation checklist

- [ ] Implement exam creation and update endpoints
- [ ] Support question set upload and canonical hashing
- [ ] Support answer key commitment generation without exposing plaintext publicly
- [ ] Support grading policy canonicalization and hashing
- [ ] Generate a public manifest with exam metadata, root, hashes, and time windows
- [ ] Sign the manifest with a server-controlled signing key
- [ ] Enforce that publish is blocked until all required commitments exist
- [ ] Write audit events for commitment and publish actions

### Acceptance checklist

- [ ] Equivalent question JSON with different key order yields the same hash
- [ ] Exam cannot publish before required commitments exist
- [ ] Manifest is downloadable and signature-verifiable
- [ ] Status transition follows `DRAFT -> COMMITTED -> PUBLISHED -> OPEN`
- [ ] Public manifest contains no secret material

### Risks and notes

- Hash stability matters more than UI sophistication here.
- Treat the manifest as the public contract for later auditing.

## Phase 6. Student Exam-Taking Flow and Receipt UX

### Objective

Deliver a usable student flow that produces canonical answers, encrypted answer blobs, anonymous proof generation, and verifiable receipts.

### Deliverables

- Student exam-taking UI for fixed MCQ exam
- Canonical answer encoding
- `answerCommitment` generation
- Encrypted answer blob upload
- Web Worker proof generation
- Submission success screen and downloadable receipt
- Receipt verification page

### Dependencies

- Phase 3
- Phase 4
- Phase 5

### Implementation checklist

- [ ] Implement canonical answer encoding for fixed-size MCQ payloads
- [ ] Generate `answerCommitment` with salt
- [ ] Encrypt answer blob before upload
- [ ] Upload encrypted blob via presigned URL
- [ ] Generate Semaphore proof in a Web Worker
- [ ] Submit anonymous payload to the public API
- [ ] Lock local answer state after successful submit
- [ ] Add receipt download and client-side verification UI
- [ ] Add local draft recovery for interrupted sessions

### Acceptance checklist

- [ ] Student can complete a full submit flow and receive a receipt
- [ ] Receipt verifies in the browser without privileged server access
- [ ] Draft answers survive refresh or temporary disconnect
- [ ] Duplicate submit attempt is rejected after the first success
- [ ] Admin and marker views do not expose the candidate identity

### Risks and notes

- Browser proof generation must be isolated from the main UI thread.
- Avoid front-end storage patterns that leak the identity secret or plaintext answers.

## Phase 7. Objective Grading Circuit and Proof Worker

### Objective

Prove that deterministic grading was computed correctly from committed answers, committed answer keys, and committed policy.

### Deliverables

- Noir circuit for fixed-size MCQ grading
- Compile, prove, and verify scripts
- Versioned verification key hash handling
- Worker job for objective grade proof generation
- Worker-side proof verification before persistence
- Grade draft persistence tied to proof artifacts

### Dependencies

- Phase 4
- Phase 5
- Phase 6

### Implementation checklist

- [ ] Implement a minimal fixed-size MCQ circuit, initially `N=10` or `N=20`
- [ ] Define public inputs: `answerCommitment`, `answerKeyCommitment`, `policyHash`, `score`, `maxScore`
- [ ] Define private inputs: answers, salts, answer key, and scoring params
- [ ] Add scripts to compile circuit and export verifier metadata
- [ ] Add negative tests for wrong key, wrong salt, wrong score, and out-of-range values
- [ ] Implement worker job `objective-grade-proof`
- [ ] Decrypt answer blob in the worker under controlled permissions
- [ ] Compute raw score, generate proof, verify proof, and store proof artifact
- [ ] Persist draft grade and proof metadata

### Acceptance checklist

- [ ] Correct answer set verifies successfully
- [ ] Modified score causes proof verification failure
- [ ] Modified salt causes proof verification failure
- [ ] Worker can process a small batch of submissions deterministically
- [ ] Proof artifact stores circuit version, `vkHash`, and public input hash

### Risks and notes

- This is the highest technical-risk MVP phase.
- If cryptographic hash support inside the circuit is temporarily simplified, the code must clearly mark the simplification as non-production and isolate it for replacement.

## Phase 8. Grade Finalization and Anonymous Claim

### Objective

Publish finalized grades in a privacy-preserving way, then allow the real student to claim the anonymous result after finalization.

### Deliverables

- Grade finalization flow
- `gradeCommitment` publication
- Student grade page with proof verification
- Claim endpoint tying finalized anonymous result to a real account
- Registrar-only or encrypted identity/result mapping
- Audit events for finalization and claim

### Dependencies

- Phase 4
- Phase 7

### Implementation checklist

- [ ] Finalize grades only from verified proof-backed results
- [ ] Publish grade commitment and proof metadata without exposing identity
- [ ] Implement student grade verification page
- [ ] Implement claim endpoint requiring authenticated session plus claim proof
- [ ] Verify claim proof links to the finalized anonymous submission
- [ ] Block claim before exam enters `FINALIZED` or `CLAIMING`
- [ ] Store deanonymized mapping in a restricted registrar context
- [ ] Add audit event for `GradeClaimed` without leaking student identity in public payloads

### Acceptance checklist

- [ ] Claim is rejected before finalization
- [ ] Correct identity can claim the correct anonymous result
- [ ] Different identity cannot claim another candidate's result
- [ ] Student can verify the published proof for the finalized score
- [ ] Only registrar-authorized paths can access the real identity mapping

### Risks and notes

- This is where conditional anonymity ends by policy. The code and audit model must make that boundary explicit.

## Phase 9. Auditor Console and Public Verification

### Objective

Expose the public evidence required for independent verification without exposing candidate privacy.

### Deliverables

- Auditor console UI
- Public manifest viewer
- Audit root history viewer
- Receipt upload and verification flow
- Proof artifact explorer
- Public verify endpoint

### Dependencies

- Phase 2
- Phase 4
- Phase 7
- Phase 8

### Implementation checklist

- [ ] Build public exam overview with manifest and commitment metadata
- [ ] Show group root history and audit roots
- [ ] Implement client-side receipt verification
- [ ] Show proof artifact metadata including circuit version and `vkHash`
- [ ] Add public proof verification endpoint for server-side validation
- [ ] Add tamper demo tests proving that modified receipts fail verification

### Acceptance checklist

- [ ] Public manifest is accessible
- [ ] Receipt upload reports `verified` or `invalid` accurately
- [ ] Audit root history is visible
- [ ] Proof artifact explorer surfaces versioned verifier metadata
- [ ] Tampered receipt verification fails

### Risks and notes

- The auditor surface should verify public facts only. It must not become a side-channel for sensitive metadata.

## Phase 10. Blind Marking Workflow for Subjective Questions

### Objective

Add a workflow for anonymous subjective marking with deterministic assignment and auditable aggregation, without over-claiming what ZK can prove.

### Deliverables

- Submission part slicing
- Marker enrollment with pseudonym keys
- Deterministic assignment generation from public seed
- Marker task UI
- Signed marks
- Aggregation rules for average and adjudication thresholds
- Audit events for assignment and marks

### Dependencies

- Phase 2
- Phase 4
- Phase 5

### Implementation checklist

- [ ] Split submissions into grading parts
- [ ] Define assignment inputs: `submissionRoot`, `markerRoot`, `seed`, `policy`
- [ ] Generate deterministic grading tasks
- [ ] Build marker console that shows blinded content only
- [ ] Sign mark payloads with marker pseudonym keys
- [ ] Verify mark signatures server-side
- [ ] Implement adjudication trigger when score delta exceeds threshold
- [ ] Record assignments and marks in the audit log

### Acceptance checklist

- [ ] Same seed and same roots reproduce the same assignments
- [ ] Marker responses contain no real candidate identity
- [ ] Large scoring deltas trigger adjudication
- [ ] Signed marks verify correctly
- [ ] Public or internal audit replay can reconstruct the assignment process

### Risks and notes

- Do not describe this phase as "proving subjective fairness". It proves process integrity, not human semantic correctness.

## Phase 11. Optional EVM Root Anchoring

### Objective

Anchor phase roots to a testnet contract so external observers can verify that audit roots were externally timestamped and not rewritten silently.

### Deliverables

- `packages/contracts` with Foundry setup
- `ZkExamRootRegistry` contract
- Tests for root registration
- Worker job that anchors audit roots
- Auditor view of transaction hashes

### Dependencies

- Phase 2
- Phase 9

### Implementation checklist

- [ ] Scaffold Foundry contract workspace
- [ ] Implement root registry contract
- [ ] Add local and testnet deployment scripts
- [ ] Implement `anchor-audit-root` worker job
- [ ] Persist transaction hashes next to anchored roots
- [ ] Expose anchor metadata in the auditor UI

### Acceptance checklist

- [ ] Contract tests pass
- [ ] Local Anvil or testnet anchor succeeds
- [ ] Auditor UI shows transaction hash for anchored root
- [ ] No private data is emitted on-chain

### Risks and notes

- Root anchoring improves external trust but does not replace correct internal audit logic.

## Phase 12. Beta Hardening and Production Readiness

### Objective

Move from demo credibility to operational credibility.

### Deliverables

- Structured logging without private payload leakage
- Admin MFA and stronger role enforcement
- CSP headers and front-end hardening
- Rate limits and payload size limits
- Dependency auditing
- Playwright end-to-end tests
- Load tests for group size, submissions, and workers
- Privacy, security, and runbook documentation

### Dependencies

- MVP phases complete

### Implementation checklist

- [ ] Add structured logs with privacy-safe redaction
- [ ] Require MFA for high-risk admin actions
- [ ] Add strict CSP and security headers
- [ ] Add payload size guards for proof endpoints
- [ ] Add rate limiting compatible with anonymous submission design
- [ ] Add Playwright flows for register, submit, grade, and claim
- [ ] Add load tests for commitments, submissions, and grading jobs
- [ ] Add operational runbooks and privacy model documentation

### Acceptance checklist

- [ ] End-to-end flow passes in automated tests
- [ ] Sensitive data is absent from default application logs
- [ ] Admin endpoints are protected by role and MFA checks
- [ ] Anonymous submission still works under rate limiting and concurrency
- [ ] Recovery steps exist for worker crashes and partial failures

### Risks and notes

- Beta hardening should not start before the core protocol path is proven correct.

## 7. Cross-Cutting Verification Matrix

The following tests should exist before calling the MVP complete.

- [ ] Three local users can register commitments and join an exam group
- [ ] A valid anonymous submission is accepted
- [ ] A duplicate submission from the same identity is rejected
- [ ] A modified message binding is rejected
- [ ] A modified encrypted blob hash is rejected
- [ ] A tampered receipt fails verification
- [ ] An untampered receipt verifies offline
- [ ] A valid objective grading proof verifies
- [ ] A forged score fails proof verification
- [ ] Finalized grade claim succeeds only for the correct identity
- [ ] Anonymous submission tables remain free of real identity data

## 8. Recommended Execution Order

For actual implementation, the recommended order is:

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3
5. Phase 4
6. Phase 5
7. Phase 6
8. Phase 7
9. Phase 8
10. Phase 9

Phases 10 to 12 should follow after the MVP path is stable.

## 9. Definition of MVP Complete

The MVP should be considered complete only when all of the following are true:

1. An eligible student can register a local anonymous identity and join an exam.
2. The student can submit anonymously exactly once and receive a verifiable receipt.
3. The system can generate and verify an objective grading proof for that submission.
4. The student can verify the finalized result and claim it with the same identity after finalization.
5. An auditor can independently verify manifest data, receipts, and proof metadata without accessing private data.
