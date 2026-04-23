# ProofMark Demo Walkthrough

This walkthrough is designed for a live room demo with:

- 1 admin
- 2 to 5 students
- 2 markers
- 1 auditor

## Goal

Show that ProofMark can:

- separate identity from submission
- enforce one anonymous submission per identity
- produce a locally verifiable receipt
- blind the subjective marking workflow
- publish a finalized grade that can be claimed back to the student

## Suggested timeline

### Part 1. Setup and framing

Operator says:

> ProofMark is not trying to prove subjective fairness with ZK. It proves the deterministic parts, hides identity during submission and marking, and records every critical state transition in an auditable log.

Show:

- `/auditor`
- current public routes
- the seeded `examId`

### Part 2. Student wallet creation and registration

Students 1 and 2 each do:

1. Open `/student/register`.
2. Enter the same `examId`.
3. Enter distinct mock student ids.
4. Create local wallets.
5. Register commitments.

Operator says:

> The server sees a student account during registration, but the submission flow later only sees a Semaphore proof, a nullifier, and encrypted exam material.

### Part 3. Publish and open

Admin calls:

- `publish`
- `open`

Show:

- `/auditor`
- manifest appears with signed public metadata
- group root is now fixed for this published version

### Part 4. Anonymous submission

Students open `/student/exam` and do:

1. Load the exam.
2. Unlock the local identity.
3. Answer the MCQ.
4. Write a short subjective answer.
5. Submit anonymously.

Show:

- each browser gets a receipt
- receipt verification succeeds in `/verify-receipt`

Operator says:

> The receipt is independently verifiable. A student does not need to trust the UI after the fact; they can re-check the signature and Merkle inclusion locally.

### Part 5. Auditor verification

Auditor uses:

- `/auditor`
- `/verify-receipt`

Show:

- signed manifest
- audit roots
- uploaded receipt verification
- no real student identity in the public submission data

### Part 6. Close and assign markers

Admin closes the exam, enrolls two markers, and generates assignments.

Markers open `/marker`.

Each marker:

1. Loads their assigned tasks using their `markerId`.
2. Reviews blinded content only.
3. Signs and submits marks locally.

If scores diverge enough, show adjudication.

Operator says:

> The subjective side relies on anonymity, deterministic assignment, signed marks, and auditability. The ZK proof only covers the deterministic objective grading path.

### Part 7. Objective proof and finalization

Operator runs the worker.

Show:

- proof artifact appears in `/auditor`
- finalized grade endpoint returns proof metadata

Then admin calls:

- `grading`
- `finalize`
- `claiming`

### Part 8. Student claim

Students open `/student/claim` and:

1. load the claim context
2. reuse the stored receipt or upload the saved receipt JSON
3. unlock the same local identity
4. claim the finalized grade

Operator says:

> The claim reconnects the anonymous submission back to the student account only at the end of the workflow.

## What to emphasize during the demo

- Registration knows identity, submission does not.
- Submission knows proof/nullifier, not student account.
- Subjective marking sees blinded work, not student identity.
- Auditor can verify receipts and public roots without privileged access.
- Objective score proof and subjective blind marking are intentionally separated.

## Minimal success criteria

The demo is successful if you show all of the following:

- at least 2 students register and submit
- at least 1 receipt verifies locally
- at least 2 markers submit blinded marks
- the worker generates at least 1 verified proof artifact
- at least 1 finalized grade is claimed
