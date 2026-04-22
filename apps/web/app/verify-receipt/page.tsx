'use client';

import { useState } from 'react';
import {
  type SubmissionReceipt,
  verifyReceipt
} from '../student/_lib/proofmark-crypto';

export default function VerifyReceiptPage() {
  const [receipt, setReceipt] = useState<SubmissionReceipt | null>(null);
  const [status, setStatus] = useState(
    'Upload a receipt JSON file to verify the server signature and Merkle inclusion proof locally.'
  );
  const [verification, setVerification] = useState<{
    merkleProofValid: boolean;
    signatureValid: boolean;
    verified: boolean;
  } | null>(null);

  async function handleReceiptUpload(file: File | undefined) {
    if (!file) {
      return;
    }

    try {
      const nextReceipt = JSON.parse(await file.text()) as SubmissionReceipt;
      const nextVerification = await verifyReceipt(nextReceipt);

      setReceipt(nextReceipt);
      setVerification(nextVerification);
      setStatus(
        nextVerification.verified
          ? 'Receipt verified locally.'
          : 'Receipt parsed, but verification failed.'
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to verify receipt');
      setReceipt(null);
      setVerification(null);
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Receipt Verify</p>
        <h1>Independent receipt verification without server trust.</h1>
        <p className="lede">
          The page checks the signature carried inside the receipt and rebuilds
          the audit path to the published Merkle root entirely in the browser.
        </p>
      </section>

      <section className="card form-card">
        <label className="import-button">
          Upload Receipt JSON
          <input
            type="file"
            accept="application/json"
            onChange={(event) => {
              void handleReceiptUpload(event.target.files?.[0]);
            }}
          />
        </label>
        <p className="status-copy">{status}</p>
      </section>

      {receipt && verification ? (
        <section className="card">
          <div className="meta-grid">
            <div>
              <span className="meta-label">Submission ID</span>
              <p>{receipt.submissionId}</p>
            </div>
            <div>
              <span className="meta-label">Exam ID</span>
              <p>{receipt.examId}</p>
            </div>
            <div>
              <span className="meta-label">Signature</span>
              <p>{verification.signatureValid ? 'Valid' : 'Invalid'}</p>
            </div>
            <div>
              <span className="meta-label">Merkle Inclusion</span>
              <p>{verification.merkleProofValid ? 'Valid' : 'Invalid'}</p>
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
