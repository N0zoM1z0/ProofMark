import {
  createPrivateKey,
  createPublicKey,
  createHash,
  generateKeyPairSync,
  sign,
  verify
} from 'node:crypto';

export const cryptoPackageName = '@proofmark/crypto';

type CanonicalPrimitive = null | boolean | number | string;
type CanonicalValue =
  | CanonicalPrimitive
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function normalizeNumber(value: number) {
  if (!Number.isFinite(value)) {
    throw new TypeError('Canonical JSON does not support non-finite numbers');
  }

  return Object.is(value, -0) ? 0 : value;
}

export function canonicalizeValue(value: unknown): CanonicalValue {
  if (value === null) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    typeof value === 'number'
  ) {
    return typeof value === 'number' ? normalizeNumber(value) : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      item === undefined ? null : canonicalizeValue(item)
    );
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value)
      .filter(([, currentValue]) => currentValue !== undefined)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));

    return Object.fromEntries(
      entries.map(([key, currentValue]) => [key, canonicalizeValue(currentValue)])
    );
  }

  throw new TypeError(`Unsupported value for canonical JSON: ${typeof value}`);
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalizeValue(value));
}

export function sha256Hex(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256Canonical(value: unknown) {
  return sha256Hex(canonicalJson(value));
}

export function generateEd25519KeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');

  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString()
  };
}

export function signCanonicalPayload(value: unknown, privateKeyPem: string) {
  return sign(
    null,
    Buffer.from(canonicalJson(value)),
    createPrivateKey(privateKeyPem)
  ).toString('base64url');
}

export function verifyCanonicalSignature(
  value: unknown,
  signature: string,
  publicKeyPem: string
) {
  return verify(
    null,
    Buffer.from(canonicalJson(value)),
    createPublicKey(publicKeyPem),
    Buffer.from(signature, 'base64url')
  );
}
