export type DesktopActionResult = {
  ok: boolean;
  error?: string;
  path?: string;
};

export interface DesktopBridge {
  isDesktop: true;
  startDragFile: (fileId: string, filePath: string) => void;
  revealInExplorer: (fileId: string) => Promise<DesktopActionResult>;
  openFileExternally: (fileId: string) => Promise<DesktopActionResult>;
  copyFilePath: (fileId: string) => Promise<DesktopActionResult>;
  onActionError: (listener: (message: string) => void) => () => void;
}

export function getDesktopBridge() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.desktopBridge ?? null;
}

export function isDesktopApp() {
  return getDesktopBridge()?.isDesktop === true;
}
