import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { sha256Hex } from '../packages/crypto/src/index.js';
import { createFixedMcqAnswerSheet } from '../packages/shared/src/index.js';
import {
  createGroup,
  createIdentity,
  generateSemaphoreMembershipProof,
  getIdentityCommitment
} from '../packages/zk-semaphore/src/index.js';
import {
  canonicalJson,
  computeSubmissionMessage,
  computeSubmitScope,
  createAnswerCommitment,
  encryptSubmissionBlob,
  verifyReceipt
} from '../apps/web/app/student/_lib/proofmark-crypto.js';
import { signMarkerMark } from '../apps/web/app/marker/marker-crypto.js';
import {
  createAdminHeaders,
  createPublishedExam,
  fetchJson,
  getTestRuntimeConfig,
  waitForApiReady
} from './lib/test-helpers.js';

const execFileAsync = promisify(execFile);

type PublicExamResponse = {
  currentGroupRoot: string | null;
  encryptionPublicKey: string;
  examVersion: number;
  id: string;
  questionSet: unknown;
  questionSetHash: string;
  status: string;
  submitScope: string;
};

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

async function assertRejects(
  label: string,
  callback: () => Promise<unknown>,
  expectedText: string
) {
  try {
    await callback();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (!message.includes(expectedText)) {
      throw new Error(`${label} failed with unexpected error: ${message}`);
    }

    return;
  }

  throw new Error(`${label} unexpectedly succeeded`);
}

