import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { Injectable, NotFoundException } from '@nestjs/common';

function normalizeHash(value: string) {
  return value.startsWith('sha256:') ? value : `sha256:${value}`;
}

async function readBodyAsString(body: unknown) {
  if (!body) {
    throw new NotFoundException('Encrypted blob body is empty');
  }

  if (typeof body === 'string') {
    return body;
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body).toString('utf8');
  }

  if (typeof (body as { transformToString?: () => Promise<string> }).transformToString === 'function') {
    return (body as { transformToString: () => Promise<string> }).transformToString();
  }

  if (typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === 'function') {
    const chunks: Uint8Array[] = [];

    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }

    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
  }

  throw new NotFoundException('Encrypted blob body format is unsupported');
}

@Injectable()
export class BlobStorageService {
  private readonly client = new S3Client({
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? 'minioadmin',
      secretAccessKey: process.env.S3_SECRET_KEY ?? 'minioadmin'
    },
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:59000',
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    region: process.env.S3_REGION ?? 'us-east-1'
  });

  private readonly bucket = process.env.S3_BUCKET ?? 'proofmark-local';
  private ensureBucketPromise: Promise<void> | null = null;

  buildSubmissionObjectKey(params: {
    examId: string;
    examVersion: number;
    encryptedBlobHash: string;
  }) {
    return `submissions/${params.examId}/v${params.examVersion}/${normalizeHash(
      params.encryptedBlobHash
    ).replace(/^sha256:/, '')}.json`;
  }

  createBlobUri(objectKey: string) {
    return `s3://${this.bucket}/${objectKey}`;
  }

  parseBlobUri(blobUri: string) {
    const match = /^s3:\/\/([^/]+)\/(.+)$/.exec(blobUri);

    if (!match) {
      throw new NotFoundException('Invalid encrypted blob URI');
    }

    return {
      bucket: match[1],
      objectKey: match[2]
    };
  }

  async putEncryptedSubmissionBlob(params: {
    objectKey: string;
    encryptedBlobHash: string;
    content: string;
  }) {
    await this.ensureBucket();
    await this.client.send(
      new PutObjectCommand({
        Body: params.content,
        Bucket: this.bucket,
        ContentType: 'application/json',
        Key: params.objectKey,
        Metadata: {
          encryptedblobhash: normalizeHash(params.encryptedBlobHash).replace(
            /^sha256:/,
            ''
          )
        }
      })
    );
  }

  async assertBlobExists(params: {
    blobUri: string;
    encryptedBlobHash: string;
  }) {
    await this.ensureBucket();
    const { bucket, objectKey } = this.parseBlobUri(params.blobUri);
    const normalizedHash = normalizeHash(params.encryptedBlobHash);

    if (bucket !== this.bucket) {
      throw new NotFoundException('Encrypted blob bucket does not match the active store');
    }

    const result = await this.client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: objectKey
      })
    );
    const storedHash = result.Metadata?.encryptedblobhash;

    if (!storedHash || normalizedHash !== `sha256:${storedHash}`) {
      throw new NotFoundException('Encrypted blob hash does not match uploaded object');
    }
  }

  async getEncryptedSubmissionBlob(blobUri: string) {
    await this.ensureBucket();
    const { bucket, objectKey } = this.parseBlobUri(blobUri);

    if (bucket !== this.bucket) {
      throw new NotFoundException('Encrypted blob bucket does not match the active store');
    }

    const result = await this.client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: objectKey
      })
    );

    return readBodyAsString(result.Body);
  }

  private async ensureBucket() {
    if (!this.ensureBucketPromise) {
      this.ensureBucketPromise = (async () => {
        try {
          await this.client.send(
            new HeadBucketCommand({
              Bucket: this.bucket
            })
          );
        } catch {
          await this.client.send(
            new CreateBucketCommand({
              Bucket: this.bucket
            })
          );
        }
      })();
    }

    return this.ensureBucketPromise;
  }
}
