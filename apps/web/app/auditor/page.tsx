'use client';

import { useState, type FormEvent } from 'react';
import {
  type SubmissionReceipt,
  verifyReceipt
} from '../student/_lib/proofmark-crypto';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type PublicExam = {
  currentGroupRoot: string | null;
  endsAt: string | null;
  examVersion: number;
  id: string;
  manifestHash: string | null;
  questionSetHash: string | null;
  startsAt: string | null;
  status: string;
  submitScope: string;
  title: string;
};

type PublicManifestResponse = {
  manifest: Record<string, unknown>;
  manifestHash: string;
  serverPublicKey: string;
  serverSignature: string;
  status: string;
};

type AuditEvidenceResponse = {
  auditRoots: Array<{
    createdAt: string;
    fromSeq: number;
    id: string;
    merkleRoot: string;
    phase: string;
    prevPhaseRoot: string | null;
    toSeq: number;
  }>;
  currentAuditRoot: string | null;
  currentEventCount: number;
  currentGroupRoot: string | null;
  examId: string;
  examStatus: string;
  groupRootHistory: Array<{
    addedAt: string;
    groupRoot: string;
    groupSnapshotVersion: number;
    identityCommitment: string;
    memberCount: number;
  }>;
};

type ProofArtifactResponse = {
  examId: string;
  examStatus: string;
  proofArtifacts: Array<{
    circuitName: string | null;
    circuitVersion: string | null;
    createdAt: string;
    grade: {
      finalScore: string | null;
      finalizedAt: string | null;
      gradeCommitment: string | null;
      maxScore: string | null;
      status: string;
    } | null;
    proofArtifactId: string;
    proofHash: string;
    publicInputsHash: string;
    submissionId: string | null;
    submissionIndex: number | null;
    type: string;
    verificationStatus: string;
    vkHash: string | null;
  }>;
};

type ServerReceiptVerification = {
  checks: {
    matchesAuditEvent: boolean;
    matchesStoredReceiptHash: boolean;
    matchesSubmission: boolean;
    merkleProofValid: boolean;
    publicKeyMatchesConfigured: boolean;
    signatureValid: boolean;
  };
  examId: string;
  receiptHash: string;
  storedSubmissionStatus: string | null;
  submissionId: string;
  verified: boolean;
};

async function fetchJson<T>(path: string) {
  const response = await fetch(`${API_BASE_URL}${path}`);

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as T;
}

