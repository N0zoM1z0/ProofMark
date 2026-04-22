import { Group } from '@semaphore-protocol/group';
import { Identity } from '@semaphore-protocol/identity';
import { generateProof, verifyProof } from '@semaphore-protocol/proof';

export type SemaphoreIdentity = Identity;
export type SemaphoreGroup = Group;
export interface SemaphoreProof {
  merkleTreeDepth: number;
  merkleTreeRoot: string;
  message: string;
  nullifier: string;
  points: string[];
  scope: string;
}

const semaphoreGenerateProof = generateProof as (
  identity: SemaphoreIdentity,
  group: SemaphoreGroup,
  message: bigint | number | string | Uint8Array,
  scope: bigint | number | string | Uint8Array,
  merkleTreeDepth?: number
) => Promise<SemaphoreProof>;

const semaphoreVerifyProof = verifyProof as (
  proof: SemaphoreProof
) => Promise<boolean>;

export interface GroupSnapshot {
  depth: number;
  members: string[];
  root: string;
  size: number;
}

function normalizeCommitment(commitment: bigint | number | string) {
  return BigInt(commitment);
}

export function createIdentity(privateKey?: string) {
  return privateKey ? Identity.import(privateKey) : new Identity();
}

export function exportIdentity(identity: SemaphoreIdentity) {
  return identity.export();
}

export function getIdentityCommitment(identity: SemaphoreIdentity) {
  return identity.commitment.toString();
}

export function createGroup(commitments: Array<bigint | number | string> = []) {
  return new Group(commitments.map(normalizeCommitment));
}

export function addCommitment(
  group: SemaphoreGroup,
  commitment: bigint | number | string
) {
  group.addMember(normalizeCommitment(commitment));
  return group;
}

export function getGroupSnapshot(group: SemaphoreGroup): GroupSnapshot {
  return {
    depth: group.depth,
    members: group.members.map((member) => member.toString()),
    root: group.root.toString(),
    size: group.size
  };
}

export function generateSemaphoreMembershipProof(params: {
  identity: SemaphoreIdentity;
  group: SemaphoreGroup;
  message: bigint | number | string | Uint8Array;
  scope: bigint | number | string | Uint8Array;
  merkleTreeDepth?: number;
}) {
  return semaphoreGenerateProof(
    params.identity,
    params.group,
    params.message,
    params.scope,
    params.merkleTreeDepth
  );
}

export function verifySemaphoreMembershipProof(proof: SemaphoreProof) {
  return semaphoreVerifyProof(proof);
}
