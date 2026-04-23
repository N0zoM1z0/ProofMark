import { BadRequestException } from '@nestjs/common';
import {
  normalizeBlindMarkingPolicy,
  normalizeFixedMcqQuestionSet,
  type ExamAuthoringBundle,
  type ExamAuthoringImportFormat,
  type FixedMcqQuestionSet,
  type QuestionBankEntryDraft
} from '@proofmark/shared';

function asObject(value: unknown, fieldName: string) {
  if (Object.prototype.toString.call(value) !== '[object Object]') {
    throw new BadRequestException(`${fieldName} must be an object`);
  }

  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown, fieldName: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException(`${fieldName} must be a non-empty string`);
  }

  return value.trim();
}

function asOptionalString(value: unknown, fieldName: string) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return asNonEmptyString(value, fieldName);
}

function parseFiniteNumber(value: unknown, fieldName: string) {
  const numericValue =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numericValue)) {
    throw new BadRequestException(`${fieldName} must be numeric`);
  }

  return numericValue;
}

export function normalizeFixedMcqAnswerKeyMap(
  questionSet: FixedMcqQuestionSet,
  answerKey: unknown
) {
  const source = asObject(answerKey, 'answerKey');
  const normalizedEntries = questionSet.questions.map((question) => {
    const correctChoiceId = source[question.id];

    if (typeof correctChoiceId !== 'string' || !correctChoiceId.trim()) {
      throw new BadRequestException(
        `answerKey must include a choice id for question ${question.id}`
      );
    }

    if (!question.choices.some((choice) => choice.id === correctChoiceId)) {
      throw new BadRequestException(
        `answerKey.${question.id} must match a published choice id`
      );
    }

    return [question.id, correctChoiceId] as const;
  });

  return Object.fromEntries(normalizedEntries);
}

export function normalizeAuthoringGradingPolicy(
  questionSet: FixedMcqQuestionSet,
  gradingPolicy: unknown
) {
  const source =
    gradingPolicy === undefined ? {} : asObject(gradingPolicy, 'gradingPolicy');
  const pointsPerQuestion =
    typeof source.pointsPerQuestion === 'number' &&
    Number.isFinite(source.pointsPerQuestion)
      ? source.pointsPerQuestion
      : typeof source.pointsPerQuestion === 'string' &&
          source.pointsPerQuestion.trim()
        ? Number(source.pointsPerQuestion)
        : 1;

  if (!Number.isFinite(pointsPerQuestion) || pointsPerQuestion <= 0) {
    throw new BadRequestException(
      'gradingPolicy.pointsPerQuestion must be positive'
    );
  }

  const subjectiveMarking =
    source.subjectiveMarking === undefined
      ? undefined
      : normalizeBlindMarkingPolicy(
          Object.prototype.toString.call(source.subjectiveMarking) ===
            '[object Object]'
            ? {
                adjudicationDelta:
                  (source.subjectiveMarking as Record<string, unknown>)
                    .adjudicationDelta === undefined
                    ? undefined
                    : parseFiniteNumber(
                        (source.subjectiveMarking as Record<string, unknown>)
                          .adjudicationDelta,
                        'gradingPolicy.subjectiveMarking.adjudicationDelta'
                      ),
                markersPerPart:
                  (source.subjectiveMarking as Record<string, unknown>)
                    .markersPerPart === undefined
                    ? undefined
                    : parseFiniteNumber(
                        (source.subjectiveMarking as Record<string, unknown>)
                          .markersPerPart,
                        'gradingPolicy.subjectiveMarking.markersPerPart'
                      )
              }
            : undefined
        );

  return {
    allowPartialCredit: false,
    maxScore: questionSet.questions.length * pointsPerQuestion,
    pointsPerQuestion,
    questionCount: questionSet.questions.length,
    subjectiveMarking,
    version: 'proofmark-fixed-mcq-policy-v1' as const
  };
}

function normalizeExamMetadata(
  metadata: unknown,
  fallbackTitle: string
): ExamAuthoringBundle['exam'] {
  const source =
    metadata === undefined || metadata === null
      ? {}
      : asObject(metadata, 'exam');

  return {
    courseId: asOptionalString(source.courseId, 'exam.courseId'),
    endsAt: asOptionalString(source.endsAt, 'exam.endsAt'),
    startsAt: asOptionalString(source.startsAt, 'exam.startsAt'),
    title: asOptionalString(source.title, 'exam.title') ?? fallbackTitle
  };
}

