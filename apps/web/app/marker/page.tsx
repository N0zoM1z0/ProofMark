'use client';

import { useState } from 'react';
import { signMarkerMark } from './marker-crypto';

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type MarkerExam = {
  examId: string;
  examStatus: string;
  pendingTaskCount: number;
  pseudonymLabel: string;
  title: string;
  totalTaskCount: number;
};

type MarkerTaskList = {
  examId: string;
  markerId: string;
  pseudonymLabel: string;
  tasks: Array<{
    dueAt: string | null;
    maxScore: number;
    prompt: string;
    questionId: string;
    rubricHash: string;
    status: string;
    submissionPartStatus: string;
    taskId: string;
  }>;
};

type MarkerTaskDetail = {
  exam: {
    id: string;
    status: string;
    title: string;
  };
  marker: {
    markerId: string;
    pseudonymLabel: string;
  };
  task: {
    dueAt: string | null;
    markPayloadBase: {
      gradingTaskId: string;
      markerId: string;
      maxScore: number;
      rubricHash: string;
      submissionPartId: string;
    };
    prompt: string;
    questionId: string;
    responseText: string;
    status: string;
    submissionPartStatus: string;
    taskId: string;
  };
};

const storagePrefix = 'proofmark:marker-private-key:';

async function fetchJson<T>(path: string, markerId: string, init?: RequestInit) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-marker-id': markerId,
      ...(init?.headers ?? {})
    }
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(text);
  }

  return (text ? JSON.parse(text) : null) as T;
}

