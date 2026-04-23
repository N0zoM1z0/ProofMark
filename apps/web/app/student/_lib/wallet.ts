'use client';

import { Identity } from '@semaphore-protocol/identity';
import { get, set } from 'idb-keyval';

export type EncryptedIdentityRecord = {
  ciphertext: string;
  commitment: string;
  iv: string;
  salt: string;
  version: 1;
};

function bytesToBase64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function toBufferSource(bytes: Uint8Array): BufferSource {
  return Uint8Array.from(bytes);
}

export async function derivePassphraseKey(passphrase: string, salt: Uint8Array) {
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

export async function encryptTextRecord(
  plaintext: string,
  passphrase: string
): Promise<{
  ciphertext: string;
  iv: string;
  salt: string;
}> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derivePassphraseKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt(
    {
      iv,
      name: 'AES-GCM'
    },
    key,
    toBufferSource(new TextEncoder().encode(plaintext))
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt)
  };
}

export async function decryptTextRecord(
  record: {
    ciphertext: string;
    iv: string;
    salt: string;
  },
  passphrase: string
) {
  const key = await derivePassphraseKey(passphrase, base64ToBytes(record.salt));
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

export async function encryptIdentityExport(
  exportedIdentity: string,
  commitment: string,
  passphrase: string
): Promise<EncryptedIdentityRecord> {
  const encrypted = await encryptTextRecord(exportedIdentity, passphrase);

  return {
    ...encrypted,
    commitment,
    version: 1
  };
}

export async function decryptIdentityExport(
  record: EncryptedIdentityRecord,
  passphrase: string
) {
  return decryptTextRecord(record, passphrase);
}

export function getIdentityStorageKey(examId: string) {
  return `proofmark:identity:${examId}`;
}

export function getDraftStorageKey(examId: string, examVersion: number) {
  return `proofmark:draft:${examId}:v${examVersion}`;
}

export function getReceiptStorageKey(examId: string, examVersion: number) {
  return `proofmark:receipt:${examId}:v${examVersion}`;
}

export async function readStoredValue<T>(storageKey: string) {
  return get<T>(storageKey);
}

export async function writeStoredValue<T>(storageKey: string, value: T) {
  await set(storageKey, value);
}

export async function createAndStoreIdentity(params: {
  examId: string;
  passphrase: string;
}) {
  const identity = new Identity();
  const commitment = identity.commitment.toString();
  const encryptedRecord = await encryptIdentityExport(
    identity.export(),
    commitment,
    params.passphrase
  );

  await set(getIdentityStorageKey(params.examId), encryptedRecord);

  return {
    commitment,
    encryptedRecord
  };
}

export async function storeIdentityRecord(params: {
  examId: string;
  encryptedRecord: EncryptedIdentityRecord;
}) {
  await set(getIdentityStorageKey(params.examId), params.encryptedRecord);
}

export async function unlockStoredIdentity(params: {
  examId: string;
  passphrase: string;
}) {
  const storedRecord = await get<EncryptedIdentityRecord>(
    getIdentityStorageKey(params.examId)
  );

  if (!storedRecord) {
    return null;
  }

  const exportedIdentity = await decryptIdentityExport(
    storedRecord,
    params.passphrase
  );
  const identity = Identity.import(exportedIdentity);

  return {
    commitment: identity.commitment.toString(),
    exportedIdentity,
    storedRecord
  };
}

export function downloadBackup(record: EncryptedIdentityRecord) {
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