export function normalizeExamAuthoringBundle(
  input: unknown
): ExamAuthoringBundle {
  const source = asObject(input, 'bundle');
  const questionSet = normalizeFixedMcqQuestionSet(source.questionSet);
  const answerKey = normalizeFixedMcqAnswerKeyMap(
    questionSet,
    source.answerKey
  );
  const gradingPolicy = normalizeAuthoringGradingPolicy(
    questionSet,
    source.gradingPolicy
  );

  return {
    answerKey,
    exam: normalizeExamMetadata(source.exam, questionSet.title),
    gradingPolicy,
    questionSet,
    version: 'proofmark-exam-bundle-v1'
  };
}

function parseMarkdownMetadataLine(line: string) {
  const match = /^>\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+)$/.exec(line.trim());

  if (!match) {
    return null;
  }

  return {
    key: match[1]!.trim().toLowerCase(),
    value: match[2]!.trim()
  };
}

function parsePolicyLine(line: string) {
  const match = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+)$/.exec(line.trim());

  if (!match) {
    return null;
  }

  return {
    key: match[1]!.trim().toLowerCase(),
    value: match[2]!.trim()
  };
}

function trimSectionLines(lines: string[]) {
  return lines.join('\n').trim();
}

function parseMarkdownQuestionBlock(
  heading: string,
  lines: string[]
): QuestionBankEntryDraft {
  const mcqMatch = /^MCQ\s+([A-Za-z0-9._-]+)$/i.exec(heading);

  if (mcqMatch) {
    const promptLines: string[] = [];
    const choices: Array<{ id: string; label: string }> = [];
    let correctChoiceId: string | null = null;

    for (const line of lines) {
      const trimmedLine = line.trim();

      if (!trimmedLine) {
        continue;
      }

      const choiceMatch = /^-\s*\[([A-Za-z0-9._-]+)\]\s+(.+)$/.exec(
        trimmedLine
      );

      if (choiceMatch) {
        choices.push({
          id: choiceMatch[1]!.trim(),
          label: choiceMatch[2]!.trim()
        });
        continue;
      }

      const answerMatch = /^Answer\s*:\s*(.+)$/i.exec(trimmedLine);

      if (answerMatch) {
        correctChoiceId = answerMatch[1]!.trim();
        continue;
      }

      promptLines.push(line);
    }

    if (!correctChoiceId) {
      throw new BadRequestException(
        `Markdown question ${mcqMatch[1]} is missing Answer:`
      );
    }

    return {
      choices,
      correctChoiceId,
      id: mcqMatch[1]!,
      prompt: trimSectionLines(promptLines),
      type: 'mcq'
    };
  }

  const subjectiveMatch = /^(SUBJECTIVE|ESSAY)\s+([A-Za-z0-9._-]+)$/i.exec(
    heading
  );

  if (subjectiveMatch) {
    const promptLines: string[] = [];
    let maxScore: number | null = null;
    let rubricHash: string | null = null;

    for (const line of lines) {
      const trimmedLine = line.trim();

      if (!trimmedLine) {
        continue;
      }

      const rubricMatch = /^Rubric\s*:\s*(.+)$/i.exec(trimmedLine);

      if (rubricMatch) {
        rubricHash = rubricMatch[1]!.trim();
        continue;
      }

      const maxScoreMatch = /^MaxScore\s*:\s*(.+)$/i.exec(trimmedLine);

      if (maxScoreMatch) {
        maxScore = parseFiniteNumber(
          maxScoreMatch[1]!.trim(),
          `subjective ${subjectiveMatch[2]} maxScore`
        );
        continue;
      }

      promptLines.push(line);
    }

    if (!rubricHash) {
      throw new BadRequestException(
        `Markdown subjective question ${subjectiveMatch[2]} is missing Rubric:`
      );
    }

    if (maxScore === null) {
      throw new BadRequestException(
        `Markdown subjective question ${subjectiveMatch[2]} is missing MaxScore:`
      );
    }

    return {
      id: subjectiveMatch[2]!,
      maxScore,
      prompt: trimSectionLines(promptLines),
      rubricHash,
      type: 'subjective'
    };
  }

  throw new BadRequestException(
    `Unsupported markdown section heading "${heading}". Use "MCQ <id>" or "SUBJECTIVE <id>".`
  );
}