export default function AuditorPage() {
  const [examIdInput, setExamIdInput] = useState('');
  const [status, setStatus] = useState(
    'Load a published exam id to inspect manifest data, cumulative audit roots, group roots, and proof metadata.'
  );
  const [publicExam, setPublicExam] = useState<PublicExam | null>(null);
  const [manifest, setManifest] = useState<PublicManifestResponse | null>(null);
  const [auditEvidence, setAuditEvidence] = useState<AuditEvidenceResponse | null>(
    null
  );
  const [proofArtifacts, setProofArtifacts] = useState<ProofArtifactResponse | null>(
    null
  );
  const [receipt, setReceipt] = useState<SubmissionReceipt | null>(null);
  const [localReceiptVerification, setLocalReceiptVerification] = useState<{
    merkleProofValid: boolean;
    signatureValid: boolean;
    verified: boolean;
  } | null>(null);
  const [serverReceiptVerification, setServerReceiptVerification] =
    useState<ServerReceiptVerification | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadEvidence(examId: string) {
    setLoading(true);
    setStatus(`Loading public evidence for ${examId}...`);

    try {
      const [nextPublicExam, nextManifest, nextAuditEvidence, nextProofArtifacts] =
        await Promise.all([
          fetchJson<PublicExam>(`/api/public/exams/${examId}`),
          fetchJson<PublicManifestResponse>(`/api/public/exams/${examId}/manifest`),
          fetchJson<AuditEvidenceResponse>(`/api/public/exams/${examId}/audit-roots`),
          fetchJson<ProofArtifactResponse>(
            `/api/public/exams/${examId}/proof-artifacts`
          )
        ]);

      setPublicExam(nextPublicExam);
      setManifest(nextManifest);
      setAuditEvidence(nextAuditEvidence);
      setProofArtifacts(nextProofArtifacts);
      setStatus(
        `Loaded public evidence for ${nextPublicExam.title} with ${nextAuditEvidence.currentEventCount} audit events and ${nextProofArtifacts.proofArtifacts.length} proof artifacts.`
      );
    } catch (error) {
      setPublicExam(null);
      setManifest(null);
      setAuditEvidence(null);
      setProofArtifacts(null);
      setStatus(
        error instanceof Error ? error.message : 'Failed to load auditor evidence'
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleReceiptUpload(file: File | undefined) {
    if (!file) {
      return;
    }

    try {
      const nextReceipt = JSON.parse(await file.text()) as SubmissionReceipt;
      const [nextLocalVerification, nextServerVerification] = await Promise.all([
        verifyReceipt(nextReceipt),
        fetch(`${API_BASE_URL}/api/public/verify-receipt`, {
          body: JSON.stringify(nextReceipt),
          headers: {
            'content-type': 'application/json'
          },
          method: 'POST'
        }).then(async (response) => {
          if (!response.ok) {
            throw new Error(await response.text());
          }

          return (await response.json()) as ServerReceiptVerification;
        })
      ]);

      setReceipt(nextReceipt);
      setLocalReceiptVerification(nextLocalVerification);
      setServerReceiptVerification(nextServerVerification);
      setStatus(
        nextServerVerification.verified
          ? 'Receipt verified both locally and against the stored server record.'
          : 'Receipt parsed, but at least one verification path failed.'
      );
    } catch (error) {
      setReceipt(null);
      setLocalReceiptVerification(null);
      setServerReceiptVerification(null);
      setStatus(
        error instanceof Error ? error.message : 'Failed to verify uploaded receipt'
      );
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Auditor Console</p>
        <h1>Auditor console for public evidence and tamper checks.</h1>
        <p className="lede">
          Inspect the published manifest, replay group root growth, browse verified
          proof artifacts, and verify a receipt both in-browser and against the
          stored API record.
        </p>
      </section>

      <section className="card form-card">
        <form
          className="inline-form"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            const trimmedExamId = examIdInput.trim();

            if (!trimmedExamId) {
              setStatus('Enter an exam id before loading auditor evidence.');
              return;
            }

            void loadEvidence(trimmedExamId);
          }}
        >
          <label className="field grow">
            <span>Exam ID</span>
            <input
              value={examIdInput}
              onChange={(event) => {
                setExamIdInput(event.target.value);
              }}
              placeholder="Paste a published exam id"
            />
          </label>
          <button type="submit" disabled={loading}>
            {loading ? 'Loading…' : 'Load Evidence'}
          </button>
        </form>
        <label className="import-button">
          Upload Receipt JSON
          <input
            type="file"
            accept="application/json"
            onChange={(event) => {
              void handleReceiptUpload(event.target.files?.[0]);
            }}
          />
        </label>
        <p className="status-copy">{status}</p>
      </section>

      {publicExam && manifest && auditEvidence && proofArtifacts ? (
        <>
          <section className="card">
            <div className="meta-grid">
              <div>
                <span className="meta-label">Exam</span>
                <p>{publicExam.title}</p>
              </div>
              <div>
                <span className="meta-label">Status</span>
                <p>{publicExam.status}</p>
              </div>
              <div>
                <span className="meta-label">Manifest Hash</span>
                <p>{manifest.manifestHash}</p>
              </div>
              <div>
                <span className="meta-label">Question Set Hash</span>
                <p>{publicExam.questionSetHash ?? 'Unavailable'}</p>
              </div>
              <div>
                <span className="meta-label">Current Group Root</span>
                <p>{auditEvidence.currentGroupRoot ?? 'Unavailable'}</p>
              </div>
              <div>
                <span className="meta-label">Current Audit Root</span>
                <p>{auditEvidence.currentAuditRoot ?? 'Unavailable'}</p>
              </div>
            </div>
            <pre className="code-block">{JSON.stringify(manifest.manifest, null, 2)}</pre>
          </section>

          <section className="card">
            <h2>Audit Root History</h2>
            <div className="timeline-grid">
              {auditEvidence.auditRoots.map((snapshot) => (
                <article key={snapshot.id} className="timeline-card">
                  <p className="eyebrow">{snapshot.phase}</p>
                  <p className="timeline-copy">
                    Events {snapshot.fromSeq} to {snapshot.toSeq}
                  </p>
                  <p className="timeline-copy">{snapshot.merkleRoot}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="card">
            <h2>Group Root History</h2>
            <div className="timeline-grid">
              {auditEvidence.groupRootHistory.map((snapshot) => (
                <article
                  key={`${snapshot.groupSnapshotVersion}-${snapshot.identityCommitment}`}
                  className="timeline-card"
                >
                  <p className="eyebrow">Snapshot {snapshot.groupSnapshotVersion}</p>
                  <p className="timeline-copy">
                    Members {snapshot.memberCount} · Commitment {snapshot.identityCommitment}
                  </p>
                  <p className="timeline-copy">{snapshot.groupRoot}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="card">
            <h2>Proof Artifact Explorer</h2>
            <div className="timeline-grid">
              {proofArtifacts.proofArtifacts.map((artifact) => (
                <article key={artifact.proofArtifactId} className="timeline-card">
                  <p className="eyebrow">
                    {artifact.circuitName ?? artifact.type} · {artifact.verificationStatus}
                  </p>
                  <p className="timeline-copy">
                    Submission #{artifact.submissionIndex ?? 'n/a'} · Circuit{' '}
                    {artifact.circuitVersion ?? 'unknown'}
                  </p>
                  <p className="timeline-copy">vkHash {artifact.vkHash ?? 'Unavailable'}</p>
                  <p className="timeline-copy">
                    Proof hash {artifact.proofHash}
                  </p>
                  {artifact.grade ? (
                    <p className="timeline-copy">
                      Grade {artifact.grade.finalScore ?? 'n/a'} /{' '}
                      {artifact.grade.maxScore ?? 'n/a'} · {artifact.grade.status}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        </>
      ) : null}

      {receipt && localReceiptVerification && serverReceiptVerification ? (
        <section className="card">
          <h2>Receipt Verification</h2>
          <div className="meta-grid">
            <div>
              <span className="meta-label">Submission ID</span>
              <p>{receipt.submissionId}</p>
            </div>
            <div>
              <span className="meta-label">Exam ID</span>
              <p>{receipt.examId}</p>
            </div>
            <div>
              <span className="meta-label">Local Signature</span>
              <p>{localReceiptVerification.signatureValid ? 'Valid' : 'Invalid'}</p>
            </div>
            <div>
              <span className="meta-label">Local Merkle Path</span>
              <p>{localReceiptVerification.merkleProofValid ? 'Valid' : 'Invalid'}</p>
            </div>
            <div>
              <span className="meta-label">Stored Receipt Hash</span>
              <p>
                {serverReceiptVerification.checks.matchesStoredReceiptHash
                  ? 'Matched'
                  : 'Mismatch'}
              </p>
            </div>
            <div>
              <span className="meta-label">Configured Server Key</span>
              <p>
                {serverReceiptVerification.checks.publicKeyMatchesConfigured
                  ? 'Matched'
                  : 'Mismatch'}
              </p>
            </div>
            <div>
              <span className="meta-label">Audit Event Record</span>
              <p>
                {serverReceiptVerification.checks.matchesAuditEvent
                  ? 'Matched'
                  : 'Mismatch'}
              </p>
            </div>
            <div>
              <span className="meta-label">Server Verdict</span>
              <p>{serverReceiptVerification.verified ? 'Verified' : 'Invalid'}</p>
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
