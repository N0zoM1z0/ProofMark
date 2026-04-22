import { generateTotpCode } from '../../apps/api/src/admin-auth.service.js';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export function getTestRuntimeConfig() {
  return {
    adminId: process.env.PROOFMARK_ADMIN_ID ?? 'admin-demo',
    adminMfaSecret:
      process.env.ADMIN_MFA_SECRET ?? 'proofmark-dev-admin-mfa-secret',
    apiBaseUrl: process.env.PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:3001',
    studentIdPrefix: process.env.PROOFMARK_STUDENT_ID_PREFIX ?? 'student-demo'
  };
}

export function createAdminHeaders() {
  const config = getTestRuntimeConfig();

  return {
    'content-type': 'application/json',
    'x-admin-id': config.adminId,
    'x-admin-mfa-code': generateTotpCode(config.adminMfaSecret)
  };
}

export async function fetchJson<T>(
  path: string,
  init?: Omit<RequestInit, 'headers'> & {
    headers?: Record<string, string>;
  }
) {
  const url = path.startsWith('http') ? path : `${getTestRuntimeConfig().apiBaseUrl}${path}`;
  const response = await fetch(url, init);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }

  return (text ? JSON.parse(text) : null) as T;
}

export async function fetchText(
  path: string,
  init?: Omit<RequestInit, 'headers'> & {
    headers?: Record<string, string>;
  }
) {
  const url = path.startsWith('http') ? path : `${getTestRuntimeConfig().apiBaseUrl}${path}`;
  const response = await fetch(url, init);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }

  return text;
}

export async function waitForApiReady(timeoutMs = 30_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(
        `${getTestRuntimeConfig().apiBaseUrl}/health`
      );

      if (response.ok) {
        return;
      }
    } catch {}

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error('API did not become ready in time');
}

export function createObjectiveQuestionSet(options?: { includeSubjective?: boolean }) {
  return {
    instructions: 'Select the strongest answer and provide one short explanation.',
    questions: [
      {
        choices: [
          { id: 'a', label: '2' },
          { id: 'b', label: '4' },
          { id: 'c', label: '5' }
        ],
        id: 'q1',
        prompt: 'What is 2 + 2?'
      }
    ],
    subjectiveQuestions: options?.includeSubjective === false
      ? undefined
      : [
          {
            id: 's1',
            maxScore: 10,
            prompt: 'Explain why private receipts improve auditability.',
            rubricHash: 'sha256:rubric-s1'
          }
        ],
    title: 'ProofMark Beta Smoke Exam',
    version: 'proofmark-fixed-mcq-v1'
  };
}

export function createObjectiveAnswerKey() {
  return {
    q1: 'b'
  };
}

export function createGradingPolicy(options?: { includeSubjective?: boolean }) {
  const policy = {
    maxScore: 12,
    mode: 'fixed-mcq',
    questionWeights: {
      q1: 2
    },
    version: 'proofmark-fixed-mcq-grading-policy-v1'
  };

  if (options?.includeSubjective === false) {
    return policy;
  }

  return {
    ...policy,
    subjectiveMarking: {
      adjudicationThreshold: 2,
      maxScoreDeviation: 10,
      minimumMarksPerPart: 2
    }
  };
}

export async function createPublishedExam(options?: { includeSubjective?: boolean }) {
  const now = new Date();
  const startsAt = new Date(now.getTime() + 60_000).toISOString();
  const endsAt = new Date(now.getTime() + 3_600_000).toISOString();
  const questionSet = createObjectiveQuestionSet(options);
  const answerKey = createObjectiveAnswerKey();
  const gradingPolicy = createGradingPolicy(options);
  const examCreate = await fetchJson<{
    exam: {
      id: string;
    };
  }>('/api/admin/exams', {
    body: JSON.stringify({
      startsAt,
      endsAt,
      title: `ProofMark Beta ${crypto.randomUUID().slice(0, 8)}`
    }),
    headers: createAdminHeaders(),
    method: 'POST'
  });
  const examId = examCreate.exam.id;

  await fetchJson(`/api/admin/exams/${examId}/question-set`, {
    body: JSON.stringify({
      questionSet
    }),
    headers: createAdminHeaders(),
    method: 'PUT'
  });
  await fetchJson(`/api/admin/exams/${examId}/answer-key-commitment`, {
    body: JSON.stringify({
      answerKey,
      salt: 'salt-proofmark-beta'
    }),
    headers: createAdminHeaders(),
    method: 'PUT'
  });
  await fetchJson(`/api/admin/exams/${examId}/grading-policy`, {
    body: JSON.stringify({
      gradingPolicy
    }),
    headers: createAdminHeaders(),
    method: 'PUT'
  });
  await fetchJson(`/api/admin/exams/${examId}/commit`, {
    headers: createAdminHeaders(),
    method: 'POST'
  });
  await fetchJson(`/api/admin/exams/${examId}/registration`, {
    headers: createAdminHeaders(),
    method: 'POST'
  });

  return {
    answerKey,
    examId,
    gradingPolicy,
    questionSet
  };
}
