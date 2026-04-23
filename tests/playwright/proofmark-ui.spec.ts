import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { signMarkerMarkForApi } from '../../scripts/lib/marker-signing.js';
import {
  createAdminHeaders,
  createPublishedExam,
  waitForApiReady
} from '../../scripts/lib/test-helpers.js';

const execFileAsync = promisify(execFile);

async function runWorkerForExam(examId: string) {
  await execFileAsync('bash', ['-lc', `cd ${process.cwd()} && corepack pnpm exec tsx apps/worker/src/index.ts --exam-id=${examId}`], {
    env: process.env
  });
}

test('browser wallet registration, anonymous submission, and receipt verification', async ({
  page
}) => {
  test.setTimeout(180_000);
  await waitForApiReady();
  const exam = await createPublishedExam();
  const studentId = `pw-student-${crypto.randomUUID().slice(0, 8)}`;
  const passphrase = 'playwright-passphrase';

  await page.goto('/student/register');
  await page.getByLabel('Exam ID').fill(exam.examId);
  await page.getByLabel('Mock Student ID').fill(studentId);
  await page.getByLabel('Passphrase').fill(passphrase);
  await page.getByRole('button', { name: 'Create Identity' }).click();
  await expect(
    page.getByText(
      'Identity created locally, encrypted with Web Crypto, and stored in IndexedDB.'
    )
  ).toBeVisible({
    timeout: 30_000
  });
  await page.getByRole('button', { name: 'Register Commitment' }).click();
  await expect(page.getByText(/Commitment registered\./)).toBeVisible({
    timeout: 30_000
  });

  await page.request.post(
    `${process.env.PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:3001'}/api/admin/exams/${exam.examId}/publish`,
    {
      headers: createAdminHeaders()
    }
  );
  await page.request.post(
    `${process.env.PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:3001'}/api/admin/exams/${exam.examId}/open`,
    {
      headers: createAdminHeaders()
    }
  );

  await page.goto('/student/exam');
  await page.getByLabel('Exam ID').fill(exam.examId);
  await page.getByLabel('Wallet Passphrase').fill(passphrase);
  await page.getByRole('button', { name: 'Load Exam' }).click();
  await expect(page.getByText(/Loaded exam/)).toBeVisible({
    timeout: 30_000
  });
  await page.getByRole('button', { name: 'Unlock Identity' }).click();
  await expect(page.getByText('Local Semaphore identity unlocked.')).toBeVisible({
    timeout: 30_000
  });

  const submissionPath = `/api/public/exams/${exam.examId}/submissions`;
  const submissionResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.request().method() === 'POST' &&
      (url.pathname === submissionPath || url.pathname === `${submissionPath}/`)
    );
  });

  await page.getByLabel('4').check();
  await page
    .getByLabel('Blinded response text')
    .fill('Playwright answer: receipts let auditors recompute acceptance.');
  await page.getByRole('button', { name: 'Submit Anonymously' }).click();
  const submissionResponse = await submissionResponsePromise;
  await expect(page.getByText('Submission locked locally')).toBeVisible({
    timeout: 60_000
  });
  const submissionPayload = (await submissionResponse.json()) as {
    receipt: Record<string, unknown>;
  };

  await page.goto('/verify-receipt');
  await page
    .getByLabel('Upload Receipt JSON')
    .setInputFiles({
      buffer: Buffer.from(JSON.stringify(submissionPayload.receipt)),
      mimeType: 'application/json',
      name: 'receipt.json'
    });

  await expect(page.getByText('Receipt verified locally.')).toBeVisible({
    timeout: 30_000
  });

  const apiBaseUrl = process.env.PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:3001';

  await page.request.post(`${apiBaseUrl}/api/admin/exams/${exam.examId}/close`, {
    headers: createAdminHeaders()
  });

  const markerAlphaResponse = await page.request.post(
    `${apiBaseUrl}/api/admin/exams/${exam.examId}/markers`,
    {
      data: {
        markerLabel: 'Playwright Marker Alpha',
        markerRef: 'playwright-marker-alpha'
      },
      headers: createAdminHeaders()
    }
  );
  const markerBetaResponse = await page.request.post(
    `${apiBaseUrl}/api/admin/exams/${exam.examId}/markers`,
    {
      data: {
        markerLabel: 'Playwright Marker Beta',
        markerRef: 'playwright-marker-beta'
      },
      headers: createAdminHeaders()
    }
  );
  const markerAlpha = (await markerAlphaResponse.json()) as {
    markerId: string;
    markerPrivateKey: string;
  };
  const markerBeta = (await markerBetaResponse.json()) as {
    markerId: string;
    markerPrivateKey: string;
  };

  await page.request.post(`${apiBaseUrl}/api/admin/exams/${exam.examId}/assignments`, {
    data: {
      seed: `playwright-seed-${crypto.randomUUID()}`
    },
    headers: createAdminHeaders()
  });

  const markerAlphaTasksResponse = await page.request.get(
    `${apiBaseUrl}/api/marker/exams/${exam.examId}/tasks`,
    {
      headers: {
        'x-marker-id': markerAlpha.markerId
      }
    }
  );
  const markerBetaTasksResponse = await page.request.get(
    `${apiBaseUrl}/api/marker/exams/${exam.examId}/tasks`,
    {
      headers: {
        'x-marker-id': markerBeta.markerId
      }
    }
  );
  const markerAlphaTasks = (await markerAlphaTasksResponse.json()) as {
    tasks: Array<{
      taskId: string;
    }>;
  };
  const markerBetaTasks = (await markerBetaTasksResponse.json()) as {
    tasks: Array<{
      taskId: string;
    }>;
  };

  const markerAlphaTaskDetailResponse = await page.request.get(
    `${apiBaseUrl}/api/marker/tasks/${markerAlphaTasks.tasks[0]!.taskId}`,
    {
      headers: {
        'x-marker-id': markerAlpha.markerId
      }
    }
  );
  const markerBetaTaskDetailResponse = await page.request.get(
    `${apiBaseUrl}/api/marker/tasks/${markerBetaTasks.tasks[0]!.taskId}`,
    {
      headers: {
        'x-marker-id': markerBeta.markerId
      }
    }
  );
  const markerAlphaTaskDetail = (await markerAlphaTaskDetailResponse.json()) as {
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
  };
  const markerBetaTaskDetail = (await markerBetaTaskDetailResponse.json()) as {
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
  };

  const markerAlphaComments =
    'Playwright marker alpha: the answer connects receipts to audit verification with enough clarity.';
  const markerBetaComments =
    'Playwright marker beta: the answer is brief but correctly links receipts to independent verification.';
  const markerAlphaSignature = signMarkerMarkForApi({
    comments: markerAlphaComments,
    gradingTaskId: markerAlphaTaskDetail.task.markPayloadBase.gradingTaskId,
    markerId: markerAlphaTaskDetail.task.markPayloadBase.markerId,
    maxScore: markerAlphaTaskDetail.task.markPayloadBase.maxScore,
    privateKeyPem: markerAlpha.markerPrivateKey,
    rubricHash: markerAlphaTaskDetail.task.markPayloadBase.rubricHash,
    score: 7,
    submissionPartId: markerAlphaTaskDetail.task.markPayloadBase.submissionPartId
  });
  const markerBetaSignature = signMarkerMarkForApi({
    comments: markerBetaComments,
    gradingTaskId: markerBetaTaskDetail.task.markPayloadBase.gradingTaskId,
    markerId: markerBetaTaskDetail.task.markPayloadBase.markerId,
    maxScore: markerBetaTaskDetail.task.markPayloadBase.maxScore,
    privateKeyPem: markerBeta.markerPrivateKey,
    rubricHash: markerBetaTaskDetail.task.markPayloadBase.rubricHash,
    score: 8,
    submissionPartId: markerBetaTaskDetail.task.markPayloadBase.submissionPartId
  });

  await page.request.post(
    `${apiBaseUrl}/api/marker/tasks/${markerAlphaTaskDetail.task.taskId}/marks`,
    {
      data: {
        comments: markerAlphaComments,
        score: 7,
        signature: markerAlphaSignature.signature
      },
      headers: {
        'x-marker-id': markerAlpha.markerId
      }
    }
  );
  await page.request.post(
    `${apiBaseUrl}/api/marker/tasks/${markerBetaTaskDetail.task.taskId}/marks`,
    {
      data: {
        comments: markerBetaComments,
        score: 8,
        signature: markerBetaSignature.signature
      },
      headers: {
        'x-marker-id': markerBeta.markerId
      }
    }
  );

  await runWorkerForExam(exam.examId);

  const examStatusResponse = await page.request.get(
    `${apiBaseUrl}/api/public/exams/${exam.examId}`
  );
  const examStatusPayload = (await examStatusResponse.json()) as {
    status: string;
  };

  if (examStatusPayload.status !== 'GRADING') {
    await page.request.post(`${apiBaseUrl}/api/admin/exams/${exam.examId}/grading`, {
      headers: createAdminHeaders()
    });
  }

  await page.request.post(`${apiBaseUrl}/api/admin/exams/${exam.examId}/finalize`, {
    headers: createAdminHeaders()
  });
  await page.request.post(`${apiBaseUrl}/api/admin/exams/${exam.examId}/claiming`, {
    headers: createAdminHeaders()
  });

  await page.goto('/student/claim');
  await page.getByLabel('Exam ID').fill(exam.examId);
  await page.getByLabel('Student ID').fill(studentId);
  await page.getByLabel('Wallet Passphrase').fill(passphrase);
  await page.getByRole('button', { name: 'Load Claim Context' }).click();
  await expect(page.getByText(/restored the stored receipt/i)).toBeVisible({
    timeout: 30_000
  });
  await page.getByRole('button', { name: 'Unlock Identity' }).click();
  await expect(
    page.getByText('Local Semaphore identity unlocked for claiming.')
  ).toBeVisible({
    timeout: 30_000
  });
  await page.getByRole('button', { name: 'Claim Finalized Grade' }).click();
  await expect(page.getByText(/Grade claimed successfully/)).toBeVisible({
    timeout: 60_000
  });
});
