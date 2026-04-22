import { describe, expect, it } from 'vitest';
import {
  addCommitment,
  createGroup,
  createIdentity,
  exportIdentity,
  getGroupSnapshot,
  getIdentityCommitment
} from '../src/index.js';

describe('zk-semaphore wrappers', () => {
  it('round-trips exported identities and updates group roots', () => {
    const identity = createIdentity();
    const exportedIdentity = exportIdentity(identity);
    const importedIdentity = createIdentity(exportedIdentity);
    const group = createGroup();

    expect(getIdentityCommitment(importedIdentity)).toBe(
      getIdentityCommitment(identity)
    );

    addCommitment(group, getIdentityCommitment(identity));
    const snapshot = getGroupSnapshot(group);

    expect(snapshot.size).toBe(1);
    expect(snapshot.members[0]).toBe(getIdentityCommitment(identity));
    expect(snapshot.root).toBeTruthy();
  });
});
