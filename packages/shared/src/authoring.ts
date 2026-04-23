import type {
  FixedMcqChoice,
  FixedMcqQuestionSet,
  SubjectiveQuestion
} from './fixed-mcq.js';

export type ExamAuthoringImportFormat = 'json' | 'markdown' | 'csv';

export type FixedMcqAnswerKeyMap = Record<string, string>;

export type FixedMcqGradingPolicy = {
  version?: 'proofmark-fixed-mcq-policy-v1';
  allowPartialCredit?: boolean;
  maxScore?: number;
  pointsPerQuestion?: number;
  questionCount?: number;
  subjectiveMarking?: {
    version?: 'proofmark-blind-marking-policy-v1';
    markersPerPart?: number;
    adjudicationDelta?: number;
  };
};

export type ExamAuthoringMetadata = {
  title: string;
  courseId?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
};

export type ExamAuthoringBundle = {
  version: 'proofmark-exam-bundle-v1';
  exam: ExamAuthoringMetadata;
  questionSet: FixedMcqQuestionSet;
  answerKey: FixedMcqAnswerKeyMap;
  gradingPolicy: FixedMcqGradingPolicy;
};

export type QuestionBankMcqEntry = {
  type: 'mcq';
  id: string;
  prompt: string;
  choices: FixedMcqChoice[];
  correctChoiceId: string;
};

export type QuestionBankSubjectiveEntry = {
  type: 'subjective';
  id: string;
  prompt: string;
  rubricHash: string;
  maxScore: number;
};

export type QuestionBankEntryDraft =
  | QuestionBankMcqEntry
  | QuestionBankSubjectiveEntry;

export function createEmptyAuthoringBundle(): ExamAuthoringBundle {
  return {
    answerKey: {},
    exam: {
      title: 'Untitled exam'
    },
    gradingPolicy: {
      pointsPerQuestion: 1
    },
    questionSet: {
      questions: [],
      title: 'Untitled question set',
      version: 'proofmark-fixed-mcq-v1'
    },
    version: 'proofmark-exam-bundle-v1'
  };
}

export function createQuestionBankEntryFromSubjectiveQuestion(
  question: SubjectiveQuestion
): QuestionBankSubjectiveEntry {
  return {
    id: question.id,
    maxScore: question.maxScore,
    prompt: question.prompt,
    rubricHash: question.rubricHash,
    type: 'subjective'
  };
}
