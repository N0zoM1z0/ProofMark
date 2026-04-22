import {
  addCommitment,
  createGroup,
  createIdentity,
  generateSemaphoreMembershipProof,
  getGroupSnapshot,
  getIdentityCommitment,
  type SemaphoreProof,
  verifySemaphoreMembershipProof
} from './index.js';

async function main() {
  const identities = [createIdentity(), createIdentity(), createIdentity()];
  const group = createGroup();

  for (const identity of identities) {
    addCommitment(group, getIdentityCommitment(identity));
  }

  const snapshot = getGroupSnapshot(group);
  const proof: SemaphoreProof = await generateSemaphoreMembershipProof({
    identity: identities[0]!,
    group,
    message: 'proofmark:submission-demo',
    scope: 'proofmark:submit:demo'
  });
  const isValid = await verifySemaphoreMembershipProof(proof);

  console.log(
    JSON.stringify(
      {
        commitments: identities.map((identity) => getIdentityCommitment(identity)),
        proof: {
          merkleTreeDepth: proof.merkleTreeDepth,
          merkleTreeRoot: proof.merkleTreeRoot,
          nullifier: proof.nullifier,
          scope: proof.scope
        },
        snapshot,
        verified: isValid
      },
      null,
      2
    )
  );
}

void main();
