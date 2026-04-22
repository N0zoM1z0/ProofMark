export const examStatuses = [
  'DRAFT',
  'COMMITTED',
  'REGISTRATION',
  'PUBLISHED',
  'OPEN',
  'CLOSED',
  'ASSIGNING',
  'MARKING',
  'GRADING',
  'FINALIZED',
  'CLAIMING',
  'ARCHIVED'
] as const;

export type ExamStatus = (typeof examStatuses)[number];

export interface ExamTransitionContext {
  hasQuestionSetHash?: boolean;
  hasAnswerKeyCommitment?: boolean;
  hasGradingPolicyHash?: boolean;
  hasCurrentGroupRoot?: boolean;
  hasOpenWindow?: boolean;
  hasSubmissionRoot?: boolean;
  hasAssignments?: boolean;
  hasGradingArtifacts?: boolean;
}

export interface ExamTransitionResult {
  ok: boolean;
  reason?: string;
}

type TransitionRule = {
  from: ExamStatus;
  to: ExamStatus;
  validate?: (context: ExamTransitionContext) => ExamTransitionResult;
};

function ok(): ExamTransitionResult {
  return { ok: true };
}

function fail(reason: string): ExamTransitionResult {
  return { ok: false, reason };
}

function requireFields(
  context: ExamTransitionContext,
  fields: Array<keyof ExamTransitionContext>,
  reason: string
): ExamTransitionResult {
  return fields.every((field) => context[field]) ? ok() : fail(reason);
}

const transitionRules: TransitionRule[] = [
  {
    from: 'DRAFT',
    to: 'COMMITTED',
    validate: (context) =>
      requireFields(
        context,
        [
          'hasQuestionSetHash',
          'hasAnswerKeyCommitment',
          'hasGradingPolicyHash'
        ],
        'COMMITTED requires question set, answer key commitment, and grading policy hashes'
      )
  },
  {
    from: 'COMMITTED',
    to: 'REGISTRATION',
    validate: (context) =>
      requireFields(
        context,
        [
          'hasQuestionSetHash',
          'hasAnswerKeyCommitment',
          'hasGradingPolicyHash'
        ],
        'REGISTRATION requires committed exam configuration'
      )
  },
  {
    from: 'REGISTRATION',
    to: 'PUBLISHED',
    validate: (context) =>
      requireFields(
        context,
        [
          'hasQuestionSetHash',
          'hasAnswerKeyCommitment',
          'hasGradingPolicyHash',
          'hasCurrentGroupRoot'
        ],
        'PUBLISHED requires committed exam configuration and a group root'
      )
  },
  {
    from: 'PUBLISHED',
    to: 'OPEN',
    validate: (context) =>
      requireFields(
        context,
        ['hasCurrentGroupRoot', 'hasOpenWindow'],
        'OPEN requires an eligible group root and a configured submission window'
      )
  },
  { from: 'OPEN', to: 'CLOSED' },
  {
    from: 'CLOSED',
    to: 'ASSIGNING',
    validate: (context) =>
      requireFields(
        context,
        ['hasSubmissionRoot'],
        'ASSIGNING requires a frozen submission root'
      )
  },
  {
    from: 'ASSIGNING',
    to: 'MARKING',
    validate: (context) =>
      requireFields(
        context,
        ['hasAssignments'],
        'MARKING requires deterministic assignment generation'
      )
  },
  { from: 'MARKING', to: 'GRADING' },
  {
    from: 'GRADING',
    to: 'FINALIZED',
    validate: (context) =>
      requireFields(
        context,
        ['hasGradingArtifacts'],
        'FINALIZED requires verified grading artifacts'
      )
  },
  {
    from: 'FINALIZED',
    to: 'CLAIMING',
    validate: (context) =>
      requireFields(
        context,
        ['hasGradingArtifacts'],
        'CLAIMING requires finalized grading artifacts'
      )
  },
  { from: 'CLAIMING', to: 'ARCHIVED' }
];

export function canTransitionExamStatus(
  from: ExamStatus,
  to: ExamStatus,
  context: ExamTransitionContext = {}
): ExamTransitionResult {
  if (from === to) {
    return fail('Transition must move to a new status');
  }

  const rule = transitionRules.find(
    (candidate) => candidate.from === from && candidate.to === to
  );

  if (!rule) {
    return fail(`Transition from ${from} to ${to} is not allowed`);
  }

  return rule.validate ? rule.validate(context) : ok();
}

export function assertExamStatusTransition(
  from: ExamStatus,
  to: ExamStatus,
  context: ExamTransitionContext = {}
) {
  const result = canTransitionExamStatus(from, to, context);

  if (!result.ok) {
    throw new Error(result.reason);
  }
}