export function parseMarkdownAuthoringBundle(
  content: string
): ExamAuthoringBundle {
  const lines = content.replace(/\r/g, '').split('\n');
  const titleLine = lines.find((line) => line.trim().startsWith('# '));

  if (!titleLine) {
    throw new BadRequestException(
      'Markdown import must start with a "# <title>" heading'
    );
  }

  const examTitle = titleLine.trim().slice(2).trim();
  const metadata: Record<string, string> = {};
  const mcqQuestions: FixedMcqQuestionSet['questions'] = [];
  const subjectiveQuestions: FixedMcqQuestionSet['subjectiveQuestions'] = [];
  const answerKey: Record<string, string> = {};
  let instructions = '';
  let policyInput: Record<string, unknown> = {};
  let currentHeading: string | null = null;
  let currentSectionLines: string[] = [];

  const flushSection = () => {
    if (!currentHeading) {
      return;
    }

    if (/^Instructions$/i.test(currentHeading)) {
      instructions = trimSectionLines(currentSectionLines);
    } else if (/^Policy$/i.test(currentHeading)) {
      const nextPolicy: Record<string, unknown> = {};

      for (const line of currentSectionLines) {
        const parsedLine = parsePolicyLine(line);

        if (!parsedLine) {
          continue;
        }

        nextPolicy[parsedLine.key] = parsedLine.value;
      }

      policyInput = nextPolicy;
    } else {
      const question = parseMarkdownQuestionBlock(
        currentHeading,
        currentSectionLines
      );

      if (question.type === 'mcq') {
        mcqQuestions.push({
          choices: question.choices,
          id: question.id,
          prompt: question.prompt
        });
        answerKey[question.id] = question.correctChoiceId;
      } else {
        subjectiveQuestions.push({
          id: question.id,
          maxScore: question.maxScore,
          prompt: question.prompt,
          rubricHash: question.rubricHash
        });
      }
    }

    currentHeading = null;
    currentSectionLines = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.trim().startsWith('# ')) {
      continue;
    }

    const metadataLine = parseMarkdownMetadataLine(line);

    if (metadataLine && !currentHeading) {
      metadata[metadataLine.key] = metadataLine.value;
      continue;
    }

    const sectionMatch = /^##\s+(.+)$/.exec(line.trim());

    if (sectionMatch) {
      flushSection();
      currentHeading = sectionMatch[1]!.trim();
      continue;
    }

    if (currentHeading) {
      currentSectionLines.push(line);
    }
  }

  flushSection();

  return normalizeExamAuthoringBundle({
    answerKey,
    exam: {
      courseId: metadata.courseid ?? metadata.course_id ?? null,
      endsAt: metadata.endsat ?? metadata.ends_at ?? null,
      startsAt: metadata.startsat ?? metadata.starts_at ?? null,
      title: examTitle
    },
    gradingPolicy: {
      pointsPerQuestion:
        policyInput.pointsperquestion ?? policyInput.points_per_question,
      subjectiveMarking:
        policyInput.markersperpart !== undefined ||
        policyInput.markers_per_part !== undefined ||
        policyInput.adjudicationdelta !== undefined ||
        policyInput.adjudication_delta !== undefined
          ? {
              adjudicationDelta:
                policyInput.adjudicationdelta ?? policyInput.adjudication_delta,
              markersPerPart:
                policyInput.markersperpart ?? policyInput.markers_per_part
            }
          : undefined
    },
    questionSet: {
      instructions: instructions || undefined,
      questions: mcqQuestions,
      subjectiveQuestions:
        subjectiveQuestions.length > 0 ? subjectiveQuestions : undefined,
      title:
        metadata.questionsettitle ?? metadata.question_set_title ?? examTitle,
      version: 'proofmark-fixed-mcq-v1'
    }
  });
}

