import { QuestionBankEntryType } from '@prisma/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { AdminAuthoringService } from '../src/admin-authoring.service.js';

function createPrismaMock() {
  const exams = [
    {
      answerKeyData: { q1: 'a' },
      courseId: 'zk-101',
      endsAt: new Date('2026-05-01T10:00:00Z'),
      gradingPolicyData: {
        pointsPerQuestion: 1
      },
      id: 'exam-1',
      questionSetData: {
        questions: [
          {
            choices: [
              { id: 'a', label: 'Replay' },
              { id: 'b', label: 'Encryption' }
            ],
            id: 'q1',
            prompt: 'What does a nullifier prevent?'
          }
        ],
        title: 'Midterm',
        version: 'proofmark-fixed-mcq-v1'
      },
      startsAt: new Date('2026-05-01T09:00:00Z'),
      title: 'Midterm'
    }
  ];
  const templates: Array<Record<string, unknown>> = [];
  const questionBank: Array<Record<string, unknown>> = [];

  return {
    prisma: {
      exam: {
        findMany: async () => exams,
        findUnique: async ({ where }: { where: { id: string } }) =>
          exams.find((exam) => exam.id === where.id) ?? null
      },
      examTemplate: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const created = {
            createdAt: new Date(),
            id: `template-${templates.length + 1}`,
            updatedAt: new Date(),
            ...data
          };
          templates.push(created);
          return created;
        },
        findMany: async () => templates,
        findUnique: async ({ where }: { where: { id: string } }) =>
          templates.find((template) => template.id === where.id) ?? null
      },
      questionBankEntry: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const created = {
            createdAt: new Date(),
            id: `bank-${questionBank.length + 1}`,
            updatedAt: new Date(),
            ...data
          };
          questionBank.push(created);
          return created;
        },
        findMany: async () => questionBank
      }
    },
    questionBank,
    templates
  };
}

describe('AdminAuthoringService', () => {
  let service: AdminAuthoringService;
  let prismaMock: ReturnType<typeof createPrismaMock>;

  beforeEach(() => {
    prismaMock = createPrismaMock();
    service = new AdminAuthoringService(prismaMock.prisma as never);
  });

  it('exports an exam bundle and stores reusable templates', async () => {
    const exported = await service.exportExamBundle('exam-1');

    expect(exported.bundle.exam.title).toBe('Midterm');
    expect(exported.bundle.answerKey.q1).toBe('a');

    const template = await service.createTemplate({
      adminId: 'admin-demo',
      bundle: exported.bundle,
      description: 'A reusable default',
      title: 'Midterm Template'
    });

    expect(template.id).toBe('template-1');

    const loadedTemplate = await service.getTemplate(template.id);
    expect(loadedTemplate.bundle.questionSet.questions[0]?.id).toBe('q1');
    expect(prismaMock.templates).toHaveLength(1);
  });

  it('creates and lists question-bank entries', async () => {
    const created = await service.createQuestionBankEntry({
      adminId: 'admin-demo',
      entry: {
        tags: ['zk'],
        title: 'Nullifier basics',
        value: {
          choices: [
            { id: 'a', label: 'Replay' },
            { id: 'b', label: 'Encryption' }
          ],
          correctChoiceId: 'a',
          id: 'q1',
          prompt: 'What does a nullifier prevent?',
          type: 'mcq'
        }
      }
    });

    expect(created.id).toBe('bank-1');
    expect(prismaMock.questionBank[0]?.questionType).toBe(
      QuestionBankEntryType.MCQ
    );

    const listed = await service.listQuestionBank();

    expect(listed).toHaveLength(1);
    expect(listed[0]?.value.type).toBe('mcq');
    expect(listed[0]?.tags).toEqual(['zk']);
  });
});
