const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopBridge", {
  isDesktop: true,
  startDragFile(fileId, filePath) {
    ipcRenderer.send("desktop:start-drag-file", { fileId, filePath });
  },
  revealInExplorer(fileId) {
    return ipcRenderer.invoke("desktop:reveal-in-explorer", fileId);
  },
  openFileExternally(fileId) {
    return ipcRenderer.invoke("desktop:open-file-externally", fileId);
  },
  copyFilePath(fileId) {
    return ipcRenderer.invoke("desktop:copy-file-path", fileId);
  },
  onActionError(listener) {
    const wrapped = (_event, message) => listener(message);
    ipcRenderer.on("desktop:action-error", wrapped);
    return () => {
      ipcRenderer.removeListener("desktop:action-error", wrapped);
    };
  },
});
