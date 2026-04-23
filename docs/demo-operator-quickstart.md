# ProofMark Demo Operator Quickstart

This is the shortest path to a live local demo with one admin, multiple students, two markers, and one auditor.

## 1. Start the stack

```bash
corepack prepare pnpm@10.10.0 --activate
pnpm install
docker compose up -d
pnpm db:migrate:deploy
pnpm --filter @proofmark/api dev
pnpm --filter @proofmark/web dev
```

If you prefer production-like local serving:

```bash
pnpm build
node apps/api/dist/main.js
pnpm --filter @proofmark/web exec next start --hostname 127.0.0.1 --port 3101
```

## 2. Seed one demo exam

```bash
pnpm seed:demo
```

The script returns an `examId`. The seeded exam is intentionally left in `REGISTRATION`.

Before using the demo with real students, note two current release limitations:

- objective proof artifacts still use the development placeholder backend rather than a production `Noir/Barretenberg` circuit
- claim still depends on the browser-local student wallet, so students should export encrypted backups before they rely on later claim

## 3. Refresh the admin MFA code

```bash
pnpm admin:mfa
```

All admin mutations require:

- `x-admin-id`
- `x-admin-mfa-code`

Local defaults:

- `x-admin-id: admin-demo`
- `ADMIN_MFA_SECRET: proofmark-dev-admin-mfa-secret`

## 4. Student registration

Each student opens:

- `http://127.0.0.1:3101/student/register`

Steps:

1. Enter the `examId`.
2. Enter a mock student id such as `student-a`, `student-b`, `student-c`.
3. Enter a wallet passphrase.
4. Click `Create Identity`.
5. Click `Register Commitment`.

Wait until at least one student has registered before publishing the exam.

## 5. Publish and open the exam

Refresh the MFA code right before each command if the previous one is older than 30 seconds.

```bash
export EXAM_ID="<seeded exam id>"
export ADMIN_ID="admin-demo"
pnpm admin:mfa
export MFA_CODE="<paste the current mfaCode value>"
```

Publish:

```bash
curl -sS -X POST "http://127.0.0.1:3001/api/admin/exams/$EXAM_ID/publish" \
  -H "x-admin-id: $ADMIN_ID" \
  -H "x-admin-mfa-code: $MFA_CODE"
```

Refresh MFA again, then open:

```bash
pnpm admin:mfa
export MFA_CODE="<paste the refreshed mfaCode value>"
curl -sS -X POST "http://127.0.0.1:3001/api/admin/exams/$EXAM_ID/open" \
  -H "x-admin-id: $ADMIN_ID" \
  -H "x-admin-mfa-code: $MFA_CODE"
```

## 6. Student submission

Each student opens:

- `http://127.0.0.1:3101/student/exam`

Steps:

1. Enter the `examId`.
2. Enter the same wallet passphrase used during registration.
3. Click `Load Exam`.
4. Click `Unlock Identity`.
5. Answer the MCQ and the subjective prompt.
6. Click `Submit Anonymously`.
7. Save the displayed receipt JSON or keep it in browser storage.

## 7. Auditor verification

Auditor can use:

- `http://127.0.0.1:3101/auditor`
- `http://127.0.0.1:3101/verify-receipt`

Checks to demonstrate:

- public manifest is signed
- audit roots exist
- proof artifacts appear after grading
- a student receipt verifies locally

## 8. Close the exam

```bash
pnpm admin:mfa
export MFA_CODE="<paste the refreshed mfaCode value>"
curl -sS -X POST "http://127.0.0.1:3001/api/admin/exams/$EXAM_ID/close" \
  -H "x-admin-id: $ADMIN_ID" \
  -H "x-admin-mfa-code: $MFA_CODE"
```

## 9. Enroll two markers

```bash
pnpm admin:mfa
export MFA_CODE="<paste the refreshed mfaCode value>"
curl -sS -X POST "http://127.0.0.1:3001/api/admin/exams/$EXAM_ID/markers" \
  -H "content-type: application/json" \
  -H "x-admin-id: $ADMIN_ID" \
  -H "x-admin-mfa-code: $MFA_CODE" \
  -d '{"markerLabel":"Marker 1","markerRef":"marker-1"}'
```

```bash
pnpm admin:mfa
export MFA_CODE="<paste the refreshed mfaCode value>"
curl -sS -X POST "http://127.0.0.1:3001/api/admin/exams/$EXAM_ID/markers" \
  -H "content-type: application/json" \
  -H "x-admin-id: $ADMIN_ID" \
  -H "x-admin-mfa-code: $MFA_CODE" \
  -d '{"markerLabel":"Marker 2","markerRef":"marker-2"}'
```

The response returns each marker's `markerId` and signing key material. Keep those private.

## 10. Generate blind marking assignments

```bash
pnpm admin:mfa
export MFA_CODE="<paste the refreshed mfaCode value>"
curl -sS -X POST "http://127.0.0.1:3001/api/admin/exams/$EXAM_ID/assignments" \
  -H "content-type: application/json" \
  -H "x-admin-id: $ADMIN_ID" \
  -H "x-admin-mfa-code: $MFA_CODE" \
  -d "{\"seed\":\"demo-seed-$(date +%s)\"}"
```

Then markers use:

- `http://127.0.0.1:3101/marker`

Each marker imports their own `markerId` and signing key, reviews blinded tasks, and submits marks.

## 11. Run the worker

After objective grading inputs are ready:

```bash
corepack pnpm exec tsx apps/worker/src/index.ts --exam-id="$EXAM_ID"
```

## 12. Finalize and open claiming

```bash
pnpm admin:mfa
export MFA_CODE="<paste the refreshed mfaCode value>"
curl -sS -X POST "http://127.0.0.1:3001/api/admin/exams/$EXAM_ID/grading" \
  -H "x-admin-id: $ADMIN_ID" \
  -H "x-admin-mfa-code: $MFA_CODE"
```

```bash
pnpm admin:mfa
export MFA_CODE="<paste the refreshed mfaCode value>"
curl -sS -X POST "http://127.0.0.1:3001/api/admin/exams/$EXAM_ID/finalize" \
  -H "x-admin-id: $ADMIN_ID" \
  -H "x-admin-mfa-code: $MFA_CODE"
```

```bash
pnpm admin:mfa
export MFA_CODE="<paste the refreshed mfaCode value>"
curl -sS -X POST "http://127.0.0.1:3001/api/admin/exams/$EXAM_ID/claiming" \
  -H "x-admin-id: $ADMIN_ID" \
  -H "x-admin-mfa-code: $MFA_CODE"
```

Students can then claim their finalized grade with the same local identity they used to submit.

## 13. Student claim

Student opens:

- `http://127.0.0.1:3101/student/claim`

Steps:

1. Enter the `examId`.
2. Enter the same student id used during registration.
3. Enter the same wallet passphrase used to unlock the local identity.
4. Click `Load Claim Context`.
5. If the receipt is not found in local storage, upload the saved receipt JSON.
6. Click `Unlock Identity`.
7. Click `Claim Finalized Grade`.

The page rebuilds the claim proof locally and submits the grade claim only when the exam is in `CLAIMING`.
