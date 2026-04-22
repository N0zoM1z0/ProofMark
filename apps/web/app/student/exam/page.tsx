'use client';

import { Group } from '@semaphore-protocol/group';
import {
  createFixedMcqAnswerSheet,
  normalizeFixedMcqQuestionSet,
  type FixedMcqQuestionSet
} from '@proofmark/shared';
import {
  createIdentity,
  generateSemaphoreMembershipProof
} from '@proofmark/zk-semaphore';
import { get } from 'idb-keyval';
import { useEffect, useMemo, useState } from 'react';
import {
  computeSubmissionMessage,
  computeSubmitScope,
  createAnswerCommitment,
  downloadJson,
  encryptSubmissionBlob,
  type SubmissionReceipt,
  verifyReceipt
} from '../_lib/proofmark-crypto';
import {
  decryptTextRecord,
  downloadBackup,
  encryptTextRecord,
  getDraftStorageKey,
  getIdentityStorageKey,
  getReceiptStorageKey,
  readStoredValue,
  unlockStoredIdentity,
  writeStoredValue,
  type EncryptedIdentityRecord
} from '../_lib/wallet';

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type PublicExamResponse = {
  currentGroupRoot: string | null;
  encryptionPublicKey: string;
  examVersion: number;
  id: string;
  questionSet: FixedMcqQuestionSet | null;
  questionSetHash: string | null;
  startsAt: string | null;
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

type DraftRecord = {
  ciphertext: string;
  iv: string;
  salt: string;
};

type ProofWorkerResponse =
  | {
      ok: true;
      proof: {
        merkleTreeDepth: number;
        merkleTreeRoot: string;
        message: string;
        nullifier: string;
        points: string[];
        scope: string;
      };
    }
  | {
      error: string;
      ok: false;
    };

async function generateProofDirect(params: {
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

async function generateProof(params: {
  identityExport: string;
  memberCommitments: string[];
  message: string;
  scope: string;
}) {
  try {
    const worker = new Worker(new URL('./proof-worker.ts', import.meta.url), {
      type: 'module'
    });

    return await new Promise<{
      merkleTreeDepth: number;
      merkleTreeRoot: string;
      message: string;
      nullifier: string;
      points: string[];
      scope: string;
    }>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<ProofWorkerResponse>) => {
        worker.terminate();

        if (event.data.ok) {
          resolve(event.data.proof);
          return;
        }

        reject(new Error(event.data.error));
      };
      worker.onerror = (event) => {
        worker.terminate();
        reject(
          event.error instanceof Error
            ? event.error
            : new Error('Proof generation crashed')
        );
      };
      worker.postMessage(params);
    });
  } catch {
    return generateProofDirect(params);
  }
}

