import { describe, expect, it } from 'vitest';
import { Group } from '@semaphore-protocol/group';
import { AuditRootService } from '../src/audit-root.service.js';

describe('AuditRootService', () => {
  it('backfills cumulative audit root snapshots and derives group history', async () => {
    const expectedCurrentGroupRoot = new Group([1n, 2n]).root.toString();
    const createdRoots: Array<{
      createdAt: Date;
      examId: string;
      fromSeq: number;
      id: string;
      merkleRoot: string;
      phase: string;
      prevPhaseRoot: string | null;
      toSeq: number;
    }> = [];
    const service = new AuditRootService({
      auditEvent: {
        findMany: async () => [
          {
            createdAt: new Date('2026-04-22T10:00:00.000Z'),
            eventHash: 'hash-1',
            eventType: 'ExamCreated',
            seq: 1
          },
          {
            createdAt: new Date('2026-04-22T10:05:00.000Z'),
            eventHash: 'hash-2',
            eventType: 'IdentityCommitmentAdded',
            seq: 2
          }
        ]
      },
      auditRoot: {
        create: async ({
          data
        }: {
          data: Omit<(typeof createdRoots)[number], 'id'>;
        }) => {
          const root = {
            id: `root-${createdRoots.length + 1}`,
            ...data
          };
          createdRoots.push(root);
          return root;
        },
        findMany: async () => createdRoots
      },
      eligibleCommitment: {
        findMany: async () => [
          {
            addedAt: new Date('2026-04-22T10:01:00.000Z'),
            identityCommitment: '1'
          },
          {
            addedAt: new Date('2026-04-22T10:02:00.000Z'),
            identityCommitment: '2'
          }
        ]
      },
      exam: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          where.id === 'exam-1'
            ? {
                currentGroupRoot: expectedCurrentGroupRoot,
                id: 'exam-1'
              }
            : null
      }
    } as never);

    const auditRoots = await service.listAuditRoots('exam-1');
    const groupRoots = await service.listGroupRoots('exam-1');

    expect(auditRoots.currentEventCount).toBe(2);
    expect(auditRoots.snapshots).toHaveLength(2);
    expect(auditRoots.snapshots[1]).toMatchObject({
      phase: 'IdentityCommitmentAdded',
      toSeq: 2
    });
    expect(groupRoots.history).toHaveLength(2);
    expect(groupRoots.history[1]).toMatchObject({
      groupSnapshotVersion: 2,
      identityCommitment: '2',
      memberCount: 2
    });
    expect(groupRoots.currentGroupRoot).toBe(groupRoots.history[1]?.groupRoot);
  });
});
