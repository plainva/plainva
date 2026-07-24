/**
 * Type declarations for Playwright E2E window mocks (`window.mockFs`, `__zipCalls`, `__TAURI_INTERNALS__`).
 */

export interface MockFsItem {
  isDir?: boolean;
}

export type MockFs = Record<string, string | MockFsItem | undefined>;

declare global {
  interface Window {
    mockFs?: MockFs;
    __zipCalls?: unknown[];
    __zipShouldFail?: boolean;
    __TAURI_INTERNALS__?: {
      plugins?: Record<string, unknown>;
      transformCallback?: () => number;
      invoke?: (cmd: string, args?: unknown, options?: unknown) => Promise<unknown>;
    };
  }
}
