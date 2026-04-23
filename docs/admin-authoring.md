# ProofMark Admin Authoring

This document covers the teacher-facing authoring workflow added on top of the ProofMark core exam engine.

## Purpose

The core API already supported generic exam authoring through low-level admin endpoints. The admin workspace adds a practical layer for:

- building an exam draft in the browser
- previewing JSON, Markdown, or CSV imports before persistence
- saving reusable full-exam templates
- saving reusable individual questions in a shared question bank
- exporting an existing exam bundle back to JSON

The main UI lives at:

- `/admin`

## What The Admin Workspace Can Do

- Create a new exam draft from scratch
- Edit an existing `DRAFT` exam
- Import a normalized exam bundle from `JSON`
- Import a teacher-friendly exam sheet from `Markdown`
- Import a spreadsheet-style question set from `CSV`
- Save the current draft as a reusable template
- Save a single MCQ or subjective question into the shared question bank
- Pull questions from the bank back into a new draft
- Export any existing exam bundle to JSON
- Trigger common lifecycle actions:
  - `commit`
  - `registration`
  - `publish`
  - `open`
  - `close`
  - `grading`
  - `finalize`
  - `claiming`

## Required Admin Inputs

The admin workspace still uses the current local admin auth model:

- `x-admin-id`
- `x-admin-mfa-code`

In local development, generate the MFA code with:

```bash
pnpm admin:mfa
```

Then paste the `adminId` and `mfaCode` into `/admin`.

## Import Formats

## JSON Bundle

This is the canonical portable format:

```json
{
  "version": "proofmark-exam-bundle-v1",
  "exam": {
    "title": "ZK Midterm",
    "courseId": "zk-101",
    "startsAt": "2026-05-01T09:00:00Z",
    "endsAt": "2026-05-01T10:00:00Z"
  },
  "questionSet": {
    "version": "proofmark-fixed-mcq-v1",
    "title": "ZK Midterm",
    "instructions": "Answer all questions.",
    "questions": [
      {
        "id": "q1",
        "prompt": "What does a nullifier prevent?",
        "choices": [
          { "id": "a", "label": "Replay" },
          { "id": "b", "label": "Encryption" }
        ]
      }
    ],
    "subjectiveQuestions": [
      {
        "id": "s1",
        "prompt": "Explain why private receipts improve auditability.",
        "rubricHash": "sha256:rubric-private-receipts-v1",
        "maxScore": 10
      }
    ]
  },
  "answerKey": {
    "q1": "a"
  },
  "gradingPolicy": {
    "pointsPerQuestion": 1,
    "subjectiveMarking": {
      "markersPerPart": 2,
      "adjudicationDelta": 2
    }
  }
}
```

## Markdown Import

Markdown is designed for teachers who prefer authoring in a text editor:

```md
# ZK Midterm

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
AdjudicationDelta: 2
```

Rules:

- Start with `# <exam title>`
- Use `> key: value` metadata lines for exam metadata
- Use `## MCQ <id>` for objective questions
- Use `- [choiceId] Choice label` for choices
- Use `Answer: <choiceId>` for the objective answer key
- Use `## SUBJECTIVE <id>` for subjective questions
- Use `Rubric:` and `MaxScore:` for subjective metadata
- Use `## Policy` for grading policy

## CSV Import

CSV is designed for spreadsheet workflows:

```csv
# title: ZK Midterm
# course_id: zk-101
# instructions: Answer all questions.
# points_per_question: 1
# markers_per_part: 2
# adjudication_delta: 2
type,id,prompt,choice_a,choice_b,choice_c,choice_d,correct_choice_id,rubric_hash,max_score
mcq,q1,What does a nullifier prevent?,Replay,Encryption,Compression,Audit trail,a,,
subjective,s1,Explain why private receipts improve auditability.,,,,,,sha256:rubric-private-receipts-v1,10
```

Rules:

- Metadata lives in `# key: value` lines above the header
- Each data row is one question
- `type` must be `mcq` or `subjective`
- `choice_*` columns define MCQ options
- `correct_choice_id` is required for MCQ rows
- `rubric_hash` and `max_score` are required for subjective rows

## Main UI Flow

1. Open `/admin`
2. Enter the local admin id and MFA code
3. Click `Load Workspace`
4. Choose one path:
   - start from scratch in the draft builder
   - paste/upload JSON, Markdown, or CSV, then `Preview Import`
5. If the preview looks correct, click `Apply Preview To Draft`
6. Adjust:
   - exam title
   - course id
   - start/end times
   - question text
   - choices
   - answer key
   - subjective rubric hash / max score
   - grading policy
7. Optionally:
   - save the whole draft as a template
   - save specific questions to the question bank
8. Click `Create New Exam` to persist the draft
9. If the selected exam remains `DRAFT`, use `Sync Into Selected Draft Exam` for later revisions
10. Move the exam through lifecycle actions when ready

## Question Bank

The question bank is intentionally simple in the current release:

- it stores normalized MCQ or subjective prompts
- it stores the correct choice id for MCQs
- it stores rubric hash and max score for subjective prompts
- it stores optional string tags

Use it when:

- a course reuses core theory questions across terms
- you want a vetted prompt pool for future exams
- you want to mix manually-authored new questions with previously-reviewed items

## Templates

Templates store a full normalized authoring bundle:

- exam metadata
- question set
- answer key
- grading policy

Use templates when:

- the same exam shape repeats every cohort
- you want a standard starter kit for a course
- you want to fork a previous exam without editing the original in place

## Admin APIs Added For Authoring

- `GET /api/admin/exams`
- `GET /api/admin/exams/:examId/export`
- `POST /api/admin/imports/preview`
- `GET /api/admin/templates`
- `GET /api/admin/templates/:templateId`
- `POST /api/admin/templates`
- `GET /api/admin/question-bank`
- `POST /api/admin/question-bank`

These endpoints complement the existing lifecycle endpoints under `/api/admin/exams/...`.
