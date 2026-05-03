import fs from 'fs';
import path from 'path';

import { PutObjectCommand } from '@aws-sdk/client-s3';

import { getR2Client, getR2Config, normalizeR2Key, normalizeR2Prefix } from '../src/lib/r2';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.aiff', '.m4a', '.aac']);
const MAX_UPLOAD_ATTEMPTS = 4;

type UploadItem = {
  localPath: string;
  key: string;
  size: number;
};

function getArg(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function usage() {
  console.log('Usage: bun run upload:r2 -- --root "P:\\SoundLibrary" [--prefix audio]');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function uploadFile(client: ReturnType<typeof getR2Client>, bucketName: string, file: UploadItem) {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      const body = await fs.promises.readFile(file.localPath);

      await client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: file.key,
        Body: body,
        ContentLength: file.size,
      }));

      return;
    } catch (error) {
      lastError = error;

      if (attempt < MAX_UPLOAD_ATTEMPTS) {
        await sleep(500 * attempt);
      }
    }
  }

  throw lastError;
}

async function collectAudioFiles(root: string, prefix: string) {
  const items: UploadItem[] = [];
  const dirs = [root];

  while (dirs.length > 0) {
    const current = dirs.pop()!;
    const entries = await fs.promises.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        dirs.push(fullPath);
        continue;
      }

      if (!entry.isFile() || !AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }

      const relativePath = normalizeR2Key(path.relative(root, fullPath));
      const stat = await fs.promises.stat(fullPath);

      items.push({
        localPath: fullPath,
        key: `${prefix}${relativePath}`,
        size: stat.size,
      });
    }
  }

  return items;
}

async function main() {
  const rootArg = getArg('--root');

  if (!rootArg) {
    usage();
    process.exitCode = 1;
    return;
  }

  const root = path.resolve(rootArg);
  const stat = await fs.promises.stat(root);

  if (!stat.isDirectory()) {
    throw new Error(`Root is not a directory: ${root}`);
  }

  const config = getR2Config();
  const prefix = normalizeR2Prefix(getArg('--prefix') ?? config.prefix);
  const client = getR2Client();
  const files = await collectAudioFiles(root, prefix);

  console.log(`Uploading ${files.length} audio files to r2://${config.bucketName}/${prefix}`);

  const concurrency = 6;
  let uploaded = 0;
  let failed = 0;

  for (let index = 0; index < files.length; index += concurrency) {
    const chunk = files.slice(index, index + concurrency);

    await Promise.all(chunk.map(async (file) => {
      try {
        await uploadFile(client, config.bucketName, file);

        uploaded += 1;
      } catch (error) {
        failed += 1;
        console.error(`Failed: ${file.localPath}`);
        console.error(error instanceof Error ? error.message : error);
      }
    }));

    console.log(`Progress: ${uploaded + failed}/${files.length} uploaded=${uploaded} failed=${failed}`);
  }

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
