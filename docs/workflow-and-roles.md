# ProofMark Workflow and Roles

This document is the canonical operational reference for running a full ProofMark exam lifecycle.

## Current Release Caveats

- Objective grading proof artifacts now use the fixed MCQ Noir circuit and Barretenberg CLI. The circuit proves score computation over hashed choice inputs; the worker checks the external ProofMark commitments.
- Students must preserve the browser-local Semaphore identity until claim is complete. Recovery before `CLAIMING` now depends on an earlier escrowed recovery package plus the original wallet passphrase.

## 1. Purpose

ProofMark separates:

- registrar identity knowledge
- anonymous submission
- blind marking
- deterministic grading verification
- final grade claim

The system is designed so that no single ordinary workflow view sees more data than it needs.

## 2. Role Model

## Admin

Admin is responsible for:

- importing or authoring the exam through `/admin`
- saving reusable templates and question-bank entries
- creating the exam shell
- setting the question set
- setting the answer-key commitment
- setting the grading policy
- moving the exam through lifecycle states
- enrolling markers
- generating blind-marking assignments
- opening claiming after finalization

Admin can see:

- draft authoring bundles
- reusable template metadata
- question-bank metadata
- exam configuration
- current exam state
- group roots
- marker enrollment metadata
- audit events

Admin should not need to see:

- student identity secrets
- plaintext objective answer sheets in transit
- student identity attached to anonymous submissions

## Student

Student is responsible for:

- generating a local Semaphore identity
- keeping the wallet passphrase safe
- exporting the encrypted wallet backup before relying on later claim
- escrow an encrypted recovery package after commitment registration
- registering one identity commitment
- anonymously submitting the encrypted answer sheet
- saving the receipt
- claiming the finalized grade after the exam reaches `CLAIMING`
- requesting wallet recovery from `/student/claim` if the local wallet is lost

Student can see:

- their own local wallet backup
- their own escrowed recovery request status
- the public exam
- their own local receipt
- public finalized grade data for their submission

Student should never reveal:

- the identity secret
- the wallet backup plaintext
- the passphrase

## Marker

Marker is responsible for:

- loading assigned blinded tasks
- reviewing blinded response text only
- locally signing marks with the marker pseudonym private key
- submitting marks

Marker can see:

- blinded prompt and response text
- rubric hash
- max score
- assignment/task metadata

Marker must not see:

- student identity
- raw registrar linkage
- wallet or receipt material

## Auditor

Auditor is responsible for:

- checking public manifest integrity
- checking audit root history
- checking proof artifact metadata
- verifying uploaded receipts

Auditor can see:

- signed manifest
- audit roots and group roots
- finalized grade metadata
- verified proof artifact metadata
- uploaded receipts

Auditor does not need:

- student identity
- marker private keys
- blob decryption keys

## Worker

Worker is responsible for:

- decrypting stored answer blobs
- computing deterministic objective grading inputs
- generating and verifying proof artifacts
- updating grade records with objective score data

Worker can see:

- encrypted submission blobs
- the blob decryption private key
- objective grading inputs

Worker is not a user-facing role. It is operational infrastructure.

## 3. Core Artifacts

The full lifecycle revolves around these artifacts:

- `identity commitment`
- `group root`
- `answer commitment`
- `encrypted answer blob`
- `Semaphore proof`
- `receipt`
- `audit event`
- `audit root`
- `mark`
- `proof artifact`
- `finalized grade`
- `grade claim`

## 4. Lifecycle States

The main exam states are:

1. `DRAFT`
2. `COMMITTED`
3. `REGISTRATION`
4. `PUBLISHED`
5. `OPEN`
6. `CLOSED`
7. `MARKING`
8. `GRADING`
9. `FINALIZED`
10. `CLAIMING`
11. `ARCHIVED`

Operational meaning:

- `DRAFT`: admin is still editing the exam.
- `COMMITTED`: hashes and commitments are fixed for the current version.
- `REGISTRATION`: students may register Semaphore commitments.
- `PUBLISHED`: the manifest is public and signed.
- `OPEN`: students may submit anonymous responses.
- `CLOSED`: no more submissions are accepted.
- `MARKING`: blind subjective marking is active.
- `GRADING`: deterministic grade aggregation and proof generation are active.
- `FINALIZED`: the grade is published but not yet claimable.
- `CLAIMING`: students may link the anonymous result back to their account.

## 5. End-to-End Flow

## Step A. Admin authors the exam

Admin uses `/admin` or the admin API to:

- preview JSON / Markdown / CSV imports
- save or load reusable templates
- pull questions from the question bank
- create the exam shell
- upload the question set
- set the answer-key commitment
- set the grading policy
- call `commit`
- call `registration`

Result:

- exam configuration is fixed
- current version is committed
- students may now register commitments

Practical note:

- teachers usually work through `/admin`
- the low-level admin API remains useful for scripted setup and CI smoke flows

