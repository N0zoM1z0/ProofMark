# Objective Grading Proofs

ProofMark now runs the objective grading backend through a real Noir circuit and
Barretenberg CLI proof flow.

## Circuit

Source:

- `circuits/fixed_mcq_grading/src/main.nr`
- `circuits/fixed_mcq_grading/Nargo.toml`

Compiled artifact used by the worker package:

- `packages/zk-grading-noir/src/artifacts/fixed_mcq_grading.json`

The circuit proves that:

- the private selected-choice hashes and private correct-choice hashes produce
  the published objective score
- `score == count(matches) * pointsPerQuestion`
- `maxScore == questionCount * pointsPerQuestion`

The worker still checks the outer ProofMark commitments before proving:

- answer sheet commitment
- answer-key commitment
- grading-policy hash

This keeps JSON canonicalization and answer-key commitment logic in TypeScript,
while the score computation itself is proven by Noir/Barretenberg.

## Runtime Requirements

Install compatible Noir and Barretenberg tools:

```bash
noirup
curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/refs/heads/next/barretenberg/bbup/install | bash
bbup
```

The backend resolves `bb` in this order:

- `BARRETENBERG_BINARY`
- `BB_BINARY`
- `$HOME/.bb/bb`
- `bb` on `PATH`

## Regenerating The Circuit Artifact

```bash
cd circuits/fixed_mcq_grading
nargo check
nargo compile
cp target/fixed_mcq_grading.json ../../packages/zk-grading-noir/src/artifacts/fixed_mcq_grading.json
```

Then run:

```bash
pnpm --filter @proofmark/zk-grading-noir test
pnpm --filter @proofmark/worker test
```

## Verification Semantics

`@proofmark/zk-grading-noir` generates:

- a Noir witness with `@noir-lang/noir_js`
- an UltraHonk proof with `bb prove`
- a verification key with `bb prove --write_vk`
- a native verification result with `bb verify`

The stored `ProofArtifact` records:

- circuit name and version
- proof hash
- public-input hash
- verification-key hash
- verification status
