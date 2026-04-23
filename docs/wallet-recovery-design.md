# ProofMark Wallet Recovery Design

This document defines the current recovery design direction for student claim recovery.

## Goal

Allow a legitimate student to recover claim capability after losing browser-local wallet storage, without weakening the anonymous submission model or exposing extra identity linkage to marker or auditor roles.

## Selected Recovery Model

The selected direction is an **encrypted recovery package**.

At registration time:

- the browser-local Semaphore identity is still generated client-side
- the student still keeps the normal encrypted local backup
- the client may additionally escrow an encrypted recovery package for the same `examId` and `identityCommitment`

At recovery time:

- the student proves account ownership through the registrar-side identity surface
- an operator approves the recovery request
- the recovery package is restored so the student can reclaim the original identity and complete claim

The recovery flow preserves the original identity commitment. It does not replace claim with a new identity or a detached claim-only credential.

## Threat Model

The design must defend against:

- another student attempting to recover someone else’s wallet
- an operator restoring a wallet without a student-linked request
- silent recovery attempts without audit records
- receipt-only possession being enough to hijack claim
- recovery leaking student identity into marker or auditor surfaces

The design does not try to make the operator omnipotence-free. Instead, it makes recovery approval explicit, auditable, and scoped.

## Data Model

Two new records define the recovery workflow.

### `WalletRecoveryPackage`

Stores the escrowed recovery material for one `examId` plus one `identityCommitment`.

Important fields:

- `examId`
- `identityCommitment`
- `userReferenceCiphertext`
- `encryptedIdentityCiphertext`
- `encryptedIdentityIv`
- `encryptedIdentitySalt`
- `operatorWrapCiphertext`
- `packageHash`
- `status`
- lifecycle timestamps such as `escrowedAt`, `restoredAt`, `revokedAt`, and `expiresAt`

Constraints:

- exactly one active package per `examId` and `identityCommitment`
- package lifecycle is tracked independently from claim lifecycle

### `WalletRecoveryRequest`

Stores the operator-reviewed request to unlock or restore a recovery package.

Important fields:

- `examId`
- `walletRecoveryPackageId`
- `requestedByCiphertext`
- `operatorReferenceCiphertext`
- `status`
- `reason`
- `requestedAt`
- `reviewedAt`
- `completedAt`

This record exists even if the package itself remains unchanged, so approval and completion can be audited separately.

## Lifecycle

### Package lifecycle

- `ACTIVE`: recovery package is escrowed and eligible for a recovery request
- `RESTORED`: package has already been used to recover claim capability
- `REVOKED`: package has been administratively invalidated
- `EXPIRED`: package aged out without use

### Request lifecycle

- `REQUESTED`: student recovery request has been opened
- `APPROVED`: operator has approved recovery
- `REJECTED`: request was denied
- `COMPLETED`: recovery was executed
- `CANCELLED`: request was withdrawn or invalidated before completion

## Operational Rules

- Recovery remains scoped to the registration and claim surfaces only.
- Marker and auditor roles do not need recovery-package access.
- Every package creation, review, approval, rejection, restoration, and revocation should map to an append-only audit event.
- If no recovery package exists, the operator must not improvise a hidden backdoor claim path.

## Follow-On Implementation

The next implementation slice should add:

1. API endpoints for package escrow and recovery request creation.
2. Audit events for package creation and recovery request transitions.
3. Student UX for backup escrow and later restore.
4. Operator UX or scripted flow for review and completion.
5. Recovery tests proving that restored claim still binds to the original anonymous submission.
