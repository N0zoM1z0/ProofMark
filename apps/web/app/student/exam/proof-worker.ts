import { Group } from '@semaphore-protocol/group';
import {
  createIdentity,
  generateSemaphoreMembershipProof
} from '@proofmark/zk-semaphore';

type GenerateProofRequest = {
  identityExport: string;
  memberCommitments: string[];
  message: string;
  scope: string;
};

type GenerateProofResponse =
  | {
      ok: true;
      proof: Awaited<ReturnType<typeof generateSemaphoreMembershipProof>>;
    }
  | {
      ok: false;
      error: string;
    };

self.onmessage = async (event: MessageEvent<GenerateProofRequest>) => {
  try {
    const group = new Group(event.data.memberCommitments.map((item) => BigInt(item)));
    const identity = createIdentity(event.data.identityExport);
    const proof = await generateSemaphoreMembershipProof({
      group,
      identity,
      message: event.data.message,
      scope: event.data.scope
    });
    const response: GenerateProofResponse = {
      ok: true,
      proof
    };

    self.postMessage(response);
  } catch (error) {
    const response: GenerateProofResponse = {
      error: error instanceof Error ? error.message : 'Failed to generate proof',
      ok: false
    };

    self.postMessage(response);
  }
};

export {};
