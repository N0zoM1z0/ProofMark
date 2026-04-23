import { expect, test } from '@playwright/test';
import { generateTotpCode } from '../../apps/api/src/admin-auth.service.js';

const adminId = process.env.PROOFMARK_ADMIN_ID ?? 'admin-demo';
const adminMfaSecret =
  process.env.ADMIN_MFA_SECRET ?? 'proofmark-dev-admin-mfa-secret';

test('admin workspace previews imports and persists reusable authoring assets', async ({
  page
}) => {
  test.setTimeout(180_000);
  const templateTitle = `Playwright Admin Template ${crypto.randomUUID().slice(0, 8)}`;
  const markdownImport = `# Playwright Authoring Exam
> courseId: pw-authoring
> startsAt: 2026-05-01T09:00:00Z
> endsAt: 2026-05-01T10:00:00Z

## Instructions
Answer every question.

## MCQ q1
What does a nullifier prevent?
- [a] Replay
- [b] Encryption
Answer: a

## SUBJECTIVE s1
Explain why private receipts improve auditability.
Rubric: sha256:rubric-private-receipts-v1
MaxScore: 10

## Policy
PointsPerQuestion: 1
MarkersPerPart: 2
AdjudicationDelta: 2`;

  await page.goto('/admin');
  await page.getByLabel('Admin ID').fill(adminId);
  await page
    .getByLabel('MFA Code')
    .fill(generateTotpCode(adminMfaSecret));
  await page.getByRole('button', { name: 'Load Workspace' }).click();
  await expect(page.getByText(/Loaded \d+ exam\(s\), \d+ template\(s\), and \d+ bank item\(s\)\./)).toBeVisible({
    timeout: 30_000
  });

  await page.getByLabel('Import Source').fill(markdownImport);
  await page.getByLabel('Format').selectOption('markdown');
  await page.getByRole('button', { name: 'Preview Import' }).click();
  await expect(page.getByText(/Import preview looks valid\./)).toBeVisible({
    timeout: 30_000
  });
  await expect(page.getByText('1 MCQ', { exact: true })).toBeVisible();
  await expect(page.getByText('1 subjective', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Apply Preview To Draft' }).click();
  await expect(page.getByLabel('Exam Title')).toHaveValue('Playwright Authoring Exam');

  await page.getByRole('button', { name: 'Create New Exam' }).click();
  await expect(page.getByText(/Draft persisted as a new exam/)).toBeVisible({
    timeout: 30_000
  });

  await page.getByLabel('Template Title').fill(templateTitle);
  await page.getByLabel('Description').fill('Playwright reusable template');
  await page.getByRole('button', { name: 'Save Current Draft As Template' }).click();
  await expect(page.getByText(`Template "${templateTitle}" saved.`)).toBeVisible({
    timeout: 30_000
  });
  await expect(page.getByRole('heading', { name: templateTitle })).toBeVisible({
    timeout: 30_000
  });

  await page
    .getByRole('button', { name: 'Save To Bank' })
    .first()
    .click();
  await expect(page.getByText(/Saved "What does a nullifier prevent\?/)).toBeVisible({
    timeout: 30_000
  });
});
