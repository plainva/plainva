export function prepareDesktopRelease(options: {
  tag: string;
  sha: string;
  notes: string;
  api: (path: string, method?: string, body?: unknown) => Promise<unknown>;
}): Promise<number>;