## Step B. Student registration

Student opens `/student/register` and:

1. enters the exam id
2. enters the student id used by the registrar
3. chooses a wallet passphrase
4. creates the local identity
5. registers the commitment

Result:

- registrar linkage is stored separately
- only the commitment enters the eligibility group
- the identity secret never leaves the browser
- backup export is operationally required if the student must still be able to claim after browser loss

## Step C. Publish and open

Admin calls:

- `publish`
- `open`

Result:

- a signed manifest exists
- the public exam is visible
- the group root is fixed for the published version
- students can submit

## Step D. Anonymous submission

Student opens `/student/exam` and:

1. loads the public exam
2. unlocks the local identity with the passphrase
3. answers objective and subjective prompts
4. encrypts the answer blob in-browser
5. uploads the encrypted blob
6. generates a Semaphore membership proof
7. submits anonymously

The server validates:

- current group root
- Semaphore proof correctness
- proof scope and message binding
- nullifier uniqueness
- exam status

Result:

- submission row is created
- audit event is appended
- a signed receipt is returned

## Step E. Receipt verification

Student or auditor opens `/verify-receipt` and uploads the receipt.

The browser checks:

- server signature validity
- Merkle inclusion proof validity

Result:

- the student can prove the submission was accepted into the append-only audit log

## Step F. Blind marking

After the exam closes:

1. admin calls `close`
2. admin enrolls markers
3. admin generates assignments
4. exam enters `MARKING`

Each marker opens `/marker` and:

1. enters `markerId`
2. pastes the marker pseudonym private key
3. saves the key locally
4. loads assigned exams
5. loads blinded tasks
6. opens one task
7. reviews only blinded content
8. enters score and comments
9. submits a locally signed mark

Result:

- marks are signed and auditable
- if scores differ beyond policy threshold, adjudication can be triggered
- once all subjective parts are resolved, the exam moves forward

## Step G. Objective grading proof

Worker is run against the exam after submissions are closed.

Worker:

1. reads encrypted blobs
2. decrypts them
3. reconstructs deterministic grading inputs
4. computes objective score
5. generates the proof artifact
6. verifies the proof artifact
7. updates the grade row

Result:

- proof artifact is visible to auditors
- objective grading is independently checkable

## Step H. Finalization

Admin calls:

- `finalize`
- `claiming`

Result:

- finalized grades are public for the anonymous submission ids
- students may now reclaim the result

## Step I. Student claim

Student opens `/student/claim` and:

1. enters the same exam id
2. enters the same student id used during registration
3. enters the wallet passphrase
4. loads claim context
5. restores the stored receipt or uploads receipt JSON
6. unlocks the local identity
7. submits the claim

Operational warning:

- if the student has lost the local identity and does not have an exported encrypted backup, the current release does not provide a supported recovery path

The system verifies:

- the exam is in `CLAIMING`
- the same identity commitment exists in registrar linkage
- the provided `x-student-id` matches the registrar-side student hash
- the claim proof matches the original submission nullifier and message binding

Result:

- the anonymous submission is linked back to the student account only at the end
- an append-only claim event is recorded

## 6. Role-by-Role UI Guide

## Student UI

- `/student/register`
  - create/import/export wallet
  - register commitment
- `/student/exam`
  - load public exam
  - unlock local identity
  - submit anonymously
  - verify stored receipt
- `/student/claim`
  - load finalized claim context
  - reuse receipt and local identity
  - claim the finalized grade

## Marker UI

- `/marker`
  - store marker private key locally
  - list assigned exams
  - load blinded tasks
  - submit locally signed marks

## Auditor UI

- `/auditor`
  - inspect manifest
  - inspect audit roots
  - inspect proof artifact metadata
  - verify receipt against server-side records
- `/verify-receipt`
  - fully local verification of a receipt JSON

## 7. Data Visibility Matrix

- Registrar/student id is visible during registration and claim only.
- Submission rows store `nullifier`, commitments, blob references, and receipt-linked metadata, not the real student id.
- Markers see blinded content only.
- Auditors see proof metadata and public verification material only.
- Worker has decryption and objective grading visibility, but not registrar linkage.

## 8. Practical Demo Recipe

For a strong demo, use:

- 1 admin
- 2 students
- 2 markers
- 1 auditor

Run the roles in this order:

1. admin seeds and opens the exam
2. students register
3. admin publishes and opens
4. students submit
5. auditor verifies a receipt
6. admin closes, enrolls markers, and assigns
7. markers submit blinded marks
8. worker runs objective grading proof generation
9. admin finalizes and opens claiming
10. one student claims

## 9. Operational Notes

- Students must use the same local identity for submit and claim.
- Students must keep either the stored receipt or a receipt JSON export.
- Marker private keys are sensitive and should remain local to the marker browser.
- The admin MFA code rotates every 30 seconds.
- The worker must run after submission close and before finalization if objective proof artifacts are required.
