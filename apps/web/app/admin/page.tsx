'use client';

import {
  createEmptyAuthoringBundle,
  type ExamAuthoringBundle,
  type ExamAuthoringImportFormat,
  type QuestionBankEntryDraft
} from '@proofmark/shared';
import type { ChangeEvent } from 'react';
import { useMemo, useState } from 'react';

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type AdminExamSummary = {
  courseId: string | null;
  createdAt: string;
  currentGroupRoot: string | null;
  endsAt: string | null;
  id: string;
  questionSetHash: string | null;
  startsAt: string | null;
  status: string;
  title: string;
  updatedAt: string;
};

type ImportPreview = {
  answerKeyCommitment: string;
  answerKeySalt: string;
  bundle: ExamAuthoringBundle;
  gradingPolicyHash: string;
  questionCounts: {
    mcq: number;
    subjective: number;
  };
  questionSetHash: string;
};

type TemplateSummary = {
  courseId: string | null;
  createdAt: string;
  description: string | null;
  gradingPolicyHash: string;
  id: string;
  questionSetHash: string;
  title: string;
  updatedAt: string;
};

type TemplateDetail = {
  bundle: ExamAuthoringBundle;
  description: string | null;
  id: string;
  title: string;
};

type QuestionBankEntry = {
  createdAt: string;
  id: string;
  questionHash: string;
  tags: string[];
  title: string;
  type: 'mcq' | 'subjective';
  updatedAt: string;
  value: QuestionBankEntryDraft;
};

type ExportResponse = {
  bundle: ExamAuthoringBundle;
  downloadFileName: string;
  json: string;
};

type RecoveryRequestSummary = {
  completedAt: string | null;
  identityCommitment: string;
  packageId: string;
  packageStatus: string;
  reason: string | null;
  requestId: string;
  requestedAt: string;
  requestedByCiphertext: string;
  reviewedAt: string | null;
  status: string;
};

const examActionDefinitions = [
  { endpoint: 'commit', label: 'Commit' },
  { endpoint: 'registration', label: 'Registration' },
  { endpoint: 'publish', label: 'Publish' },
  { endpoint: 'open', label: 'Open' },
  { endpoint: 'close', label: 'Close' },
  { endpoint: 'grading', label: 'Grading' },
  { endpoint: 'finalize', label: 'Finalize' },
  { endpoint: 'claiming', label: 'Claiming' }
] as const;

function createDefaultMcqQuestion(id: string) {
  return {
    choices: [
      { id: 'a', label: 'Option A' },
      { id: 'b', label: 'Option B' },
      { id: 'c', label: 'Option C' },
      { id: 'd', label: 'Option D' }
    ],
    id,
    prompt: ''
  };
}

function createDefaultSubjectiveQuestion(id: string) {
  return {
    id,
    maxScore: 10,
    prompt: '',
    rubricHash: `sha256:rubric-${id}`
  };
}

function cloneBundle(bundle: ExamAuthoringBundle): ExamAuthoringBundle {
  return JSON.parse(JSON.stringify(bundle)) as ExamAuthoringBundle;
}

function generateHexSalt(byteLength = 16) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  );
}

