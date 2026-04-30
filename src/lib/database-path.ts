import fs from "fs";
import os from "os";
import path from "path";

const DATABASE_FILENAME = "soundslop.sqlite";
const DESKTOP_APP_NAME = "SoundSlop";

export function isDesktopDatabaseMode() {
  return process.env.SOUNDSLOP_DESKTOP === "1";
}

export function getLegacyDatabasePath() {
  return path.join(process.cwd(), DATABASE_FILENAME);
}

export function getDesktopUserDataDir() {
  const appDataDir = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appDataDir, DESKTOP_APP_NAME);
}

export function getDatabasePath() {
  if (isDesktopDatabaseMode()) {
    return path.join(getDesktopUserDataDir(), DATABASE_FILENAME);
  }

  return getLegacyDatabasePath();
}

export function ensureDesktopDatabaseInitialized(databasePath = getDatabasePath()) {
  if (!isDesktopDatabaseMode()) {
    return;
  }

  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  if (fs.existsSync(databasePath)) {
    return;
  }

  const legacyDatabasePath = getLegacyDatabasePath();
  if (legacyDatabasePath !== databasePath && fs.existsSync(legacyDatabasePath)) {
    fs.copyFileSync(legacyDatabasePath, databasePath);
  }
}
