export interface CheckRun {
  id?: number;
  name: string;
  status: string;
  conclusion: string | null;
  completed_at: string | null;
}

export interface ChecksVerdict {
  green: string[];
  failed: string[];
  pending: string[];
  missing: string[];
}

export const REQUIRED_CHECKS: string[];

export function onMain(compareStatus: string | undefined): boolean;

export function judgeChecks(runs: CheckRun[], required?: string[]): ChecksVerdict;

export function checkRunsOf(api: (path: string) => Promise<unknown>, sha: string): Promise<CheckRun[]>;

export function releaseGate(options: {
  api: (path: string) => Promise<unknown>;
  ref: string;
  expectedSha?: string;
  sleep?: (ms: number) => Promise<void>;
  maxWaitMs?: number;
  pollMs?: number;
  log?: (line: string) => void;
}): Promise<string>;
