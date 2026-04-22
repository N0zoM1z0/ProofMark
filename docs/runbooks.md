# ProofMark Runbooks

## Local Beta Bring-Up

1. `corepack prepare pnpm@10.10.0 --activate`
2. `pnpm install`
3. `docker compose up -d`
4. `pnpm db:migrate:deploy`
5. `pnpm --filter @proofmark/api dev`
6. In another shell: `pnpm seed:demo`
7. Optionally start `pnpm --filter @proofmark/web dev`
8. Use `/student/register` to add at least one commitment before calling the admin `publish` and `open` endpoints.

## Required Secrets and Operators

- `ADMIN_IDS` must contain the allowlisted admin principals accepted by the mock auth layer.
- `ADMIN_MFA_SECRET` is the shared TOTP secret for high-risk admin actions. Every `POST`, `PATCH`, and `PUT` under `/api/admin/*` now requires `x-admin-mfa-code`.
- `MANIFEST_SIGNING_KEY` and `RECEIPT_SIGNING_KEY` should be long-lived Ed25519 keys if external verifiers need stable signatures across restarts.
- `BLOB_ENCRYPTION_PRIVATE_KEY` must be stable anywhere decryption or grading is expected after process restart.
- `LOG_REDACTION_SALT` should be unique per environment so hashed principals in logs cannot be correlated across deployments.

## Admin MFA

The admin TOTP code is a 30-second six-digit code derived from `ADMIN_MFA_SECRET`.

- Current code for local development:
  `node -e "const { createHmac } = require('node:crypto'); const s=process.env.ADMIN_MFA_SECRET||'proofmark-dev-admin-mfa-secret'; const c=Math.floor(Date.now()/30000); const b=Buffer.alloc(8); b.writeBigUInt64BE(BigInt(c)); const d=createHmac('sha1', Buffer.from(s)).update(b).digest(); const o=d[d.length-1]&15; const n=((d[o]&127)<<24)|((d[o+1]&255)<<16)|((d[o+2]&255)<<8)|(d[o+3]&255); console.log(String(n%1_000_000).padStart(6,'0'));"`

## Recovery From Failed Submissions

Symptoms:
- upload object exists but `/submissions` was not accepted
- submission exists but receipt download failed locally

Recovery:
1. Inspect the upload object under `s3://$S3_BUCKET/submissions/...`.
2. Verify the encrypted blob hash in object metadata matches the presigned request.
3. Re-submit the same upload reference only if the prior request never created a submission row.
4. If a submission row exists, do not resubmit. Retrieve the receipt from the API/database snapshot instead and re-verify it.

## Recovery From Worker Failure

Symptoms:
- exam is `CLOSED` or `GRADING`, but no verified proof artifact exists
- worker exited before creating `ProofArtifact` or `Grade`

Recovery:
1. Confirm the encrypted blob is still readable from MinIO/S3.
2. Re-run:
   `corepack pnpm exec tsx apps/worker/src/index.ts --exam-id=<exam-id>`
3. If only one submission is affected:
   `corepack pnpm exec tsx apps/worker/src/index.ts --submission-id=<submission-id>`
4. Verify a new `ObjectiveGradeVerified` audit event was appended exactly once.
5. Confirm `ProofArtifact.verificationStatus=VERIFIED` before finalization.

## Recovery From Blind Marking Partial Failure

Symptoms:
- exam is stuck in `MARKING`
- one or more `GradingTask` rows remain `ASSIGNED`
- adjudication task was never submitted

Recovery:
1. List pending tasks via `/api/marker/exams/:examId/tasks`.
2. Confirm the correct marker still has the local pseudonym private key.
3. Re-open the task and re-submit the signed mark. Do not rotate marker keys mid-exam unless all pending tasks are reissued.
4. If reassignment is necessary, mark the old marker inactive, regenerate the assignment root, and record the administrative reason in the audit log before continuing.

## Receipt and Manifest Rotation

- Rotating `RECEIPT_SIGNING_KEY` invalidates future signatures but does not change stored receipt hashes.
- Rotating `MANIFEST_SIGNING_KEY` changes future manifest signatures only.
- Rotating `BLOB_ENCRYPTION_PRIVATE_KEY` without re-encrypting stored blobs will break grading and audit replay. Treat it as migration work, not a runtime toggle.

## Verification Commands

- Full beta verification: `pnpm verify:beta`
- End-to-end lifecycle smoke: `pnpm test:smoke`
- Browser smoke: `pnpm test:playwright`
- Concurrent load smoke: `pnpm test:load`
- Dependency audit: `npm_config_registry=https://registry.npmjs.org pnpm audit --prod`

## Known Dependency Audit Residual

- `@prisma/client -> prisma -> @prisma/dev -> @hono/node-server` currently reports one moderate advisory (`GHSA-92pp-h63x-v22m`) through Prisma's bundled development tooling. It is not in the ProofMark request path, but it should be re-checked on every Prisma upgrade until the upstream chain picks up `@hono/node-server >= 1.19.13`.
