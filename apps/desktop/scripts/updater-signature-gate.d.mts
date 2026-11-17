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
  log?: (line: string) => void;
}): Promise<{ sha: string; runId: number }>;
