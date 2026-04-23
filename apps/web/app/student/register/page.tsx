'use client';

import type { ChangeEvent } from 'react';
import { useMemo, useState } from 'react';
import {
  createAndStoreIdentity,
  downloadBackup,
  readStoredValue,
  storeIdentityRecord,
  unlockStoredIdentity,
  type EncryptedIdentityRecord
} from '../_lib/wallet';

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

type RecoveryPackageSummary = {
  escrowedAt: string;
  expiresAt: string | null;
  identityCommitment: string;
  packageHash: string;
  packageId: string;
  restoredAt: string | null;
  status: string;
};

export default function StudentRegisterPage() {
  const [commitment, setCommitment] = useState<string | null>(null);
  const [examId, setExamId] = useState('demo-exam');
  const [passphrase, setPassphrase] = useState('');
  const [studentId, setStudentId] = useState('student-demo');
  const [status, setStatus] = useState('No local Semaphore identity yet.');
  const [recoveryPackage, setRecoveryPackage] =
    useState<RecoveryPackageSummary | null>(null);
  const walletStorageKey = useMemo(
    () => `proofmark:identity:${examId}`,
    [examId]
  );

  async function loadStoredRecord() {
    return readStoredValue<EncryptedIdentityRecord>(walletStorageKey);
  }

  async function refreshRecoveryPackage() {
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/student/exams/${examId}/recovery-package`,
        {
          headers: {
            'x-student-id': studentId.trim()
          },
          method: 'GET'
        }
      );

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const payload = (await response.json()) as {
        recoveryPackage: RecoveryPackageSummary | null;
      };

      setRecoveryPackage(payload.recoveryPackage);
      return payload.recoveryPackage;
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : 'Failed to load recovery package status'
      );
      return null;
    }
  }

  async function handleCreateIdentity() {
    if (!passphrase) {
      setStatus('Passphrase is required before creating an identity.');
      return;
    }

    const created = await createAndStoreIdentity({
      examId,
      passphrase
    });

    setCommitment(created.commitment);
    setStatus(
      'Identity created locally, encrypted with Web Crypto, and stored in IndexedDB.'
    );
  }

  async function handleUnlockIdentity() {
    if (!passphrase) {
      setStatus('Passphrase is required to unlock the stored identity.');
      return;
    }

    try {
      const unlockedIdentity = await unlockStoredIdentity({
        examId,
        passphrase
      });

      if (!unlockedIdentity) {
        setStatus('No encrypted identity is stored for this exam key.');
        return;
      }

      setCommitment(unlockedIdentity.commitment);
      setStatus('Identity unlocked from IndexedDB successfully.');
    } catch {
      setStatus('Failed to decrypt the stored identity. Check the passphrase.');
    }
  }

  async function handleExportBackup() {
    const storedRecord = await loadStoredRecord();

    if (!storedRecord) {
      setStatus('No stored identity is available to export.');
      return;
    }

    downloadBackup(storedRecord);
    setStatus('Encrypted backup exported.');
  }

  async function handleImportBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const importedRecord = JSON.parse(
      await file.text()
    ) as EncryptedIdentityRecord;

    await storeIdentityRecord({
      encryptedRecord: importedRecord,
      examId
    });
    setCommitment(importedRecord.commitment);
    setStatus('Encrypted backup imported into IndexedDB.');
  }

  async function handleRegisterCommitment() {
    const storedRecord = await loadStoredRecord();

    if (!storedRecord) {
      setStatus('Create or import an encrypted identity before registration.');
      return;
    }

    try {
      const response = await fetch(
        `${apiBaseUrl}/api/student/exams/${examId}/register-commitment`,
        {
          body: JSON.stringify({
            identityCommitment: storedRecord.commitment
          }),
          headers: {
            'content-type': 'application/json',
            'x-student-id': studentId.trim()
          },
          method: 'POST'
        }
      );

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const result = (await response.json()) as {
        groupRoot: string;
        groupSnapshotVersion: number;
        memberIndex: number;
      };

      setCommitment(storedRecord.commitment);
      setStatus(
        `Commitment registered. Group root: ${result.groupRoot}, member index: ${result.memberIndex}, version: ${result.groupSnapshotVersion}.`
      );
    } catch (error) {
      setStatus(
        `Registration failed: ${error instanceof Error ? error.message : 'Unknown network error'}`
      );
    }
  }

  async function handleEscrowRecoveryPackage() {
    const storedRecord = await loadStoredRecord();

    if (!storedRecord) {
      setStatus('Create or import an encrypted identity before escrow.');
      return;
    }

    try {
      const response = await fetch(
        `${apiBaseUrl}/api/student/exams/${examId}/recovery-package`,
        {
          body: JSON.stringify({
            encryptedRecord: storedRecord
          }),
          headers: {
            'content-type': 'application/json',
            'x-student-id': studentId.trim()
          },
          method: 'POST'
        }
      );

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const payload = (await response.json()) as {
        recoveryPackage: RecoveryPackageSummary;
      };

      setRecoveryPackage(payload.recoveryPackage);
      setStatus(
        `Recovery package escrowed. Package ${payload.recoveryPackage.packageId} is now ${payload.recoveryPackage.status}.`
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : 'Failed to escrow recovery package'
      );
    }
  }

  return (
    <main className="shell">
      <section className="card">
        <p className="eyebrow">Student Registration</p>
        <h1>Local Semaphore identity wallet</h1>
        <p className="lede">
          Generate the Semaphore identity in the browser, encrypt the exported
          private key with Web Crypto, store it in IndexedDB, and send only the
          public commitment to the API.
        </p>
        <p className="helper-copy">
          Best practice is now: export the encrypted backup and escrow the same
          encrypted wallet package after commitment registration. Claim recovery
          still requires the original passphrase.
        </p>
      </section>

      <section className="card form-card">
        <label className="field">
          <span>Exam ID</span>
          <input value={examId} onChange={(event) => setExamId(event.target.value)} />
        </label>
        <label className="field">
          <span>Student ID</span>
          <input
            value={studentId}
            onChange={(event) => setStudentId(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Passphrase</span>
          <input
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
          />
        </label>
        <div className="actions">
          <button onClick={() => void handleCreateIdentity()}>Create Identity</button>
          <button onClick={() => void handleUnlockIdentity()}>
            Unlock Stored Identity
          </button>
          <button onClick={() => void handleExportBackup()}>Export Backup</button>
          <button onClick={() => void handleRegisterCommitment()}>
            Register Commitment
          </button>
          <button onClick={() => void handleEscrowRecoveryPackage()}>
            Escrow Recovery Package
          </button>
          <button onClick={() => void refreshRecoveryPackage()}>
            Refresh Recovery Status
          </button>
          <label className="import-button">
            Import Backup
            <input
              type="file"
              accept="application/json"
              onChange={(event) => void handleImportBackup(event)}
            />
          </label>
        </div>
        <p>
          Commitment:
          <strong>{commitment ? ` ${commitment}` : ' not created yet'}</strong>
        </p>
        <p className="helper-copy">
          Recommended order: create identity, export backup, register the
          commitment, then escrow the recovery package.
        </p>
        <p>{status}</p>
      </section>

      <section className="card">
        <h2>Recovery Package</h2>
        {recoveryPackage ? (
          <div className="meta-grid">
            <div>
              <span className="meta-label">Package ID</span>
              <p>{recoveryPackage.packageId}</p>
            </div>
            <div>
              <span className="meta-label">Status</span>
              <p>{recoveryPackage.status}</p>
            </div>
            <div>
              <span className="meta-label">Escrowed At</span>
              <p>{recoveryPackage.escrowedAt}</p>
            </div>
            <div>
              <span className="meta-label">Package Hash</span>
              <p>{recoveryPackage.packageHash}</p>
            </div>
          </div>
        ) : (
          <p className="helper-copy">
            No escrowed recovery package is visible for this student and exam yet.
          </p>
        )}
      </section>
    </main>
  );
}
