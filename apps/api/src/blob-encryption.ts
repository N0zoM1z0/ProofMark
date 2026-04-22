import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  privateDecrypt
} from 'node:crypto';

const devBlobEncryptionPrivateKeyPem = `-----BEGIN PRIVATE KEY-----
MIIEugIBADANBgkqhkiG9w0BAQEFAASCBKQwggSgAgEAAoIBAQCz7F6Cl7lblr3l
ZVQf851zo4+E1wa+WKfLgKEs0p4g+svsGQKNUfMaVWiIYh0vGiHcP80O9g4nQDqI
VqfuKiIIRLh4MptzC5DPY2z/ZNj1422dwDU/TqC5eEYXkVFSH0wCTLS/7Nk6CF+I
5htr8dwtEYIxreuGxTuoVRgCV3B5EDr68iLJj9qar8P3b160WAjb1tjZ86pPBIS1
7nBha6ycqjVeOORhujDCZylsysSs9w7MuzFuWoyvy/6e6CC3ATm5+WpYmzjNh0NF
rP1WSp0mj94qc/yV14DExZMrD3alCPhS0zWYHzlenu0adke16yQqPHIoZ+5zhbaB
6MDyb/fbAgMBAAECgf8vDK7GsJEPN6M39gBQzHIY9fOgEGHduhhfu234kcXIEunO
xWYsjmwuoV/fLckCJKiZqMAhcIvtm0GzLIQvQ5xpxgB3NTZxQr+ptLnaSD3JZGiM
5jZbu0Iv6KdPLRSW5QoJj+kJnJ74nDfthnfBtFLRBHv5EAHqvDckoxvrR/JMJ4/M
LaGJ4yIR8tG1Q4n54RcJuATm0h2gZqBwJhQSjN5TRlI3wGsBLPx6JfQ4Aydk8Y8v
JvSoEyjbqKyjN/+Z9Fj8JcJ7zJhjMLkbOuFnXErrOzSFPllRc419SrDx06OC6Qat
6GkiqZu6FSg4cgYnRIqLkprtwXGh3hWIKtoJ3oECgYEAwjvvZhsMiClohnT9zL5r
qEnYKnk05x5OkRt+yCEWK0pVxeLgR0IJywizzOzqbR8jX63QUQaeSqAtpUN63UMd
a/CxAp8vs342NUPh//0J5M1Funxs+8d2aaQn+APN+ay4EtPV5si7k3RlVKzulrEU
D1ngvC1g2GBbdD9HCnmX/FsCgYEA7SNuS+RnrzukSoHp7vH8sgrCVwakWjrYP9nB
LJxBws59TYTXI3kyPPz1DwoYs+aurtg2nE2zMEJzT4NZ1eFEqbBx9ZAxOIoih+FB
X6AjgEGdy2ag4+PAH6OnU0qqiy+T4wdr3I9f9E5oWkvInYVRWDzooE4zwzlG9ing
MVROyoECgYBVWLqn1gjap79LHYsL9Twe9VurxhiN2Y5SSo+Z5pf0K7SmwDsmdIkT
Et7Wk9+qVT1Y5GodwFe7mMiVzqHlKYF7FYbiDQqLx1CQdSSQNCKty9jwyY2l0I5i
ewQpAZr3M4KqmzRpNRjfAQ0peNdZlbOnzyll5lagnS5yVP+lRaqX8wKBgGcGwq+0
PxvRxLIeOT134vqTVBWtLBCLilJLT/MKvENfpO7d7P5bdGks2Wc8UrkuWuxZwXgt
BdHMvP5pqckTgtpab1hp2gifcxsn0VgzYdkiKOUq5HG+DEVyu4qjYO7xr8Wt/r2n
iN/ChPHeBP3y4wF8DPFAqJqDswHV9bJY15aBAoGAFDcHCYUKFB+4j1LiNa4dm5gm
xU2zCItTCN5sB3PZjUPS7BNva9mV3xj0AzsDXGvAJNiPUS72xdU7eBql36/fSC7H
LscZziRd+6RN4dp3KkEQJHcyHyOtwtSfunRC/mVnvv6w+7VzfVVWwPNpfWm868xq
gN/OBApmyYcbzozP9JY=
-----END PRIVATE KEY-----`;

let generatedBlobEncryptionKey:
  | {
      privateKeyPem: string;
      publicKeyPem: string;
    }
  | undefined;

function getConfiguredBlobEncryptionPrivateKeyPem() {
  const configuredValue =
    process.env.BLOB_ENCRYPTION_PRIVATE_KEY ?? 'dev-static-proofmark-key';

  if (configuredValue === 'dev-static-proofmark-key') {
    return devBlobEncryptionPrivateKeyPem;
  }

  if (configuredValue === 'dev-generate-on-boot') {
    if (!generatedBlobEncryptionKey) {
      const { privateKey, publicKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048
      });

      generatedBlobEncryptionKey = {
        privateKeyPem: privateKey
          .export({
            format: 'pem',
            type: 'pkcs8'
          })
          .toString(),
        publicKeyPem: publicKey
          .export({
            format: 'pem',
            type: 'spki'
          })
          .toString()
      };
    }

    return generatedBlobEncryptionKey.privateKeyPem;
  }

  if (configuredValue.includes('BEGIN')) {
    return configuredValue.replace(/\\n/g, '\n');
  }

  return Buffer.from(configuredValue, 'base64').toString('utf8');
}

export function getBlobEncryptionPrivateKeyPem() {
  return getConfiguredBlobEncryptionPrivateKeyPem();
}

export function getBlobEncryptionPublicKeyPem() {
  if (generatedBlobEncryptionKey) {
    return generatedBlobEncryptionKey.publicKeyPem;
  }

  return createPublicKey(createPrivateKey(getConfiguredBlobEncryptionPrivateKeyPem()))
    .export({
      format: 'pem',
      type: 'spki'
    })
    .toString();
}

export function decryptEnvelopeKey(encryptedKeyBase64: string) {
  return privateDecrypt(
    {
      key: createPrivateKey(getConfiguredBlobEncryptionPrivateKeyPem()),
      oaepHash: 'sha256'
    },
    Buffer.from(encryptedKeyBase64, 'base64')
  );
}
