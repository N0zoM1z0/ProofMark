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
    </main>
  );
}