async function main() {
  await waitForApiReady();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString:
        process.env.DATABASE_URL ??
        'postgresql://proofmark:proofmark@127.0.0.1:55432/proofmark'
    })
  });
  const runtime = getTestRuntimeConfig();
  const examSetup = await createPublishedExam();
  const identity = createIdentity();
  const identityCommitment = getIdentityCommitment(identity);
  const studentId = `${runtime.studentIdPrefix}-${crypto.randomUUID().slice(0, 8)}`;

  try {
    const registration = await fetchJson<{
      groupRoot: string;
      groupSnapshotVersion: number;
      memberIndex: number;
    }>(`/api/student/exams/${examSetup.examId}/register-commitment`, {
      body: JSON.stringify({
        identityCommitment
      }),
      headers: {
        'content-type': 'application/json',
        'x-student-id': studentId
      },
      method: 'POST'
    });

    await fetchJson(`/api/admin/exams/${examSetup.examId}/publish`, {
      headers: createAdminHeaders(),
      method: 'POST'
    });

    const publicExam = await fetchJson<PublicExamResponse>(
      `/api/public/exams/${examSetup.examId}`
    );
    const group = await fetchJson<{
      examVersion: number;
      groupRoot: string;
      memberCommitments: string[];
      size: number;
    }>(`/api/public/exams/${examSetup.examId}/group`);
    const manifest = await fetchJson<{
      manifestHash: string;
      serverSignature: string;
      status: string;
    }>(`/api/public/exams/${examSetup.examId}/manifest`);

    await fetchJson(`/api/admin/exams/${examSetup.examId}/open`, {
      headers: createAdminHeaders(),
      method: 'POST'
    });

    const answerSheet = createFixedMcqAnswerSheet({
      answers: {
        q1: 'b'
      },
      examId: examSetup.examId,
      examVersion: publicExam.examVersion,
      questionSet: examSetup.questionSet,
      questionSetHash: publicExam.questionSetHash,
      subjectiveAnswers: {
        s1: 'Receipts let candidates independently verify that the accepted submission matches the audit trail.'
      }
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
    }>(`/api/public/exams/${examSetup.examId}/submissions/presign-upload`, {
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
      examId: examSetup.examId,
      examVersion: publicExam.examVersion,
      questionSetHash: publicExam.questionSetHash
    });
    const scope = await computeSubmitScope({
      examId: examSetup.examId,
      examVersion: publicExam.examVersion
    });
    const proof = await generateSemaphoreMembershipProof({
      group: createGroup(group.memberCommitments),
      identity,
      message,
      scope
    });
    const submissionResult = await fetchJson<{
      receipt: Record<string, unknown>;
      submissionId: string;
    }>(`/api/public/exams/${examSetup.examId}/submissions`, {
      body: JSON.stringify({
        answerCommitment: answerCommitment.commitment,
        encryptedBlobHash: encryptedBlob.encryptedBlobHash,
        encryptedBlobUri: presignedUpload.encryptedBlobUri,
        examVersion: publicExam.examVersion,
        groupRoot: group.groupRoot,
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
    const receiptVerification = await verifyReceipt(
      submissionResult.receipt as never
    );
    const serverReceiptVerification = await fetchJson<{
      verified: boolean;
    }>('/api/public/verify-receipt', {
      body: JSON.stringify(submissionResult.receipt),
      headers: {
        'content-type': 'application/json'
      },
      method: 'POST'
    });

    await assertRejects(
      'duplicate nullifier submission',
      () =>
        fetchJson(`/api/public/exams/${examSetup.examId}/submissions`, {
          body: JSON.stringify({
            answerCommitment: answerCommitment.commitment,
            encryptedBlobHash: encryptedBlob.encryptedBlobHash,
            encryptedBlobUri: presignedUpload.encryptedBlobUri,
            examVersion: publicExam.examVersion,
            groupRoot: group.groupRoot,
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
      }),
      'NULLIFIER_ALREADY_USED'
    );

    await assertRejects(
      'tampered encrypted blob hash',
      () =>
        fetchJson(`/api/public/exams/${examSetup.examId}/submissions`, {
          body: JSON.stringify({
            answerCommitment: answerCommitment.commitment,
            encryptedBlobHash: 'sha256:deadbeef',
            encryptedBlobUri: presignedUpload.encryptedBlobUri,
            examVersion: publicExam.examVersion,
            groupRoot: group.groupRoot,
            message,
            nullifierHash: `${proof.nullifier}-tampered`,
            proof: {
              ...proof,
              nullifier: `${proof.nullifier}-tampered`
            },
            questionSetHash: publicExam.questionSetHash,
            scope
          }),
          headers: {
            'content-type': 'application/json'
          },
          method: 'POST'
        }),
      'MESSAGE_BINDING_MISMATCH'
    );

    const tamperedReceiptVerification = await fetchJson<{
      verified: boolean;
    }>('/api/public/verify-receipt', {
      body: JSON.stringify({
        ...submissionResult.receipt,
        auditRoot: 'tampered-root'
      }),
      headers: {
        'content-type': 'application/json'
      },
      method: 'POST'
    }).catch((error: Error) => {
      if (!error.message.includes('RECEIPT_RECORD_MISMATCH')) {
        throw error;
      }

      return {
        verified: false
      };
    });

    await fetchJson(`/api/admin/exams/${examSetup.examId}/close`, {
      headers: createAdminHeaders(),
      method: 'POST'
    });

    const markers = [];

    for (const label of ['marker-alpha', 'marker-beta', 'marker-gamma']) {
      markers.push(
        await fetchJson<{
          markerId: string;
          markerPrivateKey: string;
        }>(`/api/admin/exams/${examSetup.examId}/markers`, {
          body: JSON.stringify({
            markerLabel: label
          }),
          headers: createAdminHeaders(),
          method: 'POST'
        })
      );
    }

    const assignmentGeneration = await fetchJson<{
      assignmentRoot: string;
      createdTaskCount: number;
    }>(`/api/admin/exams/${examSetup.examId}/assignments`, {
      body: JSON.stringify({
        dueAt: new Date(Date.now() + 60_000).toISOString(),
        seed: 'proofmark-phase12-seed'
      }),
      headers: createAdminHeaders(),
      method: 'POST'
    });

    const markerTaskLists = await Promise.all(
      markers.map(async (marker) => ({
        marker,
        tasks: await fetchJson<{
          tasks: Array<{
            taskId: string;
          }>;
        }>(`/api/marker/exams/${examSetup.examId}/tasks`, {
          headers: {
            'content-type': 'application/json',
            'x-marker-id': marker.markerId
          },
          method: 'GET'
        })
      }))
    );
    const initiallyAssignedMarkers = markerTaskLists.filter(
      (entry) => entry.tasks.tasks.length > 0
    );

    if (initiallyAssignedMarkers.length < 2) {
      throw new Error('Expected at least two initially assigned markers');
    }

    const firstTaskDetail = await fetchJson<{
      task: {
        markPayloadBase: {
          gradingTaskId: string;
          markerId: string;
          maxScore: number;
          rubricHash: string;
          submissionPartId: string;
        };
        taskId: string;
      };
    }>(`/api/marker/tasks/${initiallyAssignedMarkers[0]!.tasks.tasks[0]!.taskId}`, {
      headers: {
        'content-type': 'application/json',
        'x-marker-id': initiallyAssignedMarkers[0]!.marker.markerId
      },
      method: 'GET'
    });
    const secondTaskDetail = await fetchJson<{
      task: {
        markPayloadBase: {
          gradingTaskId: string;
          markerId: string;
          maxScore: number;
          rubricHash: string;
          submissionPartId: string;
        };
        taskId: string;
      };
    }>(`/api/marker/tasks/${initiallyAssignedMarkers[1]!.tasks.tasks[0]!.taskId}`, {
      headers: {
        'content-type': 'application/json',
        'x-marker-id': initiallyAssignedMarkers[1]!.marker.markerId
      },
      method: 'GET'
    });

    const firstSignedMark = await signMarkerMark({
      comments: 'Strong explanation with clear audit reasoning.',
      gradingTaskId: firstTaskDetail.task.markPayloadBase.gradingTaskId,
      markerId: firstTaskDetail.task.markPayloadBase.markerId,
      maxScore: firstTaskDetail.task.markPayloadBase.maxScore,
      privateKeyPem: initiallyAssignedMarkers[0]!.marker.markerPrivateKey,
      rubricHash: firstTaskDetail.task.markPayloadBase.rubricHash,
      score: 9,
      submissionPartId: firstTaskDetail.task.markPayloadBase.submissionPartId
    });
    const secondSignedMark = await signMarkerMark({
      comments: 'Response is correct but too brief for full credit.',
      gradingTaskId: secondTaskDetail.task.markPayloadBase.gradingTaskId,
      markerId: secondTaskDetail.task.markPayloadBase.markerId,
      maxScore: secondTaskDetail.task.markPayloadBase.maxScore,
      privateKeyPem: initiallyAssignedMarkers[1]!.marker.markerPrivateKey,
      rubricHash: secondTaskDetail.task.markPayloadBase.rubricHash,
      score: 3,
      submissionPartId: secondTaskDetail.task.markPayloadBase.submissionPartId
    });

    await fetchJson(`/api/marker/tasks/${firstTaskDetail.task.taskId}/marks`, {
      body: JSON.stringify({
        comments: 'Strong explanation with clear audit reasoning.',
        score: 9,
        signature: firstSignedMark.signature
      }),
      headers: {
        'content-type': 'application/json',
        'x-marker-id': initiallyAssignedMarkers[0]!.marker.markerId
      },
      method: 'POST'
    });
    await fetchJson(`/api/marker/tasks/${secondTaskDetail.task.taskId}/marks`, {
      body: JSON.stringify({
        comments: 'Response is correct but too brief for full credit.',
        score: 3,
        signature: secondSignedMark.signature
      }),
      headers: {
        'content-type': 'application/json',
        'x-marker-id': initiallyAssignedMarkers[1]!.marker.markerId
      },
      method: 'POST'
    });

    const adjudicationMarker = markers.find(
      (marker) =>
        marker.markerId !== initiallyAssignedMarkers[0]!.marker.markerId &&
        marker.markerId !== initiallyAssignedMarkers[1]!.marker.markerId
    );

    if (!adjudicationMarker) {
      throw new Error('Expected one remaining marker for adjudication');
    }

    const adjudicationTasks = await fetchJson<{
      tasks: Array<{
        taskId: string;
      }>;
    }>(`/api/marker/exams/${examSetup.examId}/tasks`, {
      headers: {
        'content-type': 'application/json',
        'x-marker-id': adjudicationMarker.markerId
      },
      method: 'GET'
    });
    const adjudicationTask = await fetchJson<{
      task: {
        markPayloadBase: {
          gradingTaskId: string;
          markerId: string;
          maxScore: number;
          rubricHash: string;
          submissionPartId: string;
        };
        taskId: string;
      };
    }>(`/api/marker/tasks/${adjudicationTasks.tasks[0]!.taskId}`, {
      headers: {
        'content-type': 'application/json',
        'x-marker-id': adjudicationMarker.markerId
      },
      method: 'GET'
    });
    const adjudicationSignedMark = await signMarkerMark({
      comments: 'Adjudication converges on a mid-range score.',
      gradingTaskId: adjudicationTask.task.markPayloadBase.gradingTaskId,
      markerId: adjudicationTask.task.markPayloadBase.markerId,
      maxScore: adjudicationTask.task.markPayloadBase.maxScore,
      privateKeyPem: adjudicationMarker.markerPrivateKey,
      rubricHash: adjudicationTask.task.markPayloadBase.rubricHash,
      score: 6,
      submissionPartId: adjudicationTask.task.markPayloadBase.submissionPartId
    });

    await fetchJson(`/api/marker/tasks/${adjudicationTask.task.taskId}/marks`, {
      body: JSON.stringify({
        comments: 'Adjudication converges on a mid-range score.',
        score: 6,
        signature: adjudicationSignedMark.signature
      }),
      headers: {
        'content-type': 'application/json',
        'x-marker-id': adjudicationMarker.markerId
      },
      method: 'POST'
    });

    const workerResult = await runWorkerForExam(examSetup.examId);

    await fetchJson(`/api/admin/exams/${examSetup.examId}/finalize`, {
      headers: createAdminHeaders(),
      method: 'POST'
    });
    await fetchJson(`/api/admin/exams/${examSetup.examId}/claiming`, {
      headers: createAdminHeaders(),
      method: 'POST'
    });

    const claimMessage = BigInt(
      `0x${sha256Hex(canonicalJson({ examId: examSetup.examId, purpose: 'claim' }))}`
    ).toString();
    const claimProof = await generateSemaphoreMembershipProof({
      group: createGroup(group.memberCommitments),
      identity,
      message: claimMessage,
      scope
    });
    const claimResult = await fetchJson<{
      claimId: string;
      grade: {
        finalScore: number;
        gradeId: string;
      };
    }>(`/api/student/exams/${examSetup.examId}/claims`, {
      body: JSON.stringify({
        identityCommitment,
        message: claimMessage,
        proof: claimProof,
        scope,
        submissionId: submissionResult.submissionId
      }),
      headers: {
        'content-type': 'application/json',
        'x-student-id': studentId
      },
      method: 'POST'
    });

    const finalizedGrade = await fetchJson<{
      grade: {
        finalScore: number;
        finalizedAt: string;
        gradeId: string;
      };
    }>(
      `/api/public/exams/${examSetup.examId}/submissions/${submissionResult.submissionId}/finalized-grade`
    );
    const auditRoots = await fetchJson<{
      auditRoots: Array<{
        auditRoot: string;
      }>;
    }>(`/api/public/exams/${examSetup.examId}/audit-roots`);
    const proofArtifacts = await fetchJson<{
      proofArtifacts: Array<{
        type: string;
        verificationStatus: string;
      }>;
    }>(`/api/public/exams/${examSetup.examId}/proof-artifacts`);
    const persistedSubmission = await prisma.submission.findUniqueOrThrow({
      where: {
        id: submissionResult.submissionId
      }
    });
    const persistedClaim = await prisma.gradeClaim.findUniqueOrThrow({
      where: {
        examId_submissionId: {
          examId: examSetup.examId,
          submissionId: submissionResult.submissionId
        }
      }
    });
    const registrarLink = await prisma.registrarIdentityLink.findUniqueOrThrow({
      where: {
        examId_identityCommitment: {
          examId: examSetup.examId,
          identityCommitment
        }
      }
    });

    const assertions = {
      anonymousSubmissionAccepted: submissionResult.submissionId.length > 0,
      duplicateSubmissionRejected: true,
      groupRegistrationWorked: registration.memberIndex === 0,
      localReceiptVerified: receiptVerification.verified,
      manifestPublished: Boolean(manifest.serverSignature),
      modifiedEncryptedBlobHashRejected: true,
      noPlainStudentIdInSubmission:
        !JSON.stringify(persistedSubmission).includes(studentId),
      finalCompositionProofVerified:
        proofArtifacts.proofArtifacts.some(
          (artifact) =>
            artifact.type === 'final-grade-composition-proof' &&
            artifact.verificationStatus === 'VERIFIED'
        ),
      objectiveProofVerified:
        proofArtifacts.proofArtifacts.some(
          (artifact) =>
            artifact.type === 'objective-grade-proof' &&
            artifact.verificationStatus === 'VERIFIED'
        ) && workerResult.gradedCount === 1,
      receiptTamperingRejected: tamperedReceiptVerification.verified === false,
      serverReceiptVerified: serverReceiptVerification.verified,
      subjectiveAggregationProofVerified:
        proofArtifacts.proofArtifacts.some(
          (artifact) =>
            artifact.type === 'subjective-aggregation-proof' &&
            artifact.verificationStatus === 'VERIFIED'
        ),
      studentClaimBoundToIdentity:
        claimResult.grade.gradeId === finalizedGrade.grade.gradeId &&
        String(claimResult.grade.finalScore) ===
          String(finalizedGrade.grade.finalScore),
      submissionTablesFreeOfRealIdentityData:
        !JSON.stringify(persistedSubmission).includes(studentId) &&
        persistedClaim.userReferenceCiphertext !== studentId &&
        registrarLink.realUserRefCiphertext !== studentId
    };

    if (Object.values(assertions).some((value) => value !== true)) {
      throw new Error(
        `Smoke assertions failed: ${JSON.stringify({
          assertions,
          claimGrade: claimResult.grade,
          finalizedGrade: finalizedGrade.grade
        })}`
      );
    }

    console.log(
      JSON.stringify(
        {
          adjudicationTaskCount: adjudicationTasks.tasks.length,
          assignmentRoot: assignmentGeneration.assignmentRoot,
          assertions,
          auditRootCount: auditRoots.auditRoots.length,
          claimId: claimResult.claimId,
          examId: examSetup.examId,
          finalizedGradeId: finalizedGrade.grade.gradeId,
          finalizedScore: finalizedGrade.grade.finalScore,
          initialAssignedMarkerCount: initiallyAssignedMarkers.length,
          manifestHash: manifest.manifestHash,
          proofArtifactCount: proofArtifacts.proofArtifacts.length,
          proofArtifactTypes: proofArtifacts.proofArtifacts.map(
            (artifact) => artifact.type
          ),
          receiptVerified: serverReceiptVerification.verified,
          registrationRoot: registration.groupRoot,
          submissionId: submissionResult.submissionId
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
