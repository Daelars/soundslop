import path from 'path';

import Database from 'better-sqlite3';
import { and, asc, eq, isNull, like, or } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { v4 as uuid } from 'uuid';

import {
  ensureDesktopDatabaseInitialized,
  getDatabasePath,
} from '@/lib/database-path';
import * as schema from '@/lib/schema';

const databasePath = getDatabasePath();
ensureDesktopDatabaseInitialized(databasePath);
const sqlite = new Database(databasePath);

sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    directory TEXT,
    format TEXT,
    duration REAL,
    sample_rate INTEGER,
    bit_depth INTEGER,
    channels INTEGER,
    file_size INTEGER,
    mtime_ms INTEGER,
    is_favorite INTEGER DEFAULT 0,
    removed_at TEXT,
    last_scanned_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS file_tags (
    file_id TEXT NOT NULL,
    tag_id TEXT NOT NULL,
    PRIMARY KEY (file_id, tag_id),
    FOREIGN KEY (file_id) REFERENCES files(id),
    FOREIGN KEY (tag_id) REFERENCES tags(id)
  );

  CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS file_collections (
    file_id TEXT NOT NULL,
    collection_id TEXT NOT NULL,
    PRIMARY KEY (file_id, collection_id),
    FOREIGN KEY (file_id) REFERENCES files(id),
    FOREIGN KEY (collection_id) REFERENCES collections(id)
  );
`);

function ensureColumn(tableName: string, columnName: string, definition: string) {
  const columns = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;

  if (!columns.some((column) => column.name === columnName)) {
    sqlite.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
  }
}

ensureColumn('files', 'mtime_ms', 'mtime_ms INTEGER');
ensureColumn('files', 'removed_at', 'removed_at TEXT');
ensureColumn('files', 'last_scanned_at', 'last_scanned_at TEXT');
ensureColumn('files', 'directory', 'directory TEXT');

sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_files_filename ON files(filename)`);
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_files_removed_at ON files(removed_at)`);
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_files_is_favorite ON files(is_favorite)`);
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_files_directory ON files(directory)`);
sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_files_last_scanned_at ON files(last_scanned_at)`);

export const db = drizzle(sqlite, { schema });

export type FileRecord = typeof schema.files.$inferSelect;
export type TagRecord = typeof schema.tags.$inferSelect;
export type CollectionRecord = typeof schema.collections.$inferSelect;

export function getLibraryRoot() {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, 'libraryRoot')).get();
  return row?.value ?? null;
}

export function setLibraryRoot(libraryRoot: string) {
  db.insert(schema.settings)
    .values({ key: 'libraryRoot', value: libraryRoot, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value: libraryRoot, updatedAt: new Date().toISOString() },
    })
    .run();
}

export function clearLibraryData() {
  db.delete(schema.fileTags).run();
  db.delete(schema.fileCollections).run();
  db.delete(schema.tags).run();
  db.delete(schema.collections).run();
  db.delete(schema.files).run();
}

export function getLibraryStats() {
  const activeRow = sqlite.prepare('SELECT COUNT(*) as count FROM files WHERE removed_at IS NULL').get() as { count: number };
  const removedRow = sqlite.prepare('SELECT COUNT(*) as count FROM files WHERE removed_at IS NOT NULL').get() as { count: number };

  return {
    activeFiles: activeRow.count,
    removedFiles: removedRow.count,
  };
}

export function getUniqueDirectories() {
  const rows = sqlite.prepare("SELECT DISTINCT directory FROM files WHERE directory IS NOT NULL AND removed_at IS NULL ORDER BY directory ASC").all() as Array<{ directory: string }>;
  return rows.map(r => r.directory);
}

export function getSubdirectories(parentDir: string | null) {
  // parentDir is like "Drums" or null for root
  const allDirs = getUniqueDirectories();
  const subdirs = new Set<string>();

  for (const dir of allDirs) {
    if (parentDir === null) {
      // Get top-level directories
      const firstPart = dir.split(/[\\/]/)[0];
      if (firstPart) subdirs.add(firstPart);
    } else {
      // Get direct children of parentDir
      const normalizedParent = parentDir.replace(/\\/g, "/");
      const normalizedDir = dir.replace(/\\/g, "/");
      
      if (normalizedDir.startsWith(normalizedParent + "/")) {
        const remaining = normalizedDir.slice(normalizedParent.length + 1);
        const nextPart = remaining.split("/")[0];
        if (nextPart) subdirs.add(parentDir + "/" + nextPart);
      }
    }
  }

  return Array.from(subdirs).sort();
}

