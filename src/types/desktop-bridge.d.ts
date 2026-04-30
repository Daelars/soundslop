import type { DesktopBridge } from "@/lib/desktop";

declare global {
  interface Window {
    desktopBridge?: DesktopBridge;
  }
}

export {};
