import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createFixedMcqAnswerSheet } from '../packages/shared/src/index.js';
import {
  createGroup,
  createIdentity,
  generateSemaphoreMembershipProof,
  getIdentityCommitment
} from '../packages/zk-semaphore/src/index.js';
import {
  computeSubmissionMessage,
  computeSubmitScope,
  createAnswerCommitment,
  encryptSubmissionBlob
} from '../apps/web/app/student/_lib/proofmark-crypto.js';
import {
  createAdminHeaders,
  createPublishedExam,
  fetchJson,
  waitForApiReady
} from './lib/test-helpers.js';

const execFileAsync = promisify(execFile);

async function runWorkerForExam(examId: string) {
  const { stdout } = await execFileAsync(
    'bash',
    [
      '-lc',
      `cd ${process.cwd()} && corepack pnpm exec tsx apps/worker/src/index.ts --exam-id=${examId}`
    ],
    {
      env: process.env
    }
  );

  return JSON.parse(stdout) as {
    gradedCount: number;
  };
}

async function main() {
  await waitForApiReady();
  const userCount = Number.parseInt(process.env.PROOFMARK_LOAD_USERS ?? '6', 10);
  const exam = await createPublishedExam({
    includeSubjective: false
  });
  const identities = Array.from({ length: userCount }, (_, index) => ({
    identity: createIdentity(),
    studentId: `load-student-${index + 1}`
  }));
  const startedAt = Date.now();

  await Promise.all(
    identities.map(({ identity, studentId }) =>
      fetchJson(`/api/student/exams/${exam.examId}/register-commitment`, {
        body: JSON.stringify({
          identityCommitment: getIdentityCommitment(identity)
        }),
        headers: {
          'content-type': 'application/json',
          'x-student-id': studentId
        },
        method: 'POST'
      })
    )
  );

  await fetchJson(`/api/admin/exams/${exam.examId}/publish`, {
    headers: createAdminHeaders(),
    method: 'POST'
  });
  await fetchJson(`/api/admin/exams/${exam.examId}/open`, {
    headers: createAdminHeaders(),
    method: 'POST'
  });

  const publicExam = await fetchJson<{
    encryptionPublicKey: string;
    examVersion: number;
    questionSetHash: string;
  }>(`/api/public/exams/${exam.examId}`);
  const group = await fetchJson<{
    memberCommitments: string[];
  }>(`/api/public/exams/${exam.examId}/group`);

  const submissions = await Promise.all(
    identities.map(async ({ identity }) => {
      const answerSheet = createFixedMcqAnswerSheet({
        answers: {
          q1: 'b'
        },
        examId: exam.examId,
        examVersion: publicExam.examVersion,
        questionSet: exam.questionSet,
        questionSetHash: publicExam.questionSetHash
      });
      const answerSalt = crypto.randomUUID();
      const answerCommitment = await createAnswerCommitment({
        answerSheet,
        salt: answerSalt
      });
      const encryptedBlob = await encryptSubmissionBlob({
        answerSalt,
        answerSheet,
        publicKeyPem: publicExam.encryptionPublicKey
      });
      const presignedUpload = await fetchJson<{
        encryptedBlobUri: string;
        uploadHeaders: Record<string, string>;
        uploadUrl: string;
      }>(`/api/public/exams/${exam.examId}/submissions/presign-upload`, {
        body: JSON.stringify({
          encryptedBlobHash: encryptedBlob.encryptedBlobHash,
          examVersion: publicExam.examVersion
        }),
        headers: {
          'content-type': 'application/json'
        },
        method: 'POST'
      });
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
        examId: exam.examId,
        examVersion: publicExam.examVersion,
        questionSetHash: publicExam.questionSetHash
      });
      const scope = await computeSubmitScope({
        examId: exam.examId,
        examVersion: publicExam.examVersion
      });
      const proof = await generateSemaphoreMembershipProof({
        group: createGroup(group.memberCommitments),
        identity,
        message,
        scope
      });

      return fetchJson<{
        receipt: Record<string, unknown>;
        submissionId: string;
      }>(`/api/public/exams/${exam.examId}/submissions`, {
        body: JSON.stringify({
          answerCommitment: answerCommitment.commitment,
          encryptedBlobHash: encryptedBlob.encryptedBlobHash,
          encryptedBlobUri: presignedUpload.encryptedBlobUri,
          examVersion: publicExam.examVersion,
          groupRoot: proof.merkleTreeRoot,
          message,
          nullifierHash: proof.nullifier,
          proof,
          questionSetHash: publicExam.questionSetHash,
          scope
        }),
        headers: {
          'content-type': 'application/json'
        },
        method: 'POST'
      });
    })
  );

  await fetchJson(`/api/admin/exams/${exam.examId}/close`, {
    headers: createAdminHeaders(),
    method: 'POST'
  });

  const workerResult = await runWorkerForExam(exam.examId);

  await Promise.all(
    submissions.map(({ receipt }) =>
      fetchJson('/api/public/verify-receipt', {
        body: JSON.stringify(receipt),
        headers: {
          'content-type': 'application/json'
        },
        method: 'POST'
      })
    )
  );

  console.log(
    JSON.stringify(
      {
        examId: exam.examId,
        gradedCount: workerResult.gradedCount,
        registeredUsers: identities.length,
        submissionCount: submissions.length,
        totalDurationMs: Date.now() - startedAt
      },
      null,
      2
    )
  );
}

void main();
