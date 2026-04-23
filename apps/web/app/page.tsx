import Link from 'next/link';

const highlights = [
  'Anonymous submission with Semaphore-based eligibility proofs',
  'Tamper-evident audit roots and signed receipts',
  'Deterministic grading proofs for objective questions'
];

export default function HomePage() {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">ProofMark</p>
        <h1>
          Verifiable assessment infrastructure without sacrificing privacy.
        </h1>
        <p className="lede">
          Run authoring, anonymous submission, blind marking, public verification,
          and finalized grade claim from a single privacy-preserving platform.
        </p>
      </section>

      <section className="card">
        <h2>Platform Capabilities</h2>
        <ul>
          {highlights.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Live Flows</h2>
        <div className="link-grid">
          <Link href="/admin" className="nav-tile">
            <span className="eyebrow">Authoring</span>
            <strong>Admin Workspace</strong>
            <p>
              Import question sheets, save templates, reuse bank prompts, and
              build exams.
            </p>
          </Link>
          <Link href="/student/register" className="nav-tile">
            <span className="eyebrow">Identity</span>
            <strong>Register Identity</strong>
            <p>Create and encrypt the local Semaphore wallet.</p>
          </Link>
          <Link href="/student/exam" className="nav-tile">
            <span className="eyebrow">Submission</span>
            <strong>Take Exam</strong>
            <p>Answer MCQs, upload encrypted blobs, and submit anonymously.</p>
          </Link>
          <Link href="/student/claim" className="nav-tile">
            <span className="eyebrow">Results</span>
            <strong>Claim Grade</strong>
            <p>
              Use the same local identity and receipt to reclaim the finalized
              result.
            </p>
          </Link>
          <Link href="/verify-receipt" className="nav-tile">
            <span className="eyebrow">Audit</span>
            <strong>Verify Receipt</strong>
            <p>Validate signatures and Merkle inclusion entirely in-browser.</p>
          </Link>
          <Link href="/auditor" className="nav-tile">
            <span className="eyebrow">Audit</span>
            <strong>Auditor Console</strong>
            <p>
              Inspect manifests, audit roots, proof metadata, and stored
              receipts.
            </p>
          </Link>
          <Link href="/marker" className="nav-tile">
            <span className="eyebrow">Marking</span>
            <strong>Marker Console</strong>
            <p>
              Load blinded tasks, sign marks locally, and submit adjudicable
              scores.
            </p>
          </Link>
        </div>
      </section>
    </main>
  );
}