function downloadJsonFile(fileName: string, contents: string) {
  const blob = new Blob([contents], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function toLocalDateTimeInput(value: string | null | undefined) {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return adjusted.toISOString().slice(0, 16);
}

function fromLocalDateTimeInput(value: string) {
  if (!value.trim()) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function createQuestionId(prefix: 'q' | 's', existingIds: string[]) {
  let sequence = 1;

  while (existingIds.includes(`${prefix}${sequence}`)) {
    sequence += 1;
  }

  return `${prefix}${sequence}`;
}

function ensureUniqueQuestionId(nextId: string, existingIds: string[]) {
  if (!existingIds.includes(nextId)) {
    return nextId;
  }

  let sequence = 2;

  while (existingIds.includes(`${nextId}-${sequence}`)) {
    sequence += 1;
  }

  return `${nextId}-${sequence}`;
}

async function readUploadedFile(event: ChangeEvent<HTMLInputElement>) {
  const file = event.target.files?.[0];

  if (!file) {
    return null;
  }

  return {
    content: await file.text(),
    name: file.name
  };
}

export default function AdminPage() {
  const [adminId, setAdminId] = useState('admin-demo');
  const [mfaCode, setMfaCode] = useState('');
  const [status, setStatus] = useState(
    'Load the admin workspace, then author from scratch or import a bundle.'
  );
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<ExamAuthoringBundle>(() => {
    const nextBundle = createEmptyAuthoringBundle();

    nextBundle.questionSet.questions.push(createDefaultMcqQuestion('q1'));
    nextBundle.answerKey.q1 = 'a';

    return nextBundle;
  });
  const [answerKeySalt, setAnswerKeySalt] = useState('');
  const [importFormat, setImportFormat] =
    useState<ExamAuthoringImportFormat>('json');
  const [importText, setImportText] = useState('');
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(
    null
  );
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [questionBank, setQuestionBank] = useState<QuestionBankEntry[]>([]);
  const [exams, setExams] = useState<AdminExamSummary[]>([]);
  const [recoveryRequests, setRecoveryRequests] = useState<RecoveryRequestSummary[]>(
    []
  );
  const [selectedExamId, setSelectedExamId] = useState<string | null>(null);
  const [templateTitle, setTemplateTitle] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const selectedExam = useMemo(
    () => exams.find((exam) => exam.id === selectedExamId) ?? null,
    [exams, selectedExamId]
  );

  async function fetchAdminJson<T>(path: string, init?: RequestInit) {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-admin-id': adminId.trim(),
        'x-admin-mfa-code': mfaCode.trim(),
        ...(init?.headers ?? {})
      }
    });
    const text = await response.text();

    if (!response.ok) {
      throw new Error(text);
    }

    return (text ? JSON.parse(text) : null) as T;
  }

  async function loadWorkspace() {
    if (!adminId.trim() || !mfaCode.trim()) {
      setStatus(
        'Admin id and MFA code are required before loading the workspace.'
      );
      return;
    }

    setLoading(true);

    try {
      const [nextExams, nextTemplates, nextQuestionBank] = await Promise.all([
        fetchAdminJson<AdminExamSummary[]>('/api/admin/exams', {
          method: 'GET'
        }),
        fetchAdminJson<TemplateSummary[]>('/api/admin/templates', {
          method: 'GET'
        }),
        fetchAdminJson<QuestionBankEntry[]>('/api/admin/question-bank', {
          method: 'GET'
        })
      ]);

      setExams(nextExams);
      setTemplates(nextTemplates);
      setQuestionBank(nextQuestionBank);
      setStatus(
        `Loaded ${nextExams.length} exam(s), ${nextTemplates.length} template(s), and ${nextQuestionBank.length} bank item(s).`
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : 'Failed to load admin workspace'
      );
    } finally {
      setLoading(false);
    }
  }

  function updateDraft(
    updater: (currentBundle: ExamAuthoringBundle) => ExamAuthoringBundle
  ) {
    setDraft((currentBundle) => updater(cloneBundle(currentBundle)));
  }

  function resetDraft() {
    const nextBundle = createEmptyAuthoringBundle();
    nextBundle.questionSet.questions.push(createDefaultMcqQuestion('q1'));
    nextBundle.answerKey.q1 = 'a';
    setDraft(nextBundle);
    setImportPreview(null);
    setSelectedExamId(null);
    setAnswerKeySalt('');
    setStatus(
      'Draft reset. You can author from scratch or apply a new import preview.'
    );
  }

  function addMcqQuestion() {
    updateDraft((currentBundle) => {
      const existingIds = [
        ...currentBundle.questionSet.questions.map((question) => question.id),
        ...(currentBundle.questionSet.subjectiveQuestions?.map(
          (question) => question.id
        ) ?? [])
      ];
      const nextId = createQuestionId('q', existingIds);
      currentBundle.questionSet.questions.push(
        createDefaultMcqQuestion(nextId)
      );
      currentBundle.answerKey[nextId] = 'a';
      return currentBundle;
    });
  }

  function addSubjectiveQuestion() {
    updateDraft((currentBundle) => {
      const existingIds = [
        ...currentBundle.questionSet.questions.map((question) => question.id),
        ...(currentBundle.questionSet.subjectiveQuestions?.map(
          (question) => question.id
        ) ?? [])
      ];
      const nextId = createQuestionId('s', existingIds);

      currentBundle.questionSet.subjectiveQuestions = [
        ...(currentBundle.questionSet.subjectiveQuestions ?? []),
        createDefaultSubjectiveQuestion(nextId)
      ];
      return currentBundle;
    });
  }

  function insertQuestionBankEntry(entry: QuestionBankEntry) {
    updateDraft((currentBundle) => {
      const existingIds = [
        ...currentBundle.questionSet.questions.map((question) => question.id),
        ...(currentBundle.questionSet.subjectiveQuestions?.map(
          (question) => question.id
        ) ?? [])
      ];

      if (entry.value.type === 'mcq') {
        const nextId = ensureUniqueQuestionId(entry.value.id, existingIds);

        currentBundle.questionSet.questions.push({
          choices: entry.value.choices,
          id: nextId,
          prompt: entry.value.prompt
        });
        currentBundle.answerKey[nextId] = entry.value.correctChoiceId;
      } else {
        const nextId = ensureUniqueQuestionId(entry.value.id, existingIds);

        currentBundle.questionSet.subjectiveQuestions = [
          ...(currentBundle.questionSet.subjectiveQuestions ?? []),
          {
            id: nextId,
            maxScore: entry.value.maxScore,
            prompt: entry.value.prompt,
            rubricHash: entry.value.rubricHash
          }
        ];
      }

      return currentBundle;
    });
    setStatus(
      `Inserted "${entry.title}" from the question bank into the draft.`
    );
  }

  async function previewImport() {
    if (!importText.trim()) {
      setStatus(
        'Paste JSON/Markdown/CSV content or upload a file before previewing.'
      );
      return;
    }

    setLoading(true);

    try {
      const preview = await fetchAdminJson<ImportPreview>(
        '/api/admin/imports/preview',
        {
          body: JSON.stringify({
            content: importText,
            format: importFormat
          }),
          method: 'POST'
        }
      );

      setImportPreview(preview);
      setStatus(
        `Import preview looks valid. ${preview.questionCounts.mcq} MCQ and ${preview.questionCounts.subjective} subjective question(s) parsed.`
      );
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Import preview failed'
      );
    } finally {
      setLoading(false);
    }
  }

  function applyImportPreview() {
    if (!importPreview) {
      setStatus('Preview an import first.');
      return;
    }

    setDraft(cloneBundle(importPreview.bundle));
    setAnswerKeySalt(importPreview.answerKeySalt);
    setImportPreview(null);
    setSelectedExamId(null);
    setStatus('Import preview applied to the local draft editor.');
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = await readUploadedFile(event);

    if (!file) {
      return;
    }

    setImportText(file.content);
    setStatus(`Loaded ${file.name} into the import editor.`);
  }

  function exportCurrentDraft() {
    downloadJsonFile(
      `${draft.exam.title.trim().replace(/\s+/g, '-').toLowerCase() || 'proofmark-exam'}.json`,
      JSON.stringify(draft, null, 2)
    );
    setStatus('Current draft exported as JSON.');
  }

  async function saveTemplate() {
    setLoading(true);

    try {
      const response = await fetchAdminJson<{ id: string; title: string }>(
        '/api/admin/templates',
        {
          body: JSON.stringify({
            bundle: draft,
            description: templateDescription || null,
            title: templateTitle || draft.exam.title
          }),
          method: 'POST'
        }
      );

      setTemplateTitle('');
      setTemplateDescription('');
      await loadWorkspace();
      setStatus(`Template "${response.title}" saved.`);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Failed to save template'
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadTemplate(templateId: string) {
    setLoading(true);

    try {
      const template = await fetchAdminJson<TemplateDetail>(
        `/api/admin/templates/${templateId}`,
        { method: 'GET' }
      );

      setDraft(cloneBundle(template.bundle));
      setSelectedExamId(null);
      setAnswerKeySalt('');
      setStatus(`Loaded template "${template.title}" into the draft editor.`);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Failed to load template'
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadExamExport(examId: string) {
    setLoading(true);

    try {
      const exported = await fetchAdminJson<ExportResponse>(
        `/api/admin/exams/${examId}/export`,
        {
          method: 'GET'
        }
      );

      setDraft(cloneBundle(exported.bundle));
      setSelectedExamId(examId);
      setAnswerKeySalt('');
      setStatus(
        `Loaded exam ${examId} into the editor. Draft updates target this exam.`
      );
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Failed to load exam export'
      );
    } finally {
      setLoading(false);
    }
  }

  async function downloadExamExport(examId: string) {
    setLoading(true);

    try {
      const exported = await fetchAdminJson<ExportResponse>(
        `/api/admin/exams/${examId}/export`,
        {
          method: 'GET'
        }
      );

      downloadJsonFile(exported.downloadFileName, exported.json);
      setStatus(`Downloaded ${exported.downloadFileName}.`);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Failed to export exam'
      );
    } finally {
      setLoading(false);
    }
  }

  async function persistDraft(targetExamId?: string | null) {
    if (!draft.exam.title.trim()) {
      setStatus('Exam title is required.');
      return;
    }

    if (!draft.questionSet.title.trim()) {
      setStatus('Question set title is required.');
      return;
    }

    if (!draft.questionSet.questions.length) {
      setStatus('At least one MCQ question is required.');
      return;
    }

    setLoading(true);

    try {
      const startsAt = fromLocalDateTimeInput(draft.exam.startsAt ?? '');
      const endsAt = fromLocalDateTimeInput(draft.exam.endsAt ?? '');
      let examId = targetExamId?.trim() || null;

      if (examId) {
        await fetchAdminJson(`/api/admin/exams/${examId}`, {
          body: JSON.stringify({
            courseId: draft.exam.courseId ?? null,
            endsAt,
            startsAt,
            title: draft.exam.title
          }),
          method: 'PATCH'
        });
      } else {
        const createdExam = await fetchAdminJson<{
          auditEventId: string;
          exam: {
            id: string;
          };
        }>(
          '/api/admin/exams',
          {
            body: JSON.stringify({
              courseId: draft.exam.courseId ?? null,
              endsAt,
              startsAt,
              title: draft.exam.title
            }),
            method: 'POST'
          }
        );

        examId = createdExam.exam.id;
      }

      const salt = answerKeySalt || generateHexSalt();

      await fetchAdminJson(`/api/admin/exams/${examId}/question-set`, {
        body: JSON.stringify({
          questionSet: draft.questionSet
        }),
        method: 'PUT'
      });
      await fetchAdminJson(`/api/admin/exams/${examId}/answer-key-commitment`, {
        body: JSON.stringify({
          answerKey: draft.answerKey,
          salt
        }),
        method: 'PUT'
      });
      await fetchAdminJson(`/api/admin/exams/${examId}/grading-policy`, {
        body: JSON.stringify({
          gradingPolicy: draft.gradingPolicy
        }),
        method: 'PUT'
      });

      setSelectedExamId(examId);
      setAnswerKeySalt(salt);
      await loadWorkspace();
      setStatus(
        targetExamId
          ? `Draft synced into exam ${examId}.`
          : `Draft persisted as a new exam ${examId}.`
      );
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Failed to persist draft'
      );
    } finally {
      setLoading(false);
    }
  }

  async function runExamAction(
    action: (typeof examActionDefinitions)[number]['endpoint']
  ) {
    if (!selectedExamId) {
      setStatus('Select or create an exam first.');
      return;
    }

    setLoading(true);

    try {
      await fetchAdminJson(`/api/admin/exams/${selectedExamId}/${action}`, {
        method: 'POST'
      });
      await loadWorkspace();
      setStatus(`Exam ${selectedExamId} moved through ${action}.`);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : `Failed to run ${action}`
      );
    } finally {
      setLoading(false);
    }
  }

  async function saveQuestionToBank(
    entry: QuestionBankEntryDraft,
    title: string
  ) {
    setLoading(true);

    try {
      await fetchAdminJson('/api/admin/question-bank', {
        body: JSON.stringify({
          entry: {
            tags: [],
            title,
            value: entry
          }
        }),
        method: 'POST'
      });
      await loadWorkspace();
      setStatus(`Saved "${title}" to the reusable question bank.`);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Failed to save question'
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadRecoveryRequests(examId = selectedExamId) {
    if (!examId) {
      setStatus('Select an exam before loading recovery requests.');
      return;
    }

    setLoading(true);

    try {
      const payload = await fetchAdminJson<{
        recoveryRequests: RecoveryRequestSummary[];
      }>(`/api/admin/exams/${examId}/recovery-requests`, {
        method: 'GET'
      });

      setRecoveryRequests(payload.recoveryRequests);
      setStatus(
        `Loaded ${payload.recoveryRequests.length} recovery request(s) for exam ${examId}.`
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : 'Failed to load recovery requests'
      );
    } finally {
      setLoading(false);
    }
  }

  async function reviewRecoveryRequest(requestId: string, action: 'approve' | 'reject') {
    if (!selectedExamId) {
      setStatus('Select an exam before reviewing a recovery request.');
      return;
    }

    setLoading(true);

    try {
      await fetchAdminJson(
        `/api/admin/exams/${selectedExamId}/recovery-requests/${requestId}/${action}`,
        {
          method: 'POST'
        }
      );
      await loadRecoveryRequests(selectedExamId);
      setStatus(`Recovery request ${requestId} ${action}d.`);
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : `Failed to ${action} recovery request`
      );
    } finally {
      setLoading(false);
    }
  }

  const questionIds = [
    ...draft.questionSet.questions.map((question) => question.id),
    ...(draft.questionSet.subjectiveQuestions?.map((question) => question.id) ??
      [])
  ];

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Admin Authoring</p>
        <h1>
          Teacher-facing exam authoring, import, template, and question-bank
          workspace.
        </h1>
        <p className="lede">
          Use this console to build draft exams, preview JSON/Markdown/CSV
          imports, save reusable templates, and pull vetted prompts from the
          shared question bank.
        </p>
      </section>

      <section className="card form-card">
        <h2>Admin Session</h2>
        <div className="split-grid">
          <label className="field">
            <span>Admin ID</span>
            <input
              value={adminId}
              onChange={(event) => setAdminId(event.target.value)}
            />
          </label>
          <label className="field">
            <span>MFA Code</span>
            <input
              value={mfaCode}
              onChange={(event) => setMfaCode(event.target.value)}
            />
          </label>
        </div>
        <p className="helper-copy">
          Local development still uses `pnpm admin:mfa` to produce the 6-digit
          code.
        </p>
        <div className="actions">
          <button
            type="button"
            onClick={() => {
              void loadWorkspace();
            }}
            disabled={loading}
          >
            Load Workspace
          </button>
          <button type="button" onClick={resetDraft} disabled={loading}>
            New Draft
          </button>
        </div>
        <p className="status-copy">{status}</p>
      </section>

      <section className="card stack">
        <div>
          <p className="eyebrow">Import</p>
          <h2>JSON, Markdown, and CSV preview</h2>
          <p className="helper-copy">
            Preview imports before they touch an exam. The API returns
            normalized content, hashes, and an answer-key salt you can reuse
            when persisting the draft.
          </p>
        </div>
        <div className="split-grid">
          <label className="field">
            <span>Format</span>
            <select
              value={importFormat}
              onChange={(event) =>
                setImportFormat(event.target.value as ExamAuthoringImportFormat)
              }
            >
              <option value="json">JSON bundle</option>
              <option value="markdown">Markdown exam sheet</option>
              <option value="csv">CSV spreadsheet</option>
            </select>
          </label>
          <label className="field">
            <span>Upload Source File</span>
            <input
              className="file-input"
              type="file"
              onChange={(event) => {
                void handleImportFile(event);
              }}
            />
          </label>
        </div>
        <label className="field">
          <span>Import Source</span>
          <textarea
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            placeholder="Paste a JSON bundle, Markdown question sheet, or CSV table here."
          />
        </label>
        <div className="actions">
          <button
            type="button"
            onClick={() => {
              void previewImport();
            }}
            disabled={loading}
          >
            Preview Import
          </button>
          <button
            type="button"
            onClick={applyImportPreview}
            disabled={loading || !importPreview}
          >
            Apply Preview To Draft
          </button>
        </div>
        {importPreview ? (
          <div className="library-card">
            <div className="inline-meta">
              <span className="pill">
                {importPreview.questionCounts.mcq} MCQ
              </span>
              <span className="pill neutral">
                {importPreview.questionCounts.subjective} subjective
              </span>
            </div>
            <p>
              <strong>Question set hash:</strong>{' '}
              {importPreview.questionSetHash}
            </p>
            <p>
              <strong>Grading policy hash:</strong>{' '}
              {importPreview.gradingPolicyHash}
            </p>
            <p>
              <strong>Suggested answer-key salt:</strong>{' '}
              {importPreview.answerKeySalt}
            </p>
            <pre className="code-block">
              {JSON.stringify(importPreview.bundle, null, 2)}
            </pre>
          </div>
        ) : null}
        <div className="split-grid">
          <div className="library-card">
            <h3>Markdown Skeleton</h3>
            <pre className="code-block">{`# ZK Midterm
> courseId: zk-101
> startsAt: 2026-05-01T09:00:00Z
> endsAt: 2026-05-01T10:00:00Z

## Instructions
Answer all questions.

## MCQ q1
What does a nullifier prevent?
- [a] Replay
- [b] Encryption
- [c] Compression
Answer: a

## SUBJECTIVE s1
Explain why private receipts improve auditability.
Rubric: sha256:rubric-private-receipts-v1
MaxScore: 10

## Policy
PointsPerQuestion: 1
MarkersPerPart: 2
AdjudicationDelta: 2`}</pre>
          </div>
          <div className="library-card">
            <h3>CSV Skeleton</h3>
            <pre className="code-block">{`# title: ZK Midterm
# course_id: zk-101
# instructions: Answer all questions.
# points_per_question: 1
# markers_per_part: 2
# adjudication_delta: 2
type,id,prompt,choice_a,choice_b,choice_c,choice_d,correct_choice_id,rubric_hash,max_score
mcq,q1,What does a nullifier prevent?,Replay,Encryption,Compression,Audit trail,a,,
subjective,s1,Explain why private receipts improve auditability.,,,,,,sha256:rubric-private-receipts-v1,10`}</pre>
          </div>
        </div>
      </section>

      <section className="card stack">
        <div className="admin-toolbar">
          <div>
            <p className="eyebrow">Draft Builder</p>
            <h2>Author or edit the current exam draft</h2>
          </div>
          {selectedExam ? (
            <span className="pill neutral">
              Selected exam: {selectedExam.title} ({selectedExam.status})
            </span>
          ) : (
            <span className="pill neutral">No existing exam selected</span>
          )}
        </div>

        <div className="split-grid">
          <label className="field">
            <span>Exam Title</span>
            <input
              value={draft.exam.title}
              onChange={(event) =>
                updateDraft((currentBundle) => {
                  currentBundle.exam.title = event.target.value;
                  return currentBundle;
                })
              }
            />
          </label>
          <label className="field">
            <span>Course ID</span>
            <input
              value={draft.exam.courseId ?? ''}
              onChange={(event) =>
                updateDraft((currentBundle) => {
                  currentBundle.exam.courseId = event.target.value || null;
                  return currentBundle;
                })
              }
            />
          </label>
          <label className="field">
            <span>Starts At</span>
            <input
              type="datetime-local"
              value={toLocalDateTimeInput(draft.exam.startsAt)}
              onChange={(event) =>
                updateDraft((currentBundle) => {
                  currentBundle.exam.startsAt = fromLocalDateTimeInput(
                    event.target.value
                  );
                  return currentBundle;
                })
              }
            />
          </label>
          <label className="field">
            <span>Ends At</span>
            <input
              type="datetime-local"
              value={toLocalDateTimeInput(draft.exam.endsAt)}
              onChange={(event) =>
                updateDraft((currentBundle) => {
                  currentBundle.exam.endsAt = fromLocalDateTimeInput(
                    event.target.value
                  );
                  return currentBundle;
                })
              }
            />
          </label>
          <label className="field">
            <span>Question Set Title</span>
            <input
              value={draft.questionSet.title}
              onChange={(event) =>
                updateDraft((currentBundle) => {
                  currentBundle.questionSet.title = event.target.value;
                  return currentBundle;
                })
              }
            />
          </label>
          <label className="field">
            <span>Answer-Key Salt</span>
            <input
              value={answerKeySalt}
              onChange={(event) => setAnswerKeySalt(event.target.value)}
              placeholder="Generated automatically if left blank"
            />
          </label>
        </div>

        <label className="field">
          <span>Instructions</span>
          <textarea
            value={draft.questionSet.instructions ?? ''}
            onChange={(event) =>
              updateDraft((currentBundle) => {
                currentBundle.questionSet.instructions =
                  event.target.value || undefined;
                return currentBundle;
              })
            }
          />
        </label>

        <div className="section-divider stack">
          <div className="admin-toolbar">
            <h3>Objective Questions</h3>
            <button
              type="button"
              className="ghost-button"
              onClick={addMcqQuestion}
            >
              Add MCQ
            </button>
          </div>
          <div className="question-list">
            {draft.questionSet.questions.map((question, questionIndex) => (
              <article key={question.id} className="question-card admin-card">
                <div className="question-header">
                  <span className="question-index">{questionIndex + 1}</span>
                  <div className="stack tight grow">
                    <div className="mini-grid">
                      <label className="field">
                        <span>Question ID</span>
                        <input
                          value={question.id}
                          onChange={(event) =>
                            updateDraft((currentBundle) => {
                              const nextId = event.target.value.trim();
                              const previousId =
                                currentBundle.questionSet.questions[
                                  questionIndex
                                ]!.id;

                              currentBundle.questionSet.questions[
                                questionIndex
                              ]!.id = nextId;
                              currentBundle.answerKey[nextId] =
                                currentBundle.answerKey[previousId] ?? 'a';
                              delete currentBundle.answerKey[previousId];
                              return currentBundle;
                            })
                          }
                        />
                      </label>
                      <label className="field grow">
                        <span>Correct Choice ID</span>
                        <input
                          value={draft.answerKey[question.id] ?? ''}
                          onChange={(event) =>
                            updateDraft((currentBundle) => {
                              currentBundle.answerKey[question.id] =
                                event.target.value;
                              return currentBundle;
                            })
                          }
                        />
                      </label>
                    </div>
                    <label className="field">
                      <span>Prompt</span>
                      <textarea
                        value={question.prompt}
                        onChange={(event) =>
                          updateDraft((currentBundle) => {
                            currentBundle.questionSet.questions[
                              questionIndex
                            ]!.prompt = event.target.value;
                            return currentBundle;
                          })
                        }
                      />
                    </label>
                  </div>
                </div>

                <div className="choice-list">
                  {question.choices.map((choice, choiceIndex) => (
                    <div
                      key={`${question.id}:${choice.id}:${choiceIndex}`}
                      className="choice-row"
                    >
                      <label className="field">
                        <span>Choice ID</span>
                        <input
                          value={choice.id}
                          onChange={(event) =>
                            updateDraft((currentBundle) => {
                              const currentQuestion =
                                currentBundle.questionSet.questions[
                                  questionIndex
                                ]!;
                              const previousChoiceId =
                                currentQuestion.choices[choiceIndex]!.id;
                              currentQuestion.choices[choiceIndex]!.id =
                                event.target.value;

                              if (
                                currentBundle.answerKey[currentQuestion.id] ===
                                previousChoiceId
                              ) {
                                currentBundle.answerKey[currentQuestion.id] =
                                  event.target.value;
                              }

                              return currentBundle;
                            })
                          }
                        />
                      </label>
                      <label className="field grow">
                        <span>Label</span>
                        <input
                          value={choice.label}
                          onChange={(event) =>
                            updateDraft((currentBundle) => {
                              currentBundle.questionSet.questions[
                                questionIndex
                              ]!.choices[choiceIndex]!.label =
                                event.target.value;
                              return currentBundle;
                            })
                          }
                        />
                      </label>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() =>
                          updateDraft((currentBundle) => {
                            currentBundle.questionSet.questions[
                              questionIndex
                            ]!.choices.splice(choiceIndex, 1);
                            return currentBundle;
                          })
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>

                <div className="actions">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() =>
                      updateDraft((currentBundle) => {
                        currentBundle.questionSet.questions[
                          questionIndex
                        ]!.choices.push({
                          id: String.fromCharCode(97 + question.choices.length),
                          label: `Option ${String.fromCharCode(65 + question.choices.length)}`
                        });
                        return currentBundle;
                      })
                    }
                  >
                    Add Choice
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      void saveQuestionToBank(
                        {
                          choices: question.choices,
                          correctChoiceId: draft.answerKey[question.id] ?? '',
                          id: question.id,
                          prompt: question.prompt,
                          type: 'mcq'
                        },
                        question.prompt.slice(0, 72) || question.id
                      );
                    }}
                  >
                    Save To Bank
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() =>
                      updateDraft((currentBundle) => {
                        const removed =
                          currentBundle.questionSet.questions.splice(
                            questionIndex,
                            1
                          )[0];

                        if (removed) {
                          delete currentBundle.answerKey[removed.id];
                        }

                        return currentBundle;
                      })
                    }
                  >
                    Remove Question
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="section-divider stack">
          <div className="admin-toolbar">
            <h3>Subjective Questions</h3>
            <button
              type="button"
              className="ghost-button"
              onClick={addSubjectiveQuestion}
            >
              Add Subjective
            </button>
          </div>
          <div className="question-list">
            {(draft.questionSet.subjectiveQuestions ?? []).map(
              (question, questionIndex) => (
                <article key={question.id} className="question-card admin-card">
                  <div className="mini-grid">
                    <label className="field">
                      <span>Question ID</span>
                      <input
                        value={question.id}
                        onChange={(event) =>
                          updateDraft((currentBundle) => {
                            currentBundle.questionSet.subjectiveQuestions![
                              questionIndex
                            ]!.id = event.target.value;
                            return currentBundle;
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Max Score</span>
                      <input
                        type="number"
                        value={question.maxScore}
                        onChange={(event) =>
                          updateDraft((currentBundle) => {
                            currentBundle.questionSet.subjectiveQuestions![
                              questionIndex
                            ]!.maxScore = Number(event.target.value || '0');
                            return currentBundle;
                          })
                        }
                      />
                    </label>
                    <label className="field grow">
                      <span>Rubric Hash</span>
                      <input
                        value={question.rubricHash}
                        onChange={(event) =>
                          updateDraft((currentBundle) => {
                            currentBundle.questionSet.subjectiveQuestions![
                              questionIndex
                            ]!.rubricHash = event.target.value;
                            return currentBundle;
                          })
                        }
                      />
                    </label>
                  </div>
                  <label className="field">
                    <span>Prompt</span>
                    <textarea
                      value={question.prompt}
                      onChange={(event) =>
                        updateDraft((currentBundle) => {
                          currentBundle.questionSet.subjectiveQuestions![
                            questionIndex
                          ]!.prompt = event.target.value;
                          return currentBundle;
                        })
                      }
                    />
                  </label>
                  <div className="actions">
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        void saveQuestionToBank(
                          {
                            id: question.id,
                            maxScore: question.maxScore,
                            prompt: question.prompt,
                            rubricHash: question.rubricHash,
                            type: 'subjective'
                          },
                          question.prompt.slice(0, 72) || question.id
                        );
                      }}
                    >
                      Save To Bank
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() =>
                        updateDraft((currentBundle) => {
                          currentBundle.questionSet.subjectiveQuestions!.splice(
                            questionIndex,
                            1
                          );
                          return currentBundle;
                        })
                      }
                    >
                      Remove Question
                    </button>
                  </div>
                </article>
              )
            )}
          </div>
        </div>

        <div className="section-divider stack">
          <h3>Grading Policy</h3>
          <div className="split-grid">
            <label className="field">
              <span>Points Per MCQ</span>
              <input
                type="number"
                value={draft.gradingPolicy.pointsPerQuestion ?? 1}
                onChange={(event) =>
                  updateDraft((currentBundle) => {
                    currentBundle.gradingPolicy.pointsPerQuestion = Number(
                      event.target.value || '1'
                    );
                    return currentBundle;
                  })
                }
              />
            </label>
            <label className="field">
              <span>Markers Per Subjective Part</span>
              <input
                type="number"
                value={
                  draft.gradingPolicy.subjectiveMarking?.markersPerPart ?? 2
                }
                onChange={(event) =>
                  updateDraft((currentBundle) => {
                    currentBundle.gradingPolicy.subjectiveMarking = {
                      ...(currentBundle.gradingPolicy.subjectiveMarking ?? {}),
                      markersPerPart: Number(event.target.value || '2')
                    };
                    return currentBundle;
                  })
                }
              />
            </label>
            <label className="field">
              <span>Adjudication Delta</span>
              <input
                type="number"
                value={
                  draft.gradingPolicy.subjectiveMarking?.adjudicationDelta ?? 2
                }
                onChange={(event) =>
                  updateDraft((currentBundle) => {
                    currentBundle.gradingPolicy.subjectiveMarking = {
                      ...(currentBundle.gradingPolicy.subjectiveMarking ?? {}),
                      adjudicationDelta: Number(event.target.value || '2')
                    };
                    return currentBundle;
                  })
                }
              />
            </label>
          </div>
        </div>

        <div className="section-divider stack">
          <h3>Draft Actions</h3>
          <div className="actions">
            <button
              type="button"
              onClick={() => {
                void persistDraft(null);
              }}
              disabled={loading}
            >
              Create New Exam
            </button>
            <button
              type="button"
              onClick={() => {
                void persistDraft(selectedExamId);
              }}
              disabled={
                loading || !selectedExamId || selectedExam?.status !== 'DRAFT'
              }
            >
              Sync Into Selected Draft Exam
            </button>
            <button
              type="button"
              onClick={exportCurrentDraft}
              disabled={loading}
            >
              Export Current Draft JSON
            </button>
          </div>
          <div className="inline-meta">
            <span>{questionIds.length} total question id(s)</span>
            <span>{draft.questionSet.questions.length} objective</span>
            <span>
              {draft.questionSet.subjectiveQuestions?.length ?? 0} subjective
            </span>
          </div>
        </div>
      </section>

      <section className="card stack">
        <div>
          <p className="eyebrow">Templates</p>
          <h2>Reusable authoring assets</h2>
        </div>
        <div className="split-grid">
          <label className="field">
            <span>Template Title</span>
            <input
              value={templateTitle}
              onChange={(event) => setTemplateTitle(event.target.value)}
              placeholder={draft.exam.title}
            />
          </label>
          <label className="field">
            <span>Description</span>
            <input
              value={templateDescription}
              onChange={(event) => setTemplateDescription(event.target.value)}
              placeholder="What this template is for"
            />
          </label>
        </div>
        <div className="actions">
          <button
            type="button"
            onClick={() => {
              void saveTemplate();
            }}
            disabled={loading}
          >
            Save Current Draft As Template
          </button>
        </div>
        <div className="library-grid">
          <div className="library-card">
            <h3>Saved Templates</h3>
            <div className="library-list">
              {templates.length ? (
                templates.map((template) => (
                  <article key={template.id} className="library-card">
                    <h4>{template.title}</h4>
                    <p>{template.description ?? 'No description provided.'}</p>
                    <div className="inline-meta">
                      <span>{template.courseId ?? 'No course id'}</span>
                      <span>
                        {new Date(template.updatedAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="actions">
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => {
                          void loadTemplate(template.id);
                        }}
                      >
                        Load Template
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <p className="helper-copy">No templates saved yet.</p>
              )}
            </div>
          </div>
          <div className="library-card">
            <h3>Question Bank</h3>
            <div className="library-list">
              {questionBank.length ? (
                questionBank.map((entry) => (
                  <article key={entry.id} className="library-card">
                    <div className="inline-meta">
                      <span className="pill">{entry.type}</span>
                      {entry.tags.map((tag) => (
                        <span
                          key={`${entry.id}:${tag}`}
                          className="pill neutral"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                    <h4>{entry.title}</h4>
                    <p>{entry.value.prompt}</p>
                    <div className="actions">
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => insertQuestionBankEntry(entry)}
                      >
                        Insert Into Draft
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <p className="helper-copy">No shared bank items yet.</p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="card stack">
        <div>
          <p className="eyebrow">Exam Library</p>
          <h2>Existing exams and lifecycle actions</h2>
        </div>
        <div className="actions">
          {examActionDefinitions.map((action) => (
            <button
              key={action.endpoint}
              type="button"
              className="ghost-button"
              onClick={() => {
                void runExamAction(action.endpoint);
              }}
              disabled={loading || !selectedExamId}
            >
              {action.label}
            </button>
          ))}
        </div>
        <div className="library-list">
          {exams.length ? (
            exams.map((exam) => (
              <article key={exam.id} className="library-card">
                <div className="inline-meta">
                  <span className="pill">{exam.status}</span>
                  {selectedExamId === exam.id ? (
                    <span className="pill neutral">selected</span>
                  ) : null}
                </div>
                <h3>{exam.title}</h3>
                <p>{exam.courseId ?? 'No course id'}</p>
                <div className="inline-meta">
                  <span>{exam.id}</span>
                  <span>{new Date(exam.updatedAt).toLocaleString()}</span>
                </div>
                <div className="actions">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => setSelectedExamId(exam.id)}
                  >
                    Select
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      void loadExamExport(exam.id);
                    }}
                  >
                    Load Into Draft
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      void downloadExamExport(exam.id);
                    }}
                  >
                    Export JSON
                  </button>
                </div>
              </article>
            ))
          ) : (
            <p className="helper-copy">
              Load the workspace to see current exams.
            </p>
          )}
        </div>
      </section>

      <section className="card stack">
        <div className="admin-toolbar">
          <div>
            <p className="eyebrow">Recovery</p>
            <h2>Wallet recovery request review</h2>
          </div>
          {selectedExam ? (
            <span className="pill neutral">{selectedExam.id}</span>
          ) : (
            <span className="pill neutral">Select an exam first</span>
          )}
        </div>
        <div className="actions">
          <button
            type="button"
            onClick={() => {
              void loadRecoveryRequests();
            }}
            disabled={loading || !selectedExamId}
          >
            Load Recovery Requests
          </button>
        </div>
        <div className="library-list">
          {recoveryRequests.length ? (
            recoveryRequests.map((request) => (
              <article key={request.requestId} className="library-card">
                <div className="inline-meta">
                  <span className="pill">{request.status}</span>
                  <span className="pill neutral">{request.packageStatus}</span>
                </div>
                <h3>{request.requestId}</h3>
                <p>{request.reason ?? 'No student note provided.'}</p>
                <div className="inline-meta">
                  <span>{request.identityCommitment}</span>
                  <span>{request.requestedByCiphertext}</span>
                </div>
                <div className="inline-meta">
                  <span>{request.requestedAt}</span>
                  <span>{request.reviewedAt ?? 'Pending review'}</span>
                </div>
                <div className="actions">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      void reviewRecoveryRequest(request.requestId, 'approve');
                    }}
                    disabled={loading || request.status !== 'REQUESTED'}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      void reviewRecoveryRequest(request.requestId, 'reject');
                    }}
                    disabled={loading || request.status !== 'REQUESTED'}
                  >
                    Reject
                  </button>
                </div>
              </article>
            ))
          ) : (
            <p className="helper-copy">
              Load recovery requests for the selected exam to review wallet
              restores.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