export default function MarkerPage() {
  const [markerId, setMarkerId] = useState('');
  const [privateKeyPem, setPrivateKeyPem] = useState('');
  const [status, setStatus] = useState(
    'Paste the marker id and local pseudonym private key, then load blinded tasks.'
  );
  const [exams, setExams] = useState<MarkerExam[]>([]);
  const [tasks, setTasks] = useState<MarkerTaskList | null>(null);
  const [taskDetail, setTaskDetail] = useState<MarkerTaskDetail | null>(null);
  const [score, setScore] = useState('0');
  const [comments, setComments] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function persistPrivateKey() {
    if (!markerId.trim() || !privateKeyPem.trim()) {
      setStatus('Both marker id and private key are required before saving locally.');
      return;
    }

    localStorage.setItem(`${storagePrefix}${markerId.trim()}`, privateKeyPem);
    setStatus('Local pseudonym private key saved in this browser.');
  }

  function restorePrivateKey() {
    if (!markerId.trim()) {
      setStatus('Enter a marker id before loading a stored private key.');
      return;
    }

    const storedKey = localStorage.getItem(`${storagePrefix}${markerId.trim()}`);

    if (!storedKey) {
      setStatus('No stored private key was found for this marker id.');
      return;
    }

    setPrivateKeyPem(storedKey);
    setStatus('Restored the local pseudonym private key for this marker.');
  }

  async function loadExams() {
    if (!markerId.trim()) {
      setStatus('Marker id is required.');
      return;
    }

    try {
      const nextExams = await fetchJson<MarkerExam[]>(
        '/api/marker/exams',
        markerId.trim(),
        { method: 'GET' }
      );

      setExams(nextExams);
      setStatus(`Loaded ${nextExams.length} marker exam context(s).`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to load marker exams');
    }
  }

  async function loadTasks(examId: string) {
    try {
      const nextTasks = await fetchJson<MarkerTaskList>(
        `/api/marker/exams/${examId}/tasks`,
        markerId.trim(),
        { method: 'GET' }
      );

      setTasks(nextTasks);
      setTaskDetail(null);
      setStatus(`Loaded ${nextTasks.tasks.length} blinded task(s) for ${examId}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to load tasks');
    }
  }

  async function openTask(taskId: string) {
    try {
      const nextTaskDetail = await fetchJson<MarkerTaskDetail>(
        `/api/marker/tasks/${taskId}`,
        markerId.trim(),
        { method: 'GET' }
      );

      setTaskDetail(nextTaskDetail);
      setScore(String(nextTaskDetail.task.markPayloadBase.maxScore));
      setComments('');
      setStatus(`Loaded blinded content for task ${taskId}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to load task');
    }
  }

  async function submitMark() {
    if (!taskDetail) {
      setStatus('Load a task before submitting a signed mark.');
      return;
    }

    if (!privateKeyPem.trim()) {
      setStatus('A local pseudonym private key is required for signing.');
      return;
    }

    const numericScore = Number(score);

    if (!Number.isFinite(numericScore)) {
      setStatus('Score must be numeric.');
      return;
    }

    setSubmitting(true);

    try {
      const signedMark = await signMarkerMark({
        comments,
        gradingTaskId: taskDetail.task.markPayloadBase.gradingTaskId,
        markerId: taskDetail.task.markPayloadBase.markerId,
        maxScore: taskDetail.task.markPayloadBase.maxScore,
        privateKeyPem,
        rubricHash: taskDetail.task.markPayloadBase.rubricHash,
        score: numericScore,
        submissionPartId: taskDetail.task.markPayloadBase.submissionPartId
      });
      const submissionResult = await fetchJson<{
        adjudicationRequired: boolean;
        status: string;
      }>(`/api/marker/tasks/${taskDetail.task.taskId}/marks`, markerId.trim(), {
        body: JSON.stringify({
          comments,
          score: numericScore,
          signature: signedMark.signature
        }),
        method: 'POST'
      });

      setStatus(
        submissionResult.adjudicationRequired
          ? 'Signed mark submitted. The part now requires adjudication.'
          : 'Signed mark submitted successfully.'
      );
      await loadTasks(taskDetail.exam.id);
      await openTask(taskDetail.task.taskId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to submit mark');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Marker Console</p>
        <h1>Blind marker console with local pseudonym signing.</h1>
        <p className="lede">
          This console only receives blinded question content and response text. It
          signs the mark payload locally before the API verifies and records it.
        </p>
      </section>

      <section className="card form-card">
        <div className="split-grid">
          <label className="field">
            <span>Marker ID</span>
            <input
              value={markerId}
              onChange={(event) => {
                setMarkerId(event.target.value);
              }}
            />
          </label>
          <label className="field">
            <span>Pseudonym Private Key</span>
            <textarea
              value={privateKeyPem}
              onChange={(event) => {
                setPrivateKeyPem(event.target.value);
              }}
            />
          </label>
        </div>

        <div className="actions">
          <button type="button" onClick={persistPrivateKey}>
            Save Local Key
          </button>
          <button type="button" onClick={restorePrivateKey}>
            Restore Local Key
          </button>
          <button
            type="button"
            onClick={() => {
              void loadExams();
            }}
          >
            Load Marker Exams
          </button>
        </div>

        <p className="status-copy">{status}</p>
      </section>

      {exams.length ? (
        <section className="card">
          <h2>Assigned Exams</h2>
          <div className="timeline-grid">
            {exams.map((exam) => (
              <article key={exam.examId} className="timeline-card">
                <p className="eyebrow">{exam.examStatus}</p>
                <p className="timeline-copy">{exam.title}</p>
                <p className="timeline-copy">
                  Pending {exam.pendingTaskCount} / Total {exam.totalTaskCount}
                </p>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    void loadTasks(exam.examId);
                  }}
                >
                  Load Tasks
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {tasks ? (
        <section className="card">
          <h2>Blinded Tasks</h2>
          <div className="timeline-grid">
            {tasks.tasks.map((task) => (
              <article key={task.taskId} className="timeline-card">
                <p className="eyebrow">
                  {task.status} · {task.submissionPartStatus}
                </p>
                <p className="timeline-copy">{task.prompt}</p>
                <p className="timeline-copy">
                  Max score {task.maxScore} · Rubric {task.rubricHash}
                </p>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    void openTask(task.taskId);
                  }}
                >
                  Open Task
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {taskDetail ? (
        <section className="card form-card">
          <div className="exam-header">
            <div>
              <p className="eyebrow">{taskDetail.marker.pseudonymLabel}</p>
              <h2>{taskDetail.task.prompt}</h2>
            </div>
            <p className="lede compact">
              Question {taskDetail.task.questionId}. Max score{' '}
              {taskDetail.task.markPayloadBase.maxScore}. No candidate identity is
              exposed in this view.
            </p>
          </div>

          <section className="question-card">
            <span className="meta-label">Blinded Response</span>
            <p className="lede compact">{taskDetail.task.responseText || 'No text submitted.'}</p>
          </section>

          <div className="split-grid">
            <label className="field">
              <span>Score</span>
              <input
                value={score}
                onChange={(event) => {
                  setScore(event.target.value);
                }}
              />
            </label>
            <label className="field">
              <span>Comments</span>
              <textarea
                value={comments}
                onChange={(event) => {
                  setComments(event.target.value);
                }}
              />
            </label>
          </div>

          <div className="actions">
            <button
              type="button"
              onClick={() => {
                void submitMark();
              }}
              disabled={submitting}
            >
              {submitting ? 'Submitting…' : 'Sign And Submit Mark'}
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
