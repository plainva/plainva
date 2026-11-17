type Api = (path: string) => Promise<unknown>;
export const SIGNATURE_JOBS: string[];
export function releaseRunsOf(api: Api, tag: string, sha: string): Promise<unknown[]>;
export function jobsOf(api: Api, runId: number): Promise<unknown[]>;
export function judgeSignatureJobs(
  run: { status?: string },
  jobs: { name: string; status: string; conclusion: string | null }[],
  required?: string[],
): { green: string[]; failed: string[]; pending: string[]; missing: string[] };
export function updaterSignatureGate(options: {
  api: Api;
  tag: string;
  sleep?: (ms: number) => Promise<void>;
  maxWaitMs?: number;
  pollMs?: number;
  maxBackoffMs?: number;
  log?: (line: string) => void;
}): Promise<{ sha: string; runId: number }>;
export class ApiError extends Error {
  constructor(message: string, options?: { status?: number; retryAfterMs?: number; cause?: unknown });
  status: number | undefined;
  retryAfterMs: number | undefined;
}
export function transient(error: unknown): boolean;
export function lastingFailure(error: unknown): Error;
export function githubApi(options: {
  repo: string;
  token: string;
  fetchImpl?: (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; headers?: { get(name: string): string | null }; json(): Promise<unknown> }>;
  now?: () => number;
}): Api;