function parseCsvRows(content: string) {
  const rows: string[][] = [];
  let currentCell = '';
  let currentRow: string[] = [];
  let insideQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const currentChar = content[index]!;
    const nextChar = content[index + 1];

    if (currentChar === '"') {
      if (insideQuotes && nextChar === '"') {
        currentCell += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (!insideQuotes && currentChar === ',') {
      currentRow.push(currentCell);
      currentCell = '';
      continue;
    }

    if (!insideQuotes && (currentChar === '\n' || currentChar === '\r')) {
      if (currentChar === '\r' && nextChar === '\n') {
        index += 1;
      }
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentCell = '';
      currentRow = [];
      continue;
    }

    currentCell += currentChar;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return rows.map((row) => row.map((cell) => cell.trim()));
}

export function parseCsvAuthoringBundle(content: string): ExamAuthoringBundle {
  const lines = content.replace(/\r/g, '').split('\n');
  const metadata: Record<string, string> = {};
  const csvLines: string[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      continue;
    }

    const metadataMatch = /^#\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.+)$/.exec(
      trimmedLine
    );

    if (metadataMatch) {
      metadata[metadataMatch[1]!.trim().toLowerCase()] =
        metadataMatch[2]!.trim();
      continue;
    }

    csvLines.push(line);
  }

  const rows = parseCsvRows(csvLines.join('\n'));

  if (rows.length < 2) {
    throw new BadRequestException(
      'CSV import requires a header row and at least one data row'
    );
  }

  const header = rows[0]!.map((cell) => cell.toLowerCase());
  const choiceColumns = header
    .map((columnName, index) => ({
      columnName,
      index
    }))
    .filter((item) => item.columnName.startsWith('choice_'));

  const mcqQuestions: FixedMcqQuestionSet['questions'] = [];
  const subjectiveQuestions: FixedMcqQuestionSet['subjectiveQuestions'] = [];
  const answerKey: Record<string, string> = {};

  for (const row of rows.slice(1)) {
    if (row.every((cell) => !cell)) {
      continue;
    }

    const record = Object.fromEntries(
      header.map((column, index) => [column, row[index] ?? ''])
    );
    const type = record.type?.trim().toLowerCase();
    const id = asNonEmptyString(record.id, 'csv.id');
    const prompt = asNonEmptyString(record.prompt, `csv.prompt for ${id}`);

    if (type === 'mcq') {
      const choices = choiceColumns
        .map(({ columnName, index }) => ({
          id: columnName.slice('choice_'.length),
          label: row[index] ?? ''
        }))
        .filter((choice) => choice.label.trim())
        .map((choice) => ({
          id: choice.id,
          label: choice.label.trim()
        }));

      const correctChoiceId = asNonEmptyString(
        record.correct_choice_id,
        `csv.correct_choice_id for ${id}`
      );

      mcqQuestions.push({
        choices,
        id,
        prompt
      });
      answerKey[id] = correctChoiceId;
      continue;
    }

    if (type === 'subjective') {
      subjectiveQuestions.push({
        id,
        maxScore: parseFiniteNumber(
          record.max_score,
          `csv.max_score for ${id}`
        ),
        prompt,
        rubricHash: asNonEmptyString(
          record.rubric_hash,
          `csv.rubric_hash for ${id}`
        )
      });
      continue;
    }

    throw new BadRequestException(
      `Unsupported csv.type "${record.type}" for ${id}`
    );
  }

  const examTitle = metadata.title ?? metadata.exam_title ?? 'Imported exam';

  return normalizeExamAuthoringBundle({
    answerKey,
    exam: {
      courseId: metadata.course_id ?? metadata.courseid ?? null,
      endsAt: metadata.ends_at ?? metadata.endsat ?? null,
      startsAt: metadata.starts_at ?? metadata.startsat ?? null,
      title: examTitle
    },
    gradingPolicy: {
      pointsPerQuestion:
        metadata.points_per_question ?? metadata.pointsperquestion ?? undefined,
      subjectiveMarking:
        metadata.markers_per_part !== undefined ||
        metadata.markersperpart !== undefined ||
        metadata.adjudication_delta !== undefined ||
        metadata.adjudicationdelta !== undefined
          ? {
              adjudicationDelta:
                metadata.adjudication_delta ?? metadata.adjudicationdelta,
              markersPerPart:
                metadata.markers_per_part ?? metadata.markersperpart
            }
          : undefined
    },
    questionSet: {
      instructions: metadata.instructions ?? undefined,
      questions: mcqQuestions,
      subjectiveQuestions:
        subjectiveQuestions.length > 0 ? subjectiveQuestions : undefined,
      title:
        metadata.question_set_title ?? metadata.questionsettitle ?? examTitle,
      version: 'proofmark-fixed-mcq-v1'
    }
  });
}

