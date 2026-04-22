export type FixedMcqChoice = {
  id: string;
  label: string;
};

export type FixedMcqQuestion = {
  id: string;
  prompt: string;
  choices: FixedMcqChoice[];
};

export type SubjectiveQuestion = {
  id: string;
  prompt: string;
  rubricHash: string;
  maxScore: number;
};

export type FixedMcqQuestionSet = {
  version: 'proofmark-fixed-mcq-v1';
  title: string;
  instructions?: string;
  questions: FixedMcqQuestion[];
  subjectiveQuestions?: SubjectiveQuestion[];
};

export type FixedMcqResponse = {
  questionId: string;
  selectedChoiceId: string | null;
};

export type FixedMcqAnswerSheet = {
  version: 'proofmark-answer-sheet-v1';
  examId: string;
  examVersion: number;
  questionSetHash: string;
  responses: FixedMcqResponse[];
  subjectiveResponses?: SubjectiveResponse[];
};

export type SubjectiveResponse = {
  questionId: string;
  responseText: string;
};

function assertNonEmptyString(value: unknown, fieldName: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }

  return value.trim();
}

function assertObject(value: unknown, fieldName: string) {
  if (Object.prototype.toString.call(value) !== '[object Object]') {
    throw new TypeError(`${fieldName} must be an object`);
  }

  return value as Record<string, unknown>;
}

function assertArray(value: unknown, fieldName: string) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an array`);
  }

  return value as unknown[];
}

export function normalizeFixedMcqQuestionSet(
  questionSet: unknown
): FixedMcqQuestionSet {
  const source = assertObject(questionSet, 'questionSet');
  const version = source.version ?? 'proofmark-fixed-mcq-v1';

  if (version !== 'proofmark-fixed-mcq-v1') {
    throw new TypeError('questionSet.version must be proofmark-fixed-mcq-v1');
  }

  const questions = assertArray(source.questions, 'questionSet.questions').map(
    (question, questionIndex) => {
      const normalizedQuestion = assertObject(
        question,
        `questionSet.questions[${questionIndex}]`
      );
      const questionId = assertNonEmptyString(
        normalizedQuestion.id,
        `questionSet.questions[${questionIndex}].id`
      );
      const prompt = assertNonEmptyString(
        normalizedQuestion.prompt,
        `questionSet.questions[${questionIndex}].prompt`
      );
      const choices = assertArray(
        normalizedQuestion.choices,
        `questionSet.questions[${questionIndex}].choices`
      ).map((choice, choiceIndex) => {
        const normalizedChoice = assertObject(
          choice,
          `questionSet.questions[${questionIndex}].choices[${choiceIndex}]`
        );

        return {
          id: assertNonEmptyString(
            normalizedChoice.id,
            `questionSet.questions[${questionIndex}].choices[${choiceIndex}].id`
          ),
          label: assertNonEmptyString(
            normalizedChoice.label,
            `questionSet.questions[${questionIndex}].choices[${choiceIndex}].label`
          )
        };
      });

      if (choices.length < 2) {
        throw new TypeError(
          `questionSet.questions[${questionIndex}] must have at least 2 choices`
        );
      }

      return {
        choices,
        id: questionId,
        prompt
      };
    }
  );
  const subjectiveQuestions =
    source.subjectiveQuestions === undefined
      ? undefined
      : assertArray(
          source.subjectiveQuestions,
          'questionSet.subjectiveQuestions'
        ).map((question, questionIndex) => {
          const normalizedQuestion = assertObject(
            question,
            `questionSet.subjectiveQuestions[${questionIndex}]`
          );
          const maxScore = normalizedQuestion.maxScore;

          if (
            typeof maxScore !== 'number' ||
            !Number.isFinite(maxScore) ||
            maxScore <= 0
          ) {
            throw new TypeError(
              `questionSet.subjectiveQuestions[${questionIndex}].maxScore must be a positive number`
            );
          }

          return {
            id: assertNonEmptyString(
              normalizedQuestion.id,
              `questionSet.subjectiveQuestions[${questionIndex}].id`
            ),
            maxScore,
            prompt: assertNonEmptyString(
              normalizedQuestion.prompt,
              `questionSet.subjectiveQuestions[${questionIndex}].prompt`
            ),
            rubricHash: assertNonEmptyString(
              normalizedQuestion.rubricHash,
              `questionSet.subjectiveQuestions[${questionIndex}].rubricHash`
            )
          };
        });

  if (questions.length === 0) {
    throw new TypeError('questionSet.questions must contain at least one question');
  }

  const questionIds = new Set<string>();

  for (const question of questions) {
    if (questionIds.has(question.id)) {
      throw new TypeError(`Duplicate question id: ${question.id}`);
    }

    questionIds.add(question.id);
    const choiceIds = new Set<string>();

    for (const choice of question.choices) {
      if (choiceIds.has(choice.id)) {
        throw new TypeError(
          `Duplicate choice id for question ${question.id}: ${choice.id}`
        );
      }

      choiceIds.add(choice.id);
    }
  }
  const subjectiveIds = new Set<string>();

  for (const subjectiveQuestion of subjectiveQuestions ?? []) {
    if (questionIds.has(subjectiveQuestion.id) || subjectiveIds.has(subjectiveQuestion.id)) {
      throw new TypeError(`Duplicate question id: ${subjectiveQuestion.id}`);
    }

    subjectiveIds.add(subjectiveQuestion.id);
  }

  return {
    instructions:
      source.instructions === undefined
        ? undefined
        : assertNonEmptyString(source.instructions, 'questionSet.instructions'),
    questions,
    subjectiveQuestions,
    title: assertNonEmptyString(source.title, 'questionSet.title'),
    version: 'proofmark-fixed-mcq-v1'
  };
}

export function encodeFixedMcqAnswers(
  questionSet: FixedMcqQuestionSet,
  answers: Record<string, string | null | undefined>
) {
  return questionSet.questions.map((question) => {
    const selectedChoiceId = answers[question.id] ?? null;

    if (
      selectedChoiceId !== null &&
      !question.choices.some((choice) => choice.id === selectedChoiceId)
    ) {
      throw new TypeError(
        `Answer for question ${question.id} must match one of the published choices`
      );
    }

    return {
      questionId: question.id,
      selectedChoiceId
    };
  });
}

export function createFixedMcqAnswerSheet(params: {
  examId: string;
  examVersion: number;
  questionSet: FixedMcqQuestionSet;
  questionSetHash: string;
  answers: Record<string, string | null | undefined>;
  subjectiveAnswers?: Record<string, string | null | undefined>;
}): FixedMcqAnswerSheet {
  const subjectiveResponses =
    params.questionSet.subjectiveQuestions?.map((question) => ({
      questionId: question.id,
      responseText: params.subjectiveAnswers?.[question.id]?.trim() ?? ''
    })) ?? undefined;

  return {
    examId: params.examId,
    examVersion: params.examVersion,
    questionSetHash: params.questionSetHash,
    responses: encodeFixedMcqAnswers(params.questionSet, params.answers),
    subjectiveResponses:
      subjectiveResponses && subjectiveResponses.length > 0
        ? subjectiveResponses
        : undefined,
    version: 'proofmark-answer-sheet-v1'
  };
}

export function getFixedMcqQuestionCount(questionSet: FixedMcqQuestionSet) {
  return questionSet.questions.length;
}

export function getSubjectiveQuestionCount(questionSet: FixedMcqQuestionSet) {
  return questionSet.subjectiveQuestions?.length ?? 0;
}
