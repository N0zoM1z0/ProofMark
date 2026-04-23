# Grading Proofs

ProofMark runs grading proof generation through real Noir circuits and the
Barretenberg CLI proof flow. The backend is registry-based so each proof type has
an explicit circuit name, circuit version, verification-key hash, proof hash, and
public-input hash.

## Circuits

Current circuits:

- `circuits/fixed_mcq_grading/src/main.nr`
- `circuits/fixed_mcq_grading/Nargo.toml`
- `circuits/subjective_aggregation/src/main.nr`
- `circuits/subjective_aggregation/Nargo.toml`
- `circuits/final_grade_composition/src/main.nr`
- `circuits/final_grade_composition/Nargo.toml`

Compiled artifacts used by `@proofmark/zk-grading-noir`:

- `packages/zk-grading-noir/src/artifacts/fixed_mcq_grading.json`
- `packages/zk-grading-noir/src/artifacts/subjective_aggregation.json`
- `packages/zk-grading-noir/src/artifacts/final_grade_composition.json`

The fixed MCQ circuit proves that:

- the private selected-choice hashes and private correct-choice hashes produce
  the published objective score
- `score == count(matches) * pointsPerQuestion`
- `maxScore == questionCount * pointsPerQuestion`

The subjective aggregation circuit proves that:

- each submitted mark is within the part's max-score bound
- baseline marker scores are aggregated according to `markersPerPart`
- adjudication is required when baseline delta exceeds `adjudicationDelta`
- adjudicated parts aggregate all submitted marks
- `subjectiveScore` and `subjectiveMaxScore` match the proved part totals

The final grade composition circuit proves that:

- `finalScore == objectiveScore + subjectiveScore`
- `maxScore == objectiveMaxScore + subjectiveMaxScore`

ProofMark still checks outer commitments and non-circuit-friendly material in
TypeScript before proving:

- answer sheet commitment
- answer-key commitment
- grading-policy hash
- subjective part commitments
- marker signatures
- grade commitment
- proof-artifact root

This keeps JSON canonicalization, SHA-256 commitments, and Ed25519 marker
signature verification in TypeScript, while deterministic score arithmetic and
aggregation rules are proven by Noir/Barretenberg.

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

cd ../subjective_aggregation
nargo check
nargo compile
cp target/subjective_aggregation.json ../../packages/zk-grading-noir/src/artifacts/subjective_aggregation.json

cd ../final_grade_composition
nargo check
nargo compile
cp target/final_grade_composition.json ../../packages/zk-grading-noir/src/artifacts/final_grade_composition.json
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

Supported proof artifact types:

- `objective-grade-proof`
- `subjective-aggregation-proof`
- `final-grade-composition-proof`
