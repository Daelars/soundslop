import { open, stat } from 'fs/promises';
import * as mm from 'music-metadata';
import * as path from 'path';

export interface AudioMetadata {
  filename: string;
  format: string | null;
  duration: number | null;
  sampleRate: number | null;
  bitDepth: number | null;
  channels: number | null;
  fileSize: number | null;
}

const HEADER_READ_BYTES = 32768;

const MIME_TYPES: Record<string, string> = {
  aac: 'audio/aac',
  aiff: 'audio/aiff',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
};

function toAudioMetadata(
  metadata: mm.IAudioMetadata,
  filename: string,
  format: string | null,
  fileSize: number,
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

function needsFullParse(metadata: mm.IAudioMetadata, format: string | null) {
  if (metadata.format.duration == null) {
    return true;
  }

  if (metadata.format.sampleRate == null || metadata.format.numberOfChannels == null) {
    return true;
  }

  return ['wav', 'flac', 'aiff'].includes(format ?? '') && metadata.format.bitsPerSample == null;
}

async function parseHeader(filePath: string, fileSize: number, format: string | null) {
  const file = await open(filePath, 'r');

  try {
    const headerSize = Math.min(fileSize, HEADER_READ_BYTES);
    const header = Buffer.allocUnsafe(headerSize);
    const { bytesRead } = await file.read(header, 0, headerSize, 0);

    return await mm.parseBuffer(
      header.subarray(0, bytesRead),
      { mimeType: format ? MIME_TYPES[format] : undefined, path: filePath, size: fileSize },
      { skipCovers: true },
    );
  } finally {
    await file.close();
  }
}

export async function extractMetadata(filePath: string): Promise<AudioMetadata> {
  const stats = await stat(filePath);
  const filename = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase().slice(1) || null;

  try {
    const headerMetadata = await parseHeader(filePath, stats.size, ext);

    if (!needsFullParse(headerMetadata, ext)) {
      return toAudioMetadata(headerMetadata, filename, ext, stats.size);
    }

    const fullMetadata = await mm.parseFile(filePath, { duration: true, skipCovers: true });
    return toAudioMetadata(fullMetadata, filename, ext, stats.size);
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
