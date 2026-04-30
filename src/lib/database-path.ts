import fs from "fs";
import os from "os";
import path from "path";

const DATABASE_FILENAME = "foleyard.sqlite";
const LEGACY_DATABASE_FILENAMES = ["soundslop.sqlite"];
const DESKTOP_APP_NAME = "Foleyard";
const LEGACY_DESKTOP_APP_NAMES = ["SoundSlop"];
const DESKTOP_ENV_KEYS = ["FOLEYARD_DESKTOP", "SOUNDSLOP_DESKTOP"];

export function isDesktopDatabaseMode() {
  return DESKTOP_ENV_KEYS.some((key) => process.env[key] === "1");
}

function getProjectDatabasePath(filename = DATABASE_FILENAME) {
  return path.join(process.cwd(), filename);
}

function getLegacyProjectDatabasePaths() {
  return LEGACY_DATABASE_FILENAMES.map((filename) => path.join(process.cwd(), filename));
}

export function getDesktopUserDataDir() {
  const appDataDir = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appDataDir, DESKTOP_APP_NAME);
}

function getLegacyDesktopUserDataDirs() {
  const appDataDir = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  return LEGACY_DESKTOP_APP_NAMES.map((name) => path.join(appDataDir, name));
}

export function getDatabasePath() {
  if (isDesktopDatabaseMode()) {
    return path.join(getDesktopUserDataDir(), DATABASE_FILENAME);
  }

  return getProjectDatabasePath();
}

export function ensureDesktopDatabaseInitialized(databasePath = getDatabasePath()) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  if (fs.existsSync(databasePath)) {
    return;
  }

  const candidatePaths = isDesktopDatabaseMode()
    ? [
        getProjectDatabasePath(),
        ...getLegacyProjectDatabasePaths(),
        ...getLegacyDesktopUserDataDirs().flatMap((dir) => [
          path.join(dir, DATABASE_FILENAME),
          ...LEGACY_DATABASE_FILENAMES.map((filename) => path.join(dir, filename)),
        ]),
      ]
    : getLegacyProjectDatabasePaths();

  for (const candidatePath of candidatePaths) {
    if (candidatePath !== databasePath && fs.existsSync(candidatePath)) {
      fs.copyFileSync(candidatePath, databasePath);
      return;
    }
  }
}
