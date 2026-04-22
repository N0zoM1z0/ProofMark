import { Prisma } from '@prisma/client';

type AuditEventCreateInput = {
  actorPseudonym?: string | null;
  actorRole: string;
  createdAt: Date;
  eventHash: string;
  eventType: string;
  examId: string;
  payloadHash: string;
  prevEventHash?: string | null;
  seq: number;
};

type AuditEventTransactionClient = {
  auditEvent: {
    count(args: { where: { examId: string } }): Promise<number>;
    create(args: { data: AuditEventCreateInput }): Promise<{
      id: string;
      eventHash: string;
      seq: number;
    }>;
    findFirst(args: {
      orderBy: { seq: 'desc' };
      where: { examId: string };
    }): Promise<{
      eventHash: string;
      seq: number;
    } | null>;
  };
};

function isSeqConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

export function isRetryableAuditConflictError(error: unknown) {
  return (
    isSeqConflict(error) ||
    (error instanceof Error &&
      error.message.includes('current transaction is aborted'))
  );
}

export async function createAuditEventWithRetry(
  tx: AuditEventTransactionClient,
  params: {
    buildEvent: (input: {
      createdAt: Date;
      prevEventHash: string | null;
      seq: number;
    }) => AuditEventCreateInput;
    examId: string;
    maxAttempts?: number;
  }
) {
  const maxAttempts = params.maxAttempts ?? 5;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const seq =
      (await tx.auditEvent.count({
        where: {
          examId: params.examId
        }
      })) + 1;
    const previousAuditEvent = await tx.auditEvent.findFirst({
      where: {
        examId: params.examId
      },
      orderBy: {
        seq: 'desc'
      }
    });
    const createdAt = new Date();

    try {
      return await tx.auditEvent.create({
        data: params.buildEvent({
          createdAt,
          prevEventHash: previousAuditEvent?.eventHash ?? null,
          seq
        })
      });
    } catch (error) {
      if (isSeqConflict(error) && attempt < maxAttempts - 1) {
        continue;
      }

      throw error;
    }
  }

  throw new Error('AUDIT_EVENT_CREATE_RETRY_EXHAUSTED');
}
