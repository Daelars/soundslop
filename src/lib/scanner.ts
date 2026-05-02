import fs from 'fs/promises';
import path from 'path';

import {
  getAllFilesIncludingRemoved,
  getLibraryRoot,
  getLibraryStats,
  getFileByPath,
  batchMarkRemoved,
  batchTouchFiles,
  batchUpsertFiles,
  reconcileMovedFiles,
  setLibraryRoot,
} from '@/lib/db';
import { extractMetadata } from '@/lib/metadata';

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

async function existsReadableDirectory(dirPath: string) {
  const stat = await fs.stat(dirPath);
  if (!stat.isDirectory()) {
    throw new Error('Path is not a directory');
  }

  await fs.access(dirPath);
}

async function collectAudioFiles(rootPath: string, onDiscover?: (filePath: string) => void) {
  const found: string[] = [];
  const dirsToProcess: string[] = [rootPath];

  while (dirsToProcess.length > 0) {
    const currentPath = dirsToProcess.pop()!;
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    const subdirs: string[] = [];
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        subdirs.push(fullPath);
      } else if (entry.isFile()) {
        const extension = path.extname(entry.name).toLowerCase();
        if (AUDIO_EXTENSIONS.has(extension)) {
          files.push(fullPath);
        }
      }
    }

    for (const filePath of files) {
      found.push(filePath);
      onDiscover?.(filePath);
    }

    dirsToProcess.push(...subdirs);
  }

  return found;
}

export async function validateLibraryRoot(inputPath: string): Promise<PathValidation> {
  const normalizedPath = path.resolve(inputPath.trim());

  try {
    await existsReadableDirectory(normalizedPath);
    const files = await collectAudioFiles(normalizedPath);

    return {
      valid: true,
      normalizedPath,
      readable: true,
      audioFileCount: files.length,
      samples: files.slice(0, 5).map((filePath) => path.relative(normalizedPath, filePath)),
      error: null,
    };
  } catch (error) {
    return {
      valid: false,
      normalizedPath,
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
    libraryRoot: scanStatus.libraryRoot ?? getLibraryRoot(),
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

  const libraryRoot = getLibraryRoot();
  if (!libraryRoot) {
    return { started: false, reason: 'missing-root', status: getScanStatus() };
  }

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
    if (!validation.valid || !validation.normalizedPath) {
      throw new Error(validation.error ?? 'Invalid library root');
    }

    const normalizedRoot = validation.normalizedPath;
    scanStatus.phase = 'discovering';

    const discoveredFiles = await collectAudioFiles(normalizedRoot, () => {
      scanStatus.discovered += 1;
      scanStatus.total = scanStatus.discovered;
    });

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
      const touchEntries: { path: string; lastScannedAt: string }[] = [];
      const upsertRecords: Array<{
        path: string;
        filename: string;
        directory: string | null;
        format: string | null;
        duration: number | null;
        sampleRate: number | null;
        bitDepth: number | null;
        channels: number | null;
        fileSize: number | null;
        mtimeMs: number;
        removedAt: string | null;
        lastScannedAt: string;
      }> = [];

      await Promise.all(chunk.map(async (filePath) => {
        seenPaths.add(filePath);

        try {
          const stats = await fs.stat(filePath);
          const existing = getFileByPath(filePath);
          const changed =
            !existing ||
            existing.fileSize !== stats.size ||
            existing.mtimeMs !== Math.trunc(stats.mtimeMs) ||
            existing.removedAt !== null ||
            existing.directory === null ||
            existing.directory === undefined;

          if (!changed && existing) {
            touchEntries.push({ path: filePath, lastScannedAt: now });
            return;
          }

          const metadata = await extractMetadata(filePath);

          const directory = path.relative(normalizedRoot, path.dirname(filePath));
          const dir = directory === '.' ? '' : directory;
          upsertRecords.push({
            path: filePath,
            filename: metadata.filename,
            directory: dir || null,
            format: metadata.format,
            duration: metadata.duration,
            sampleRate: metadata.sampleRate,
            bitDepth: metadata.bitDepth,
            channels: metadata.channels,
            fileSize: metadata.fileSize,
            mtimeMs: Math.trunc(stats.mtimeMs),
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

      batchTouchFiles(touchEntries, now);
      batchUpsertFiles(upsertRecords, now);
    }

    scanStatus.phase = 'cleaning';
    const removedAt = new Date().toISOString();
    const removedPaths: string[] = [];

    for (const file of allExistingFiles) {
      if (seenPaths.has(file.path) || file.removedAt !== null) {
        continue;
      }

      removedPaths.push(file.path);
      scanStatus.removed += 1;
    }

    batchMarkRemoved(removedPaths, removedAt, now);

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
