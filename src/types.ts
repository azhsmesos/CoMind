import type { DesktopApi } from "../shared/types";
export * from "../shared/types";
declare global {
  interface Window {
    api: DesktopApi;
  }
}