export default function StudentExamPage() {
  const [examId, setExamId] = useState('demo-exam');
  const [passphrase, setPassphrase] = useState('');
  const [answers, setAnswers] = useState<Record<string, string | null>>({});
  const [subjectiveAnswers, setSubjectiveAnswers] = useState<
    Record<string, string>
  >({});
  const [commitment, setCommitment] = useState<string | null>(null);
  const [exam, setExam] = useState<PublicExamResponse | null>(null);
  const [group, setGroup] = useState<PublicGroupResponse | null>(null);
  const [identityExport, setIdentityExport] = useState<string | null>(null);
  const [loadingExam, setLoadingExam] = useState(false);
  const [status, setStatus] = useState(
    'Load a published/open exam, unlock the local identity, then submit anonymously.'
  );
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<SubmissionReceipt | null>(null);
  const [receiptVerification, setReceiptVerification] = useState<{
    merkleProofValid: boolean;
    signatureValid: boolean;
    verified: boolean;
  } | null>(null);

  const questionSet = useMemo(() => {
    if (!exam?.questionSet) {
      return null;
    }

    return normalizeFixedMcqQuestionSet(exam.questionSet);
  }, [exam?.questionSet]);

  useEffect(() => {
    if (!exam || !passphrase || !identityExport || receipt) {
      return;
    }

    const draftStorageKey = getDraftStorageKey(exam.id, exam.examVersion);

    void (async () => {
      const encryptedDraft = await encryptTextRecord(
        JSON.stringify({
          answers,
          subjectiveAnswers
        }),
        passphrase
      );

      await writeStoredValue<DraftRecord>(draftStorageKey, encryptedDraft);
    })();
  }, [answers, exam, identityExport, passphrase, receipt, subjectiveAnswers]);

  async function restoreLocalState(
    currentExam: PublicExamResponse,
    currentPassphrase: string
  ) {
    const storedReceipt = await readStoredValue<SubmissionReceipt>(
      getReceiptStorageKey(currentExam.id, currentExam.examVersion)
    );

    if (storedReceipt) {
      setReceipt(storedReceipt);
      setReceiptVerification(await verifyReceipt(storedReceipt));
    } else {
      setReceipt(null);
      setReceiptVerification(null);
    }

    const storedDraft = await readStoredValue<DraftRecord>(
      getDraftStorageKey(currentExam.id, currentExam.examVersion)
    );

    if (!storedDraft) {
      return;
    }

    try {
      const decryptedDraft = await decryptTextRecord(storedDraft, currentPassphrase);
      const parsedDraft = JSON.parse(decryptedDraft) as {
        answers?: Record<string, string | null>;
        subjectiveAnswers?: Record<string, string>;
      };

      setAnswers(parsedDraft.answers ?? {});
      setSubjectiveAnswers(parsedDraft.subjectiveAnswers ?? {});
      setStatus('Recovered the last encrypted local draft.');
    } catch {
      setStatus('Draft recovery skipped because the passphrase did not unlock it.');
    }
  }

  async function handleLoadExam() {
    setLoadingExam(true);
    setStatus('Loading public exam metadata, question set, and current group snapshot.');

    try {
      const [examResponse, groupResponse] = await Promise.all([
        fetch(`${apiBaseUrl}/api/public/exams/${examId}`),
        fetch(`${apiBaseUrl}/api/public/exams/${examId}/group`)
      ]);

      if (!examResponse.ok || !groupResponse.ok) {
        throw new Error('Failed to load public exam context');
      }

      const nextExam = (await examResponse.json()) as PublicExamResponse;
      const nextGroup = (await groupResponse.json()) as PublicGroupResponse;

      setExam(nextExam);
      setGroup(nextGroup);
      setStatus(
        `Loaded exam ${nextExam.title} version ${nextExam.examVersion}. Group size: ${nextGroup.size}.`
      );

      if (passphrase) {
        await restoreLocalState(nextExam, passphrase);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to load exam');
    } finally {
      setLoadingExam(false);
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
      setStatus('Local Semaphore identity unlocked.');

      if (exam) {
        await restoreLocalState(exam, passphrase);
      }
    } catch {
      setStatus('Failed to unlock the stored identity with the provided passphrase.');
    }
  }

  async function handleDownloadBackup() {
    const storedRecord = await get<EncryptedIdentityRecord>(getIdentityStorageKey(examId));

    if (!storedRecord) {
      setStatus('No encrypted identity backup is available for this exam id.');
      return;
    }

    downloadBackup(storedRecord);
    setStatus('Encrypted identity backup downloaded.');
  }

  async function handleSubmit() {
    if (!exam || !group || !questionSet || !exam.questionSetHash) {
      setStatus('Load an open exam with a published question set first.');
      return;
    }

    if (!identityExport || !passphrase) {
      setStatus('Unlock the local identity before submitting.');
      return;
    }

    if (receipt) {
      setStatus('This browser already holds a successful local receipt for this exam.');
      return;
    }

    setSubmitting(true);
    setStatus('Encoding answers, encrypting the blob, and generating the membership proof.');

    try {
      const answerSheet = createFixedMcqAnswerSheet({
        answers,
        examId: exam.id,
        examVersion: exam.examVersion,
        questionSet,
        questionSetHash: exam.questionSetHash,
        subjectiveAnswers
      });
      const answerSalt = crypto.randomUUID();
      const answerCommitment = await createAnswerCommitment({
        answerSheet,
        salt: answerSalt
      });
      const encryptedBlob = await encryptSubmissionBlob({
        answerSalt,
        answerSheet,
        publicKeyPem: exam.encryptionPublicKey
      });
      const presignResponse = await fetch(
        `${apiBaseUrl}/api/public/exams/${exam.id}/submissions/presign-upload`,
        {
          body: JSON.stringify({
            encryptedBlobHash: encryptedBlob.encryptedBlobHash,
            examVersion: exam.examVersion
          }),
          headers: {
            'content-type': 'application/json'
          },
          method: 'POST'
        }
      );

      if (!presignResponse.ok) {
        throw new Error(await presignResponse.text());
      }

      const presignedUpload = (await presignResponse.json()) as {
        encryptedBlobUri: string;
        uploadHeaders: Record<string, string>;
        uploadUrl: string;
      };
      const uploadResponse = await fetch(presignedUpload.uploadUrl, {
        body: JSON.stringify(encryptedBlob.payload),
        headers: presignedUpload.uploadHeaders,
        method: 'PUT'
      });

      if (!uploadResponse.ok) {
        throw new Error(await uploadResponse.text());
      }

      const message = await computeSubmissionMessage({
        answerCommitment: answerCommitment.commitment,
        encryptedBlobHash: encryptedBlob.encryptedBlobHash,
        examId: exam.id,
        examVersion: exam.examVersion,
        questionSetHash: exam.questionSetHash
      });
      const scope = await computeSubmitScope({
        examId: exam.id,
        examVersion: exam.examVersion
      });
      const proof = await generateProof({
        identityExport,
        memberCommitments: group.memberCommitments,
        message,
        scope
      });
      const submissionResponse = await fetch(
        `${apiBaseUrl}/api/public/exams/${exam.id}/submissions`,
        {
          body: JSON.stringify({
            answerCommitment: answerCommitment.commitment,
            encryptedBlobHash: encryptedBlob.encryptedBlobHash,
            encryptedBlobUri: presignedUpload.encryptedBlobUri,
            examVersion: exam.examVersion,
            groupRoot: group.groupRoot,
            message,
            nullifierHash: proof.nullifier,
            proof,
            questionSetHash: exam.questionSetHash,
            scope
          }),
          headers: {
            'content-type': 'application/json'
          },
          method: 'POST'
        }
      );

      if (!submissionResponse.ok) {
        throw new Error(await submissionResponse.text());
      }

      const submissionResult = (await submissionResponse.json()) as {
        receipt: SubmissionReceipt;
      };
      const verification = await verifyReceipt(submissionResult.receipt);

      setReceipt(submissionResult.receipt);
      setReceiptVerification(verification);
      await writeStoredValue(
        getReceiptStorageKey(exam.id, exam.examVersion),
        submissionResult.receipt
      );
      setStatus(
        verification.verified
          ? 'Anonymous submission accepted. Receipt verified locally and the answer sheet is now locked.'
          : 'Submission accepted, but local receipt verification failed.'
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Anonymous submission failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Student Exam</p>
        <h1>Anonymous exam-taking with encrypted answers and local receipts.</h1>
        <p className="lede">
          This flow loads the published question set, restores the local wallet,
          encrypts the answer sheet before upload, generates the Semaphore proof
          in a Web Worker, and verifies the signed receipt in the browser.
        </p>
      </section>

      <section className="card form-card">
        <div className="split-grid">
          <label className="field">
            <span>Exam ID</span>
            <input value={examId} onChange={(event) => setExamId(event.target.value)} />
          </label>
          <label className="field">
            <span>Wallet Passphrase</span>
            <input
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
            />
          </label>
        </div>

        <div className="actions">
          <button
            type="button"
            onClick={() => {
              void handleLoadExam();
            }}
            disabled={loadingExam}
          >
            {loadingExam ? 'Loading…' : 'Load Exam'}
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
              void handleDownloadBackup();
            }}
          >
            Export Wallet Backup
          </button>
        </div>

        <p className="status-copy">{status}</p>
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
            <p>{receipt ? 'Stored locally' : 'Not submitted yet'}</p>
          </div>
        </div>
      </section>

      {questionSet ? (
        <section className="card exam-card">
          <div className="exam-header">
            <div>
              <p className="eyebrow">Question Set</p>
              <h2>{questionSet.title}</h2>
            </div>
            <p className="lede compact">
              {questionSet.instructions ??
                'Select one answer per question. Local drafts are encrypted with the wallet passphrase.'}
            </p>
          </div>

          <div className="question-list">
            {questionSet.questions.map((question, index) => (
              <article key={question.id} className="question-card">
                <div className="question-header">
                  <span className="question-index">{index + 1}</span>
                  <h3>{question.prompt}</h3>
                </div>
                <div className="choice-list">
                  {question.choices.map((choice) => (
                    <label key={choice.id} className="choice-row">
                      <input
                        type="radio"
                        name={question.id}
                        checked={answers[question.id] === choice.id}
                        disabled={Boolean(receipt)}
                        onChange={() =>
                          setAnswers((currentAnswers) => ({
                            ...currentAnswers,
                            [question.id]: choice.id
                          }))
                        }
                      />
                      <span>{choice.label}</span>
                    </label>
                  ))}
                  <button
                    type="button"
                    className="ghost-button"
                    disabled={Boolean(receipt)}
                    onClick={() =>
                      setAnswers((currentAnswers) => ({
                        ...currentAnswers,
                        [question.id]: null
                      }))
                    }
                  >
                    Clear selection
                  </button>
                </div>
              </article>
            ))}
          </div>

          {questionSet.subjectiveQuestions?.length ? (
            <div className="question-list">
              {questionSet.subjectiveQuestions.map((question, index) => (
                <article key={question.id} className="question-card">
                  <div className="question-header">
                    <span className="question-index">
                      {questionSet.questions.length + index + 1}
                    </span>
                    <div>
                      <h3>{question.prompt}</h3>
                      <p className="lede compact">
                        Subjective answer. Max score {question.maxScore}. Rubric hash{' '}
                        {question.rubricHash}
                      </p>
                    </div>
                  </div>
                  <label className="field">
                    <span>Blinded response text</span>
                    <textarea
                      className="answer-textarea"
                      value={subjectiveAnswers[question.id] ?? ''}
                      disabled={Boolean(receipt)}
                      onChange={(event) =>
                        setSubjectiveAnswers((currentAnswers) => ({
                          ...currentAnswers,
                          [question.id]: event.target.value
                        }))
                      }
                    />
                  </label>
                </article>
              ))}
            </div>
          ) : null}

          <div className="actions">
            <button
              type="button"
              onClick={() => {
                void handleSubmit();
              }}
              disabled={submitting || Boolean(receipt)}
            >
              {submitting ? 'Submitting…' : 'Submit Anonymously'}
            </button>
            {receipt ? (
              <button
                type="button"
                onClick={() =>
                  downloadJson(`proofmark-receipt-${receipt.submissionId}.json`, receipt)
                }
              >
                Download Receipt
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {receipt ? (
        <section className="card">
          <p className="eyebrow">Receipt</p>
          <h2>Submission locked locally</h2>
          <p className="lede compact">
            The receipt is stored locally for this exam version. You can
            download it now or verify it again on the public receipt page.
          </p>
          <div className="meta-grid">
            <div>
              <span className="meta-label">Submission ID</span>
              <p>{receipt.submissionId}</p>
            </div>
            <div>
              <span className="meta-label">Nullifier</span>
              <p>{receipt.nullifierHash}</p>
            </div>
            <div>
              <span className="meta-label">Signature</span>
              <p>{receiptVerification?.signatureValid ? 'Valid' : 'Invalid'}</p>
            </div>
            <div>
              <span className="meta-label">Merkle Proof</span>
              <p>{receiptVerification?.merkleProofValid ? 'Valid' : 'Invalid'}</p>
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
