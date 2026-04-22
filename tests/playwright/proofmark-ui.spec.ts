import { expect, test } from '@playwright/test';
import {
  createAdminHeaders,
  createPublishedExam,
  waitForApiReady
} from '../../scripts/lib/test-helpers.js';

test('browser wallet registration, anonymous submission, and receipt verification', async ({
  page
}) => {
  test.setTimeout(120_000);
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
});
