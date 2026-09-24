/** Types for `build-info.mjs` (used by both shells' Vite configs). */
export interface BuildInfo {
  channel: string;
  commit: string;
  branch: string;
  run: string;
}

export function buildInfo(env?: Record<string, string | undefined>): BuildInfo;

export function buildInfoDefine(env?: Record<string, string | undefined>): { __PLAINVA_BUILD__: string };
