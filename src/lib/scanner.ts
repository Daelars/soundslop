import path from 'path';

import {
  getAllFilesIncludingRemoved,
  getLibraryRoot,
  getLibraryStats,
  getFileByPath,
  markFileRemoved,
  reconcileMovedFiles,
  setLibraryRoot,
  touchFileAsSeen,
  upsertFile,
} from '@/lib/db';
import { extractR2Metadata } from '@/lib/metadata';
import { getDefaultR2LibraryRoot, getR2Config, listR2AudioObjects, normalizeR2Prefix } from '@/lib/r2';

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.ogg', '.flac', '.aiff', '.m4a', '.aac']);

export type ScanPhase = 'idle' | 'validating' | 'discovering' | 'indexing' | 'cleaning' | 'complete' | 'error';

export type ScanStatus = {
  running: boolean;
  phase: ScanPhase;
  discovered: number;
  added: number;
  updated: number;
  removed: number;
  failed: number;
  total: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  libraryRoot: string | null;
  lastScanSummary: {
    discovered: number;
    added: number;
    updated: number;
    removed: number;
    failed: number;
    finishedAt: string | null;
  } | null;
};

export type PathValidation = {
  valid: boolean;
  normalizedPath: string | null;
  readable: boolean;
  audioFileCount: number;
  samples: string[];
  error: string | null;
};

const scanStatus: ScanStatus = {
  running: false,
  phase: 'idle',
  discovered: 0,
  added: 0,
  updated: 0,
  removed: 0,
  failed: 0,
  total: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
  libraryRoot: null,
  lastScanSummary: null,
};

let activeScan: Promise<void> | null = null;

function isAudioKey(key: string) {
  return AUDIO_EXTENSIONS.has(path.posix.extname(key).toLowerCase());
}

export async function validateLibraryRoot(inputPath: string): Promise<PathValidation> {
  try {
    const normalizedPath = normalizeR2Prefix(inputPath.trim() || getR2Config().prefix);
    const files = await listR2AudioObjects(normalizedPath, isAudioKey);

    return {
      valid: true,
      normalizedPath,
      readable: true,
      audioFileCount: files.length,
      samples: files.slice(0, 5).map((file) => file.key),
      error: null,
    };
  } catch (error) {
    return {
      valid: false,
      normalizedPath: null,
      readable: false,
      audioFileCount: 0,
      samples: [],
      error: error instanceof Error ? error.message : 'Validation failed',
    };
  }
}

export function getScanStatus() {
  return {
    ...scanStatus,
    libraryRoot: scanStatus.libraryRoot ?? getLibraryRoot() ?? getDefaultR2LibraryRoot(),
    stats: getLibraryStats(),
  };
}

export function saveLibraryRoot(libraryRoot: string) {
  setLibraryRoot(libraryRoot);
}

export function startScan() {
  if (scanStatus.running) {
    return { started: false, reason: 'already-running', status: getScanStatus() };
  }

  const libraryRoot = getLibraryRoot() ?? '';

  activeScan = runScan(libraryRoot);
  void activeScan.finally(() => {
    activeScan = null;
  });

  return { started: true, status: getScanStatus() };
}

async function runScan(libraryRoot: string) {
  scanStatus.running = true;
  scanStatus.phase = 'validating';
  scanStatus.discovered = 0;
  scanStatus.added = 0;
  scanStatus.updated = 0;
  scanStatus.removed = 0;
  scanStatus.failed = 0;
  scanStatus.total = 0;
  scanStatus.startedAt = new Date().toISOString();
  scanStatus.finishedAt = null;
  scanStatus.error = null;
  scanStatus.libraryRoot = libraryRoot;

  try {
    const validation = await validateLibraryRoot(libraryRoot);
    if (!validation.valid || validation.normalizedPath === null) {
      throw new Error(validation.error ?? 'Invalid library root');
    }

    const normalizedRoot = validation.normalizedPath ?? '';
    scanStatus.phase = 'discovering';

    const discoveredFiles = await listR2AudioObjects(normalizedRoot, isAudioKey);
    scanStatus.discovered = discoveredFiles.length;
    scanStatus.total = discoveredFiles.length;

    scanStatus.phase = 'indexing';
    const seenPaths = new Set<string>();
    const allExistingFiles = getAllFilesIncludingRemoved();
    const now = new Date().toISOString();

    const CONCURRENCY = 8;
    const chunks = [];
    for (let i = 0; i < discoveredFiles.length; i += CONCURRENCY) {
      chunks.push(discoveredFiles.slice(i, i + CONCURRENCY));
    }

    for (const chunk of chunks) {
      await Promise.all(chunk.map(async (file) => {
        seenPaths.add(file.key);

        try {
          const existing = getFileByPath(file.key);
          const mtimeMs = file.lastModified?.getTime() ?? 0;
          const changed =
            !existing ||
            existing.fileSize !== file.size ||
            existing.mtimeMs !== mtimeMs ||
            existing.removedAt !== null ||
            existing.directory === null ||
            existing.directory === undefined;

          if (!changed && existing) {
            touchFileAsSeen(file.key, now);
            return;
          }

          const metadata = await extractR2Metadata(file.key, file.size);
          const relativeKey = normalizedRoot && file.key.startsWith(normalizedRoot)
            ? file.key.slice(normalizedRoot.length)
            : file.key;
          const directory = path.posix.dirname(relativeKey);
          const dir = directory === '.' ? '' : directory;
          upsertFile({
            path: file.key,
            filename: metadata.filename,
            directory: dir || null,
            format: metadata.format,
            duration: metadata.duration,
            sampleRate: metadata.sampleRate,
            bitDepth: metadata.bitDepth,
            channels: metadata.channels,
            fileSize: metadata.fileSize,
            mtimeMs,
            removedAt: null,
            lastScannedAt: now,
          });

          if (existing) {
            scanStatus.updated += 1;
          } else {
            scanStatus.added += 1;
          }
        } catch {
          scanStatus.failed += 1;
        }
      }));
    }

    scanStatus.phase = 'cleaning';
    const removedAt = new Date().toISOString();

    for (const file of allExistingFiles) {
      if (seenPaths.has(file.path) || file.removedAt !== null) {
        continue;
      }

      markFileRemoved(file.path, removedAt);
      scanStatus.removed += 1;
    }

    const relinkedFiles = reconcileMovedFiles();
    scanStatus.removed = Math.max(0, scanStatus.removed - relinkedFiles);

    scanStatus.phase = 'complete';
    scanStatus.finishedAt = new Date().toISOString();
    scanStatus.lastScanSummary = {
      discovered: scanStatus.discovered,
      added: scanStatus.added,
      updated: scanStatus.updated,
      removed: scanStatus.removed,
      failed: scanStatus.failed,
      finishedAt: scanStatus.finishedAt,
    };
  } catch (error) {
    scanStatus.phase = 'error';
    scanStatus.finishedAt = new Date().toISOString();
    scanStatus.error = error instanceof Error ? error.message : 'Scan failed';
  } finally {
    scanStatus.running = false;
  }
}
