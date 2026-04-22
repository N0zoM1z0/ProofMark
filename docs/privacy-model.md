# ProofMark Privacy Model

## Security Goals

- The registrar can confirm eligibility without learning the later anonymous submission.
- The submission gateway can verify group membership and uniqueness without learning the real student identity.
- Auditors can verify receipts, manifests, audit roots, and proof metadata without access to decrypted answer content.
- Subjective markers only see blinded response text and rubric context, not candidate identity.

## Explicit Non-Goals

- ProofMark does not prove semantic fairness for subjective grading.
- ProofMark does not hide traffic metadata from the network edge.
- ProofMark does not prevent a compromised administrator from abusing privileged controls. It raises the bar with MFA, audit events, and redaction.

## Identity Separation

- Real student identifiers only enter the registration and claim surfaces.
- `registrarIdentityLink.realUserRefCiphertext` stores a one-way hash of the mock student id, not the raw identifier.
- Anonymous submission rows are keyed by `nullifierHash`, `groupRoot`, commitments, and encrypted blob references.
- The submission flow never stores `studentId`, `sessionId`, or browser-local wallet material in the anonymous submission table.

## Audit and Receipt Privacy

- Request logs store method, path, status, timing, and hashed actor handles.
- Request bodies, proofs, signatures, answer payloads, and raw identities are redacted before serialization.
- Receipts expose only the submission-facing values needed for independent verification:
  `submissionId`, `nullifierHash`, `messageHash`, `auditRoot`, and the signed inclusion proof.

## Subjective Marking Privacy

- Each `SubmissionPart` is assigned deterministically but disclosed to markers only through blinded task ids.
- Marker responses are signed locally with pseudonym keys.
- Divergent scores trigger adjudication without revealing candidate identity.

## Operational Constraints

- Stable receipt and manifest verification requires stable Ed25519 signing keys.
- Stable decryption and grading requires a stable blob encryption private key.
- Log redaction depends on application code paths; new endpoints must avoid logging request bodies by default.

## Review Checklist For New Changes

- Does the endpoint accept or emit raw student identifiers?
- Does any log line include request body data, proof points, ciphertext, or response text?
- Does the change introduce a direct join path between `Submission` and real identity material?
- Does the UI keep secret material browser-local unless the blueprint explicitly requires disclosure?
