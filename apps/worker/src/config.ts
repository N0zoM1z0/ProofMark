export type WorkerRuntimeConfig = {
  databaseUrl: string;
  nodeEnv: string;
  s3AccessKey: string;
  s3Bucket: string;
  s3Endpoint: string;
  s3ForcePathStyle: boolean;
  s3Region: string;
  s3SecretKey: string;
};

let cachedConfig: WorkerRuntimeConfig | null = null;

function requireNonEmpty(value: string | undefined, name: string, fallback?: string) {
  const normalized = value?.trim() || fallback;

  if (!normalized) {
    throw new Error(`${name} is required`);
  }

  return normalized;
}

export function loadWorkerRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): WorkerRuntimeConfig {
  return {
    databaseUrl: requireNonEmpty(
      env.DATABASE_URL,
      'DATABASE_URL',
      'postgresql://proofmark:proofmark@127.0.0.1:55432/proofmark'
    ),
    nodeEnv: env.NODE_ENV?.trim() || 'development',
    s3AccessKey: requireNonEmpty(env.S3_ACCESS_KEY, 'S3_ACCESS_KEY', 'minioadmin'),
    s3Bucket: requireNonEmpty(env.S3_BUCKET, 'S3_BUCKET', 'proofmark-local'),
    s3Endpoint: requireNonEmpty(
      env.S3_ENDPOINT,
      'S3_ENDPOINT',
      'http://localhost:59000'
    ),
    s3ForcePathStyle: (env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    s3Region: requireNonEmpty(env.S3_REGION, 'S3_REGION', 'us-east-1'),
    s3SecretKey: requireNonEmpty(env.S3_SECRET_KEY, 'S3_SECRET_KEY', 'minioadmin')
  };
}

export function getWorkerRuntimeConfig() {
  cachedConfig ??= loadWorkerRuntimeConfig();
  return cachedConfig;
}

export function resetWorkerRuntimeConfigForTests() {
  cachedConfig = null;
}
