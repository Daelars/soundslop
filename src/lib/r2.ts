import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

const requiredEnv = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
] as const;

export type R2Object = {
  key: string;
  size: number;
  lastModified: Date | null;
  etag: string | null;
};

export function getR2Config() {
  const missing = requiredEnv.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    throw new Error(`Missing R2 env vars: ${missing.join(', ')}`);
  }

  const accountId = process.env.R2_ACCOUNT_ID!;

  return {
    bucketName: process.env.R2_BUCKET_NAME!,
    endpoint: process.env.R2_ENDPOINT ?? `https://${accountId}.r2.cloudflarestorage.com`,
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    prefix: normalizeR2Prefix(process.env.R2_PREFIX ?? ''),
  };
}

export function getR2Client() {
  const config = getR2Config();

  return new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export function normalizeR2Key(key: string) {
  return key.replace(/\\/g, '/').replace(/^\/+/, '');
}

export function normalizeR2Prefix(prefix: string) {
  const normalized = normalizeR2Key(prefix.trim());
  return normalized && !normalized.endsWith('/') ? `${normalized}/` : normalized;
}

export function getDefaultR2LibraryRoot() {
  const prefix = normalizeR2Prefix(process.env.R2_PREFIX ?? '');
  return prefix || 'r2://bucket';
}

export async function listR2AudioObjects(prefix: string, isAudioKey: (key: string) => boolean) {
  const client = getR2Client();
  const config = getR2Config();
  const objects: R2Object[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await client.send(new ListObjectsV2Command({
      Bucket: config.bucketName,
      Prefix: normalizeR2Prefix(prefix),
      ContinuationToken: continuationToken,
    }));

    for (const object of response.Contents ?? []) {
      if (!object.Key || !isAudioKey(object.Key)) {
        continue;
      }

      objects.push({
        key: object.Key,
        size: object.Size ?? 0,
        lastModified: object.LastModified ?? null,
        etag: object.ETag ?? null,
      });
    }

    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return objects;
}

export async function getR2ObjectHead(key: string) {
  const client = getR2Client();
  const config = getR2Config();

  return client.send(new HeadObjectCommand({
    Bucket: config.bucketName,
    Key: normalizeR2Key(key),
  }));
}

export async function getR2Object(key: string, range?: string) {
  const client = getR2Client();
  const config = getR2Config();

  return client.send(new GetObjectCommand({
    Bucket: config.bucketName,
    Key: normalizeR2Key(key),
    Range: range,
  }));
}
