'use client';

import { Group } from '@semaphore-protocol/group';
import { createIdentity, generateSemaphoreMembershipProof } from '@proofmark/zk-semaphore';
import type { ChangeEvent } from 'react';
import { useState } from 'react';
import {
  computeSubmissionMessage,
  type SubmissionReceipt,
  verifyReceipt
} from '../_lib/proofmark-crypto';
import {
  getReceiptStorageKey,
  readStoredValue,
  unlockStoredIdentity
} from '../_lib/wallet';

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type PublicExamResponse = {
  currentGroupRoot: string | null;
  examVersion: number;
  id: string;
  questionSetHash: string | null;
  status: string;
  submitScope: string;
  title: string;
};

type PublicGroupResponse = {
  examId: string;
  examVersion: number;
  groupRoot: string | null;
  memberCommitments: string[];
  size: number;
};

type FinalizedGradeResponse = {
  examStatus: string;
  grade: {
    finalScore: string;
    finalizedAt: string | null;
    gradeCommitment: string;
    gradeId: string;
    maxScore: string;
    objectiveScore: string;
  };
  proofArtifact?: {
    circuitName: string;
    circuitVersion: string;
    proofHash: string;
    publicInputsHash: string;
    verificationStatus: string;
    vkHash: string;
  } | null;
  submissionId: string;
};

type ClaimResult = {
  claimId: string;
  grade: {
    finalScore: string;
    gradeCommitment: string;
    gradeId: string;
    maxScore: string;
  };
};

async function generateClaimProof(params: {
  identityExport: string;
  memberCommitments: string[];
  message: string;
  scope: string;
}) {
  const group = new Group(params.memberCommitments.map((item) => BigInt(item)));
  const identity = createIdentity(params.identityExport);

  return generateSemaphoreMembershipProof({
    group,
    identity,
    message: params.message,
    scope: params.scope
  });
}

