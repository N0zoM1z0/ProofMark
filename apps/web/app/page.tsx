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
        <p className="eyebrow">ProofMark MVP</p>
        <h1>Verifiable assessment infrastructure without sacrificing privacy.</h1>
        <p className="lede">
          The repository is scaffolded for a ZK-enabled exam workflow built on
          Next.js, NestJS, Prisma, and proof workers.
        </p>
      </section>

      <section className="card">
        <h2>Foundation Status</h2>
        <ul>
          {highlights.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Live Flows</h2>
        <div className="link-grid">
          <Link href="/student/register" className="nav-tile">
            <span className="eyebrow">Phase 3</span>
            <strong>Register Identity</strong>
            <p>Create and encrypt the local Semaphore wallet.</p>
          </Link>
          <Link href="/student/exam" className="nav-tile">
            <span className="eyebrow">Phase 6</span>
            <strong>Take Exam</strong>
            <p>Answer MCQs, upload encrypted blobs, and submit anonymously.</p>
          </Link>
          <Link href="/verify-receipt" className="nav-tile">
            <span className="eyebrow">Audit</span>
            <strong>Verify Receipt</strong>
            <p>Validate signatures and Merkle inclusion entirely in-browser.</p>
          </Link>
          <Link href="/auditor" className="nav-tile">
            <span className="eyebrow">Phase 9</span>
            <strong>Auditor Console</strong>
            <p>Inspect manifests, audit roots, proof metadata, and stored receipts.</p>
          </Link>
        </div>
      </section>
    </main>
  );
}
