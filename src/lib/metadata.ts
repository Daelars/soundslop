import * as mm from 'music-metadata';
import * as fs from 'fs';
import * as path from 'path';

import { getR2Object } from '@/lib/r2';

export interface AudioMetadata {
  filename: string;
  format: string | null;
  duration: number | null;
  sampleRate: number | null;
  bitDepth: number | null;
  channels: number | null;
  fileSize: number | null;
}

const HEADER_READ_BYTES = 32 * 1024;

function metadataFromParsedFile(
  filename: string,
  format: string | null,
  fileSize: number | null,
  metadata: mm.IAudioMetadata,
): AudioMetadata {
  return {
    filename,
    format,
    duration: metadata.format.duration ?? null,
    sampleRate: metadata.format.sampleRate ?? null,
    bitDepth: metadata.format.bitsPerSample ?? null,
    channels: metadata.format.numberOfChannels ?? null,
    fileSize,
  };
}

export async function extractMetadata(filePath: string): Promise<AudioMetadata> {
  const stats = fs.statSync(filePath);
  const filename = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase().slice(1) || null;

  try {
    const metadata = await mm.parseFile(filePath);
    return metadataFromParsedFile(filename, ext, stats.size, metadata);
  } catch {
    return {
      filename,
      format: ext,
      duration: null,
      sampleRate: null,
      bitDepth: null,
      channels: null,
      fileSize: stats.size,
    };
  }
}

export async function extractR2Metadata(key: string, fileSize: number | null): Promise<AudioMetadata> {
  const filename = path.posix.basename(key);
  const ext = path.posix.extname(key).toLowerCase().slice(1) || null;

  try {
    const end = Math.max(0, Math.min(HEADER_READ_BYTES, fileSize ?? HEADER_READ_BYTES) - 1);
    const object = await getR2Object(key, `bytes=0-${end}`);
    const body = object.Body;

    if (!body || typeof body.transformToByteArray !== 'function') {
      throw new Error('R2 object body is not readable');
    }

    const bytes = await body.transformToByteArray();
    const metadata = await mm.parseBuffer(Buffer.from(bytes), undefined, { skipCovers: true });

    return metadataFromParsedFile(filename, ext, fileSize, metadata);
  } catch {
    return {
      filename,
      format: ext,
      duration: null,
      sampleRate: null,
      bitDepth: null,
      channels: null,
      fileSize,
    };
  }
}