export function getFiles(options?: {
  query?: string;
  favorites?: boolean;
  collectionId?: string | null;
  directory?: string | null;
  showRemoved?: boolean;
  limit?: number;
  offset?: number;
}) {
  const { query, favorites, collectionId, directory, showRemoved, limit = 500, offset = 0 } = options ?? {};

  if (collectionId) {
    const collectionFilters = [eq(schema.fileCollections.collectionId, collectionId)];

    if (!showRemoved) {
      collectionFilters.push(isNull(schema.files.removedAt));
    }

    const rows = db
      .select({
        id: schema.files.id,
        path: schema.files.path,
        filename: schema.files.filename,
        directory: schema.files.directory,
        format: schema.files.format,
        duration: schema.files.duration,
        sampleRate: schema.files.sampleRate,
        bitDepth: schema.files.bitDepth,
        channels: schema.files.channels,
        fileSize: schema.files.fileSize,
        isFavorite: schema.files.isFavorite,
        removedAt: schema.files.removedAt,
      })
      .from(schema.fileCollections)
      .innerJoin(schema.files, eq(schema.fileCollections.fileId, schema.files.id))
      .where(and(...collectionFilters))
      .orderBy(asc(schema.files.filename))
      .all();

    return rows.map((row) => row);
  }

  const filters = [];

  if (!showRemoved) {
    filters.push(isNull(schema.files.removedAt));
  }

  if (favorites) {
    filters.push(eq(schema.files.isFavorite, true));
  }

  if (query) {
    filters.push(like(schema.files.filename, `%${query}%`));
  }
  
  if (directory) {
    filters.push(or(
      eq(schema.files.directory, directory),
      eq(schema.files.directory, directory.replace(/\//g, '\\')),
      eq(schema.files.directory, directory.replace(/\\/g, '/')),
    ));
  }

  return db
    .select({
      id: schema.files.id,
      path: schema.files.path,
      filename: schema.files.filename,
      directory: schema.files.directory,
      format: schema.files.format,
      duration: schema.files.duration,
      sampleRate: schema.files.sampleRate,
      bitDepth: schema.files.bitDepth,
      channels: schema.files.channels,
      fileSize: schema.files.fileSize,
      isFavorite: schema.files.isFavorite,
      removedAt: schema.files.removedAt,
    })
    .from(schema.files)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(asc(schema.files.filename))
    .limit(limit)
    .offset(offset)
    .all();
}

export function getFileCount(options?: {
  query?: string;
  favorites?: boolean;
  collectionId?: string | null;
  showRemoved?: boolean;
}) {
  const { query, favorites, collectionId, showRemoved } = options ?? {};

  if (collectionId) {
    const filters = [eq(schema.fileCollections.collectionId, collectionId)];
    if (!showRemoved) filters.push(isNull(schema.files.removedAt));

    const result = sqlite
      .prepare(
        `SELECT COUNT(*) as count 
         FROM file_collections 
         JOIN files ON file_collections.file_id = files.id 
         WHERE file_collections.collection_id = ? 
         ${!showRemoved ? "AND files.removed_at IS NULL" : ""}`
      )
      .get(collectionId) as { count: number };
    return result.count;
  }

  const filters = [];
  if (!showRemoved) filters.push("removed_at IS NULL");
  if (favorites) filters.push("is_favorite = 1");
  if (query) filters.push("filename LIKE ?");

  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const queryParam = query ? `%${query}%` : null;

  const sql = `SELECT COUNT(*) as count FROM files ${whereClause}`;
  const result = queryParam
    ? (sqlite.prepare(sql).get(queryParam) as { count: number })
    : (sqlite.prepare(sql).get() as { count: number });

  return result.count;
}

export function getAllFilesIncludingRemoved() {
  return db
    .select({
      id: schema.files.id,
      path: schema.files.path,
      filename: schema.files.filename,
      directory: schema.files.directory,
      format: schema.files.format,
      duration: schema.files.duration,
      sampleRate: schema.files.sampleRate,
      bitDepth: schema.files.bitDepth,
      channels: schema.files.channels,
      fileSize: schema.files.fileSize,
      isFavorite: schema.files.isFavorite,
      removedAt: schema.files.removedAt,
    })
    .from(schema.files)
    .all();
}

export function getFileById(id: string) {
  return db.select().from(schema.files).where(eq(schema.files.id, id)).get() ?? null;
}

export function getFileByPath(filePath: string) {
  return db.select().from(schema.files).where(eq(schema.files.path, filePath)).get() ?? null;
}

export function upsertFile(record: {
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
}) {
  db.insert(schema.files)
    .values({
      id: uuid(),
      path: record.path,
      filename: record.filename,
      directory: record.directory,
      format: record.format,
      duration: record.duration,
      sampleRate: record.sampleRate,
      bitDepth: record.bitDepth,
      channels: record.channels,
      fileSize: record.fileSize,
      mtimeMs: record.mtimeMs,
      removedAt: record.removedAt,
      lastScannedAt: record.lastScannedAt,
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: schema.files.path,
      set: {
        filename: record.filename,
        directory: record.directory,
        format: record.format,
        duration: record.duration,
        sampleRate: record.sampleRate,
        bitDepth: record.bitDepth,
        channels: record.channels,
        fileSize: record.fileSize,
        mtimeMs: record.mtimeMs,
        removedAt: record.removedAt,
        lastScannedAt: record.lastScannedAt,
        updatedAt: new Date().toISOString(),
      },
    })
    .run();
}

export function touchFileAsSeen(pathValue: string, lastScannedAt: string) {
  db.update(schema.files)
    .set({ removedAt: null, lastScannedAt, updatedAt: new Date().toISOString() })
    .where(eq(schema.files.path, pathValue))
    .run();
}

export function batchTouchFiles(entries: { path: string; lastScannedAt: string }[], now: string) {
  if (entries.length === 0) return;
  const stmt = sqlite.prepare(
    "UPDATE files SET removed_at = NULL, last_scanned_at = ?, updated_at = ? WHERE path = ?",
  );
  const txn = sqlite.transaction((entries) => {
    for (const e of entries) {
      stmt.run(now, now, e.path);
    }
  });
  txn(entries);
}

export function batchUpsertFiles(records: Array<{
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
}>, now: string) {
  if (records.length === 0) return;
  const stmt = sqlite.prepare(
    `INSERT INTO files (id, path, filename, directory, format, duration, sample_rate, bit_depth, channels, file_size, mtime_ms, removed_at, last_scanned_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       filename=excluded.filename, directory=excluded.directory, format=excluded.format,
       duration=excluded.duration, sample_rate=excluded.sample_rate, bit_depth=excluded.bit_depth,
       channels=excluded.channels, file_size=excluded.file_size, mtime_ms=excluded.mtime_ms,
       removed_at=excluded.removed_at, last_scanned_at=excluded.last_scanned_at, updated_at=excluded.updated_at`,
  );
  const txn = sqlite.transaction((records) => {
    for (const r of records) {
      stmt.run(
        uuid(), r.path, r.filename, r.directory, r.format, r.duration,
        r.sampleRate, r.bitDepth, r.channels, r.fileSize, r.mtimeMs,
        r.removedAt, r.lastScannedAt, now,
      );
    }
  });
  txn(records);
}

export function markFileRemoved(pathValue: string, removedAt: string) {
  db.update(schema.files)
    .set({ removedAt, updatedAt: new Date().toISOString() })
    .where(and(eq(schema.files.path, pathValue), isNull(schema.files.removedAt)))
    .run();
}

export function batchMarkRemoved(paths: string[], removedAt: string, now: string) {
  if (paths.length === 0) return;
  const stmt = sqlite.prepare(
    "UPDATE files SET removed_at = ?, updated_at = ? WHERE path = ? AND removed_at IS NULL",
  );
  const txn = sqlite.transaction((paths) => {
    for (const p of paths) {
      stmt.run(removedAt, now, p);
    }
  });
  txn(paths);
}

export function reconcileMovedFiles() {
  const removedFiles = sqlite
    .prepare(
      `SELECT id, filename, file_size as fileSize, duration, is_favorite as isFavorite
       FROM files
       WHERE removed_at IS NOT NULL`,
    )
    .all() as Array<{
      id: string;
      filename: string;
      fileSize: number | null;
      duration: number | null;
      isFavorite: number | boolean | null;
    }>;

  const findActiveMatch = sqlite.prepare(
    `SELECT id
     FROM files
     WHERE removed_at IS NULL
       AND filename = ?
       AND COALESCE(file_size, -1) = COALESCE(?, -1)
       AND ABS(COALESCE(duration, -1) - COALESCE(?, -1)) < 0.01`,
  );
  const copyCollections = sqlite.prepare(
    `INSERT OR IGNORE INTO file_collections (file_id, collection_id)
     SELECT ?, collection_id FROM file_collections WHERE file_id = ?`,
  );
  const copyTags = sqlite.prepare(
    `INSERT OR IGNORE INTO file_tags (file_id, tag_id)
     SELECT ?, tag_id FROM file_tags WHERE file_id = ?`,
  );
  const preserveFavorite = sqlite.prepare(
    `UPDATE files SET is_favorite = 1 WHERE id = ?`,
  );
  const deleteOldCollections = sqlite.prepare(`DELETE FROM file_collections WHERE file_id = ?`);
  const deleteOldTags = sqlite.prepare(`DELETE FROM file_tags WHERE file_id = ?`);
  const deleteOldFile = sqlite.prepare(`DELETE FROM files WHERE id = ?`);

  const reconcile = sqlite.transaction(() => {
    let relinked = 0;

    for (const removedFile of removedFiles) {
      const matches = findActiveMatch.all(
        removedFile.filename,
        removedFile.fileSize,
        removedFile.duration,
      ) as Array<{ id: string }>;

      if (matches.length !== 1) {
        continue;
      }

      const activeFileId = matches[0].id;
      copyCollections.run(activeFileId, removedFile.id);
      copyTags.run(activeFileId, removedFile.id);

      if (Boolean(removedFile.isFavorite)) {
        preserveFavorite.run(activeFileId);
      }

      deleteOldCollections.run(removedFile.id);
      deleteOldTags.run(removedFile.id);
      deleteOldFile.run(removedFile.id);
      relinked += 1;
    }

    return relinked;
  });

  return reconcile();
}

export function toggleFavorite(id: string) {
  const file = getFileById(id);

  if (!file) {
    return false;
  }

  db.update(schema.files)
    .set({ isFavorite: !file.isFavorite, updatedAt: new Date().toISOString() })
    .where(eq(schema.files.id, id))
    .run();

  return true;
}

export function getAllTags() {
  return db.select().from(schema.tags).orderBy(asc(schema.tags.name)).all();
}

export function getTagsForFile(fileId: string) {
  const rows = db
    .select({ tag: schema.tags })
    .from(schema.fileTags)
    .innerJoin(schema.tags, eq(schema.fileTags.tagId, schema.tags.id))
    .where(eq(schema.fileTags.fileId, fileId))
    .orderBy(asc(schema.tags.name))
    .all();

  return rows.map((row) => row.tag);
}

export function createTag(name: string) {
  const id = uuid();
  db.insert(schema.tags).values({ id, name }).run();
  return id;
}

export function attachTagToFile(fileId: string, tagId: string) {
  db.insert(schema.fileTags).values({ fileId, tagId }).onConflictDoNothing().run();
}

export function detachTagFromFile(fileId: string, tagId: string) {
  db.delete(schema.fileTags).where(and(eq(schema.fileTags.fileId, fileId), eq(schema.fileTags.tagId, tagId))).run();
}

export function getAllCollections() {
  return sqlite
    .prepare(
      `SELECT
        collections.id,
        collections.name,
        collections.created_at as createdAt,
        COUNT(files.id) as fileCount
      FROM collections
      LEFT JOIN file_collections ON file_collections.collection_id = collections.id
      LEFT JOIN files ON files.id = file_collections.file_id AND files.removed_at IS NULL
      GROUP BY collections.id
      ORDER BY collections.name ASC`,
    )
    .all() as Array<{ id: string; name: string; createdAt: string | null; fileCount: number }>;
}

export function createCollection(name: string) {
  const id = uuid();
  db.insert(schema.collections).values({ id, name }).run();
  return id;
}

export function deleteCollection(collectionId: string) {
  db.delete(schema.fileCollections).where(eq(schema.fileCollections.collectionId, collectionId)).run();
  db.delete(schema.collections).where(eq(schema.collections.id, collectionId)).run();
}

export function attachFileToCollection(fileId: string, collectionId: string) {
  db.insert(schema.fileCollections).values({ fileId, collectionId }).onConflictDoNothing().run();
}

export function detachFileFromCollection(fileId: string, collectionId: string) {
  db.delete(schema.fileCollections)
    .where(and(eq(schema.fileCollections.fileId, fileId), eq(schema.fileCollections.collectionId, collectionId)))
    .run();
}