export function parseImportBundle(params: {
  content: string;
  format: ExamAuthoringImportFormat;
}) {
  if (params.format === 'json') {
    try {
      return normalizeExamAuthoringBundle(JSON.parse(params.content));
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid JSON import payload'
      );
    }
  }

  if (params.format === 'markdown') {
    return parseMarkdownAuthoringBundle(params.content);
  }

  if (params.format === 'csv') {
    return parseCsvAuthoringBundle(params.content);
  }

  throw new BadRequestException('Unsupported import format');
}

export function serializeBundleAsJson(bundle: ExamAuthoringBundle) {
  return JSON.stringify(bundle, null, 2);
}

export function normalizeQuestionBankEntry(input: unknown): {
  tags: string[];
  title: string;
  value: QuestionBankEntryDraft;
} {
  const source = asObject(input, 'questionBankEntry');
  const value = asObject(source.value, 'questionBankEntry.value');
  const type = asNonEmptyString(
    value.type,
    'questionBankEntry.value.type'
  ).toLowerCase();

  if (type === 'mcq') {
    const question = normalizeFixedMcqQuestionSet({
      questions: [
        {
          choices: value.choices,
          id: value.id,
          prompt: value.prompt
        }
      ],
      title: 'Question bank',
      version: 'proofmark-fixed-mcq-v1'
    }).questions[0]!;
    const correctChoiceId = asNonEmptyString(
      value.correctChoiceId,
      'questionBankEntry.value.correctChoiceId'
    );

    if (!question.choices.some((choice) => choice.id === correctChoiceId)) {
      throw new BadRequestException(
        'questionBankEntry.value.correctChoiceId is invalid'
      );
    }

    return {
      tags: Array.isArray(source.tags)
        ? source.tags
            .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
            .filter(Boolean)
        : [],
      title:
        asOptionalString(source.title, 'questionBankEntry.title') ??
        question.prompt.slice(0, 72),
      value: {
        choices: question.choices,
        correctChoiceId,
        id: question.id,
        prompt: question.prompt,
        type: 'mcq'
      }
    };
  }

  if (type === 'subjective') {
    const normalizedQuestionSet = normalizeFixedMcqQuestionSet({
      questions: [
        {
          choices: [
            { id: 'placeholder-a', label: 'placeholder-a' },
            { id: 'placeholder-b', label: 'placeholder-b' }
          ],
          id: 'placeholder',
          prompt: 'placeholder'
        }
      ],
      subjectiveQuestions: [
        {
          id: value.id,
          maxScore: parseFiniteNumber(
            value.maxScore,
            'questionBankEntry.value.maxScore'
          ),
          prompt: value.prompt,
          rubricHash: value.rubricHash
        }
      ],
      title: 'Question bank',
      version: 'proofmark-fixed-mcq-v1'
    });
    const subjectiveQuestion = normalizedQuestionSet.subjectiveQuestions?.[0];

    if (!subjectiveQuestion) {
      throw new BadRequestException('Failed to normalize subjective question');
    }

    return {
      tags: Array.isArray(source.tags)
        ? source.tags
            .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
            .filter(Boolean)
        : [],
      title:
        asOptionalString(source.title, 'questionBankEntry.title') ??
        subjectiveQuestion.prompt.slice(0, 72),
      value: {
        id: subjectiveQuestion.id,
        maxScore: subjectiveQuestion.maxScore,
        prompt: subjectiveQuestion.prompt,
        rubricHash: subjectiveQuestion.rubricHash,
        type: 'subjective'
      }
    };
  }

  throw new BadRequestException(
    'questionBankEntry.value.type must be mcq or subjective'
  );
}