export default function StudentClaimPage() {
  const [examId, setExamId] = useState('demo-exam');
  const [studentId, setStudentId] = useState('student-demo');
  const [passphrase, setPassphrase] = useState('');
  const [status, setStatus] = useState(
    'Load a claiming exam, unlock the local identity, then claim the finalized grade.'
  );
  const [exam, setExam] = useState<PublicExamResponse | null>(null);
  const [group, setGroup] = useState<PublicGroupResponse | null>(null);
  const [receipt, setReceipt] = useState<SubmissionReceipt | null>(null);
  const [receiptVerification, setReceiptVerification] = useState<{
    merkleProofValid: boolean;
    signatureValid: boolean;
    verified: boolean;
  } | null>(null);
  const [commitment, setCommitment] = useState<string | null>(null);
  const [identityExport, setIdentityExport] = useState<string | null>(null);
  const [finalizedGrade, setFinalizedGrade] = useState<FinalizedGradeResponse | null>(
    null
  );
  const [claimResult, setClaimResult] = useState<ClaimResult | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);
  const [claiming, setClaiming] = useState(false);

  async function refreshFinalizedGrade(
    currentExam: PublicExamResponse,
    currentReceipt: SubmissionReceipt | null
  ) {
    if (!currentReceipt) {
      setFinalizedGrade(null);
      return;
    }

    const response = await fetch(
      `${apiBaseUrl}/api/public/exams/${currentExam.id}/submissions/${currentReceipt.submissionId}/finalized-grade`
    );

    if (!response.ok) {
      setFinalizedGrade(null);
      return;
    }

    setFinalizedGrade((await response.json()) as FinalizedGradeResponse);
  }

  async function applyReceipt(
    nextReceipt: SubmissionReceipt,
    currentExam?: PublicExamResponse | null
  ) {
    setReceipt(nextReceipt);
    setReceiptVerification(await verifyReceipt(nextReceipt));
    setClaimResult(null);

    if (currentExam) {
      await refreshFinalizedGrade(currentExam, nextReceipt);
    }
  }

  async function handleLoadContext() {
    setLoadingContext(true);
    setClaimResult(null);
    setStatus('Loading public exam metadata, group snapshot, and any stored receipt.');

    try {
      const [examResponse, groupResponse] = await Promise.all([
        fetch(`${apiBaseUrl}/api/public/exams/${examId}`),
        fetch(`${apiBaseUrl}/api/public/exams/${examId}/group`)
      ]);

      if (!examResponse.ok || !groupResponse.ok) {
        throw new Error('Failed to load public claim context');
      }

      const nextExam = (await examResponse.json()) as PublicExamResponse;
      const nextGroup = (await groupResponse.json()) as PublicGroupResponse;
      const storedReceipt = await readStoredValue<SubmissionReceipt>(
        getReceiptStorageKey(nextExam.id, nextExam.examVersion)
      );

      setExam(nextExam);
      setGroup(nextGroup);

      if (storedReceipt) {
        await applyReceipt(storedReceipt, nextExam);
        setStatus(
          `Loaded exam ${nextExam.title} and restored the stored receipt for submission ${storedReceipt.submissionId}.`
        );
      } else {
        setReceipt(null);
        setReceiptVerification(null);
        setFinalizedGrade(null);
        setStatus(
          `Loaded exam ${nextExam.title}. No local receipt was found, so upload the receipt JSON before claiming.`
        );
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to load claim context');
    } finally {
      setLoadingContext(false);
    }
  }

  async function handleUnlockIdentity() {
    try {
      const unlockedIdentity = await unlockStoredIdentity({
        examId,
        passphrase
      });

      if (!unlockedIdentity) {
        setStatus('No encrypted identity is stored for this exam id.');
        return;
      }

      setCommitment(unlockedIdentity.commitment);
      setIdentityExport(unlockedIdentity.exportedIdentity);
      setStatus('Local Semaphore identity unlocked for claiming.');
    } catch {
      setStatus('Failed to unlock the stored identity with the provided passphrase.');
    }
  }

  async function handleReceiptUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      const uploadedReceipt = JSON.parse(await file.text()) as SubmissionReceipt;

      await applyReceipt(uploadedReceipt, exam);
      setStatus(
        `Receipt ${uploadedReceipt.submissionId} loaded${exam ? ' and checked against the current exam.' : '.'}`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to load receipt JSON');
    }
  }

  async function handleClaim() {
    if (!exam || !group || !receipt || !exam.questionSetHash) {
      setStatus('Load a finalized/claiming exam and a matching receipt first.');
      return;
    }

    if (!identityExport || !commitment || !studentId.trim()) {
      setStatus('Unlock the local identity and enter the original student id first.');
      return;
    }

    if (exam.status !== 'CLAIMING') {
      setStatus(`Claims are not open yet. Current exam status: ${exam.status}.`);
      return;
    }

    setClaiming(true);
    setStatus('Rebuilding the Semaphore proof and submitting the grade claim.');

    try {
      const message = await computeSubmissionMessage({
        answerCommitment: receipt.answerCommitment,
        encryptedBlobHash: receipt.encryptedBlobHash,
        examId: exam.id,
        examVersion: exam.examVersion,
        questionSetHash: exam.questionSetHash
      });
      const proof = await generateClaimProof({
        identityExport,
        memberCommitments: group.memberCommitments,
        message,
        scope: exam.submitScope
      });
      const response = await fetch(`${apiBaseUrl}/api/student/exams/${exam.id}/claims`, {
        body: JSON.stringify({
          identityCommitment: commitment,
          message,
          proof,
          scope: exam.submitScope,
          submissionId: receipt.submissionId
        }),
        headers: {
          'content-type': 'application/json',
          'x-student-id': studentId.trim()
        },
        method: 'POST'
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const nextClaimResult = (await response.json()) as ClaimResult;

      setClaimResult(nextClaimResult);
      setStatus(
        `Grade claimed successfully. Claim id ${nextClaimResult.claimId} now links the anonymous submission back to the student account.`
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to claim grade');
    } finally {
      setClaiming(false);
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Student Claim</p>
        <h1>Reconnect the finalized grade only after anonymous assessment ends.</h1>
        <p className="lede">
          This page reuses the local Semaphore identity and the stored receipt to prove
          that the same anonymous submitter is now claiming the published result.
        </p>
        <p className="helper-copy">
          If the browser-local wallet is gone, the current release requires an
          exported encrypted backup. Claim recovery without a backup is not yet
          supported.
        </p>
      </section>

      <section className="card form-card">
        <div className="split-grid">
          <label className="field">
            <span>Exam ID</span>
            <input value={examId} onChange={(event) => setExamId(event.target.value)} />
          </label>
          <label className="field">
            <span>Student ID</span>
            <input
              value={studentId}
              onChange={(event) => setStudentId(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Wallet Passphrase</span>
            <input
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Receipt JSON</span>
            <input
              type="file"
              accept="application/json"
              onChange={(event) => {
                void handleReceiptUpload(event);
              }}
            />
          </label>
        </div>

        <div className="actions">
          <button
            type="button"
            onClick={() => {
              void handleLoadContext();
            }}
            disabled={loadingContext}
          >
            {loadingContext ? 'Loading…' : 'Load Claim Context'}
          </button>
          <button
            type="button"
            onClick={() => {
              void handleUnlockIdentity();
            }}
          >
            Unlock Identity
          </button>
          <button
            type="button"
            onClick={() => {
              void handleClaim();
            }}
            disabled={claiming}
          >
            {claiming ? 'Claiming…' : 'Claim Finalized Grade'}
          </button>
        </div>

        <p className="status-copy">{status}</p>
        <p className="helper-copy">
          Keep both artifacts until claim is complete: the encrypted wallet backup
          and the submission receipt.
        </p>
        <div className="meta-grid">
          <div>
            <span className="meta-label">Commitment</span>
            <p>{commitment ?? 'Not unlocked yet'}</p>
          </div>
          <div>
            <span className="meta-label">Exam Status</span>
            <p>{exam?.status ?? 'Unknown'}</p>
          </div>
          <div>
            <span className="meta-label">Group Size</span>
            <p>{group?.size ?? 0}</p>
          </div>
          <div>
            <span className="meta-label">Receipt</span>
            <p>{receipt ? receipt.submissionId : 'No receipt loaded yet'}</p>
          </div>
        </div>
      </section>

      {receipt && receiptVerification ? (
        <section className="card">
          <h2>Receipt Check</h2>
          <div className="meta-grid">
            <div>
              <span className="meta-label">Signature</span>
              <p>{receiptVerification.signatureValid ? 'Valid' : 'Invalid'}</p>
            </div>
            <div>
              <span className="meta-label">Merkle Inclusion</span>
              <p>{receiptVerification.merkleProofValid ? 'Valid' : 'Invalid'}</p>
            </div>
            <div>
              <span className="meta-label">Submission ID</span>
              <p>{receipt.submissionId}</p>
            </div>
            <div>
              <span className="meta-label">Nullifier</span>
              <p>{receipt.nullifierHash}</p>
            </div>
          </div>
        </section>
      ) : null}

      {finalizedGrade ? (
        <section className="card">
          <h2>Published Grade</h2>
          <div className="meta-grid">
            <div>
              <span className="meta-label">Final Score</span>
              <p>
                {finalizedGrade.grade.finalScore} / {finalizedGrade.grade.maxScore}
              </p>
            </div>
            <div>
              <span className="meta-label">Objective Score</span>
              <p>{finalizedGrade.grade.objectiveScore}</p>
            </div>
            <div>
              <span className="meta-label">Finalized At</span>
              <p>{finalizedGrade.grade.finalizedAt ?? 'Not finalized yet'}</p>
            </div>
            <div>
              <span className="meta-label">Proof Status</span>
              <p>{finalizedGrade.proofArtifact?.verificationStatus ?? 'Unavailable'}</p>
            </div>
          </div>
        </section>
      ) : null}

      {claimResult ? (
        <section className="card">
          <h2>Claim Result</h2>
          <div className="meta-grid">
            <div>
              <span className="meta-label">Claim ID</span>
              <p>{claimResult.claimId}</p>
            </div>
            <div>
              <span className="meta-label">Claimed Grade</span>
              <p>
                {claimResult.grade.finalScore} / {claimResult.grade.maxScore}
              </p>
            </div>
            <div>
              <span className="meta-label">Grade ID</span>
              <p>{claimResult.grade.gradeId}</p>
            </div>
            <div>
              <span className="meta-label">Commitment</span>
              <p>{claimResult.grade.gradeCommitment}</p>
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
