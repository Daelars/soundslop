/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("fs");
const os = require("os");
const path = require("path");

const { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell } = require("electron");

const APP_NAME = "SoundSlop";
const DATABASE_FILENAME = "soundslop.sqlite";
const DEV_SERVER_URL = process.env.ELECTRON_START_URL ?? "http://localhost:3000";

function reportMainProcessError(error) {
  const message = error instanceof Error ? `${error.message}\n\n${error.stack ?? ""}` : String(error);

  try {
    const logPath = path.join(getDesktopUserDataDir(), "desktop-errors.log");
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `[${new Date().toISOString()}]\n${message}\n\n`);
  } catch {}

  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("desktop:action-error", message);
    }
  } catch {}

  dialog.showErrorBox("Main process error", message);
}

app.setName(APP_NAME);

let mainWindow = null;
function getLegacyDatabasePath() {
  return path.join(process.cwd(), DATABASE_FILENAME);
}

function getDesktopUserDataDir() {
  return app.getPath("userData") || path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), APP_NAME);
}

function getDatabasePath() {
  return path.join(getDesktopUserDataDir(), DATABASE_FILENAME);
}

function ensureDesktopDatabaseInitialized() {
  const databasePath = getDatabasePath();
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  if (fs.existsSync(databasePath)) {
    return databasePath;
  }

  const legacyDatabasePath = getLegacyDatabasePath();
  if (legacyDatabasePath !== databasePath && fs.existsSync(legacyDatabasePath)) {
    fs.copyFileSync(legacyDatabasePath, databasePath);
  }

  return databasePath;
}

async function resolveIndexedFile(fileId) {
  try {
    const response = await fetch(`${DEV_SERVER_URL}/api/desktop/file?id=${encodeURIComponent(fileId)}`);
    const data = await response.json();

    if (!response.ok || !data.file) {
      return { ok: false, error: data.error ?? "File is not indexed" };
    }

    return { ok: true, file: data.file };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to resolve file",
    };
  }
}

function createDragIcon() {
  const SIZE = 32;
  const canvas = Buffer.alloc(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) {
    canvas[i * 4 + 0] = 255;
    canvas[i * 4 + 1] = 255;
    canvas[i * 4 + 2] = 255;
    canvas[i * 4 + 3] = 255;
  }
  return nativeImage.createFromBuffer(canvas, { width: SIZE, height: SIZE });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#0a0a0c",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_START_URL) {
    void mainWindow.loadURL(DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../.next/server/index.html"));
  }

  mainWindow.setMenuBarVisibility(false);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

ipcMain.on("desktop:start-drag-file", (event, payload) => {
  const filePath = payload?.filePath;
  if (typeof filePath !== "string" || !filePath) {
    event.sender.send("desktop:action-error", "Missing file path");
    return;
  }

  if (!fs.existsSync(filePath)) {
    event.sender.send("desktop:action-error", "File no longer exists on disk");
    return;
  }

  try {
    event.sender.startDrag({
      files: [filePath],
      icon: createDragIcon(),
    });
  } catch (error) {
    reportMainProcessError(error);
  }
});

ipcMain.on("desktop:start-test-drag-file", async (event) => {
  const resolved = await resolveFirstIndexedFile();
  if (!resolved.ok) {
    event.sender.send("desktop:action-error", resolved.error);
    return;
  }

  try {
    event.sender.startDrag({
      files: [resolved.file.path],
      icon: createDragIcon(),
    });
  } catch (error) {
    reportMainProcessError(error);
  }
});

ipcMain.handle("desktop:copy-file-path", async (_event, fileId) => {
  const resolved = await resolveIndexedFile(fileId);
  if (!resolved.ok) {
    return resolved;
  }

  clipboard.writeText(resolved.file.path);
  return { ok: true, path: resolved.file.path };
});

ipcMain.handle("desktop:reveal-in-explorer", async (_event, fileId) => {
  const resolved = await resolveIndexedFile(fileId);
  if (!resolved.ok) {
    return resolved;
  }

  shell.showItemInFolder(resolved.file.path);
  return { ok: true, path: resolved.file.path };
});

ipcMain.handle("desktop:open-file-externally", async (_event, fileId) => {
  const resolved = await resolveIndexedFile(fileId);
  if (!resolved.ok) {
    return resolved;
  }

  const error = await shell.openPath(resolved.file.path);
  if (error) {
    return { ok: false, error };
  }

  return { ok: true, path: resolved.file.path };
});

app.whenReady().then(() => {
  ensureDesktopDatabaseInitialized();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

process.on("uncaughtException", (error) => {
  reportMainProcessError(error);
});
