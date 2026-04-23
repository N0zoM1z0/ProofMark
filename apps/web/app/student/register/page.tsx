'use client';

import { Identity } from '@semaphore-protocol/identity';
import { get, set } from 'idb-keyval';
import type { ChangeEvent } from 'react';
import { useMemo, useState } from 'react';

type EncryptedIdentityRecord = {
  ciphertext: string;
  commitment: string;
  iv: string;
  salt: string;
  version: 1;
};

const apiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

function bytesToBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function toBufferSource(bytes: Uint8Array): BufferSource {
  return Uint8Array.from(bytes);
}

async function deriveKey(passphrase: string, salt: Uint8Array) {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      hash: 'SHA-256',
      iterations: 150_000,
      name: 'PBKDF2',
      salt: toBufferSource(salt)
    },
    baseKey,
    {
      length: 256,
      name: 'AES-GCM'
    },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptIdentityExport(
  exportedIdentity: string,
  commitment: string,
  passphrase: string
): Promise<EncryptedIdentityRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt(
    {
      iv,
      name: 'AES-GCM'
    },
    key,
    toBufferSource(new TextEncoder().encode(exportedIdentity))
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    commitment,
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
    version: 1
  };
}

async function decryptIdentityExport(
  record: EncryptedIdentityRecord,
  passphrase: string
) {
  const key = await deriveKey(passphrase, base64ToBytes(record.salt));
  const decrypted = await crypto.subtle.decrypt(
    {
      iv: toBufferSource(base64ToBytes(record.iv)),
      name: 'AES-GCM'
    },
    key,
    toBufferSource(base64ToBytes(record.ciphertext))
  );

  return new TextDecoder().decode(decrypted);
}

function downloadBackup(record: EncryptedIdentityRecord) {
  const blob = new Blob([JSON.stringify(record, null, 2)], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = `proofmark-identity-${record.commitment}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function StudentRegisterPage() {
  const [commitment, setCommitment] = useState<string | null>(null);
  const [examId, setExamId] = useState('demo-exam');
  const [passphrase, setPassphrase] = useState('');
  const [studentId, setStudentId] = useState('student-demo');
  const [status, setStatus] = useState('No local Semaphore identity yet.');
  const walletStorageKey = useMemo(
    () => `proofmark:identity:${examId}`,
    [examId]
  );

  async function handleCreateIdentity() {
    if (!passphrase) {
      setStatus('Passphrase is required before creating an identity.');
      return;
    }

    const identity = new Identity();
    const nextCommitment = identity.commitment.toString();
    const encryptedRecord = await encryptIdentityExport(
      identity.export(),
      nextCommitment,
      passphrase
    );

    await set(walletStorageKey, encryptedRecord);
    setCommitment(nextCommitment);
    setStatus(
      'Identity created locally, encrypted with Web Crypto, and stored in IndexedDB.'
    );
  }

  async function handleUnlockIdentity() {
    const storedRecord = await get<EncryptedIdentityRecord>(walletStorageKey);

    if (!storedRecord) {
      setStatus('No encrypted identity is stored for this exam key.');
      return;
    }

    if (!passphrase) {
      setStatus('Passphrase is required to unlock the stored identity.');
      return;
    }

    try {
      const exportedIdentity = await decryptIdentityExport(
        storedRecord,
        passphrase
      );
      const identity = Identity.import(exportedIdentity);

      setCommitment(identity.commitment.toString());
      setStatus('Identity unlocked from IndexedDB successfully.');
    } catch {
      setStatus('Failed to decrypt the stored identity. Check the passphrase.');
    }
  }

  async function handleExportBackup() {
    const storedRecord = await get<EncryptedIdentityRecord>(walletStorageKey);

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

    const contents = await file.text();
    const importedRecord = JSON.parse(contents) as EncryptedIdentityRecord;

    await set(walletStorageKey, importedRecord);
    setCommitment(importedRecord.commitment);
    setStatus('Encrypted backup imported into IndexedDB.');
  }

  async function handleRegisterCommitment() {
    const storedRecord = await get<EncryptedIdentityRecord>(walletStorageKey);

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
            'x-student-id': studentId
          },
          method: 'POST'
        }
      );

      if (!response.ok) {
        const errorMessage = await response.text();
        setStatus(`Registration failed: ${errorMessage}`);
        return;
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

  return (
    <main className="shell">
      <section className="card">
        <p className="eyebrow">Student Registration</p>
        <h1>Local Semaphore identity wallet</h1>
        <p className="lede">
          This MVP page generates the Semaphore identity in the browser, encrypts
          the exported private key with Web Crypto, stores it in IndexedDB, and
          only sends the public commitment to the API.
        </p>
      </section>

      <section className="card form-card">
        <label className="field">
          <span>Exam ID</span>
          <input value={examId} onChange={(event) => setExamId(event.target.value)} />
        </label>
        <label className="field">
          <span>Mock Student ID</span>
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
        <p>{status}</p>
      </section>
    </main>
  );
}
