import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The manifest waits for the signature counter-check (stability plan R11,
 * Welle 2 § 4 Nr. 1).
 *
 * Since App 08adc6c29 every release run (release.yml, a push of the tag) calls
 * the native smoke, whose two "updater signature" jobs build this commit and
 * check that it refuses a tampered update. Until this gate nothing waited for
 * them: the maintainer can publish the draft while they still run, and the
 * Updater manifest workflow then moved the fixed `latest.json` regardless of
 * their result. Now updater-manifest.yml moves it only when both jobs are
 * green in the release run of exactly this tag and commit.
 *
 * Whose evidence counts: only a run of release.yml started by the PUSH of the
 * tag, for the commit the tag names. A rehearsal (workflow_dispatch) or a
 * Windows rebuild (workflow_dispatch, which skips the smoke) never counts, and
 * neither does the standalone Native Smoke workflow (its jobs are not called
 * "native-smoke / …"). Within that run the latest attempt decides, so a red
 * job is not hidden by an earlier green one, and a rerun that turns it green
 * counts.
 *
 * Order: nothing in release.yml joins `native-smoke` and the draft (both only
 * need the release gate), and publishing is the maintainer's hand — so the
 * manifest workflow can start while the jobs are queued or running. It waits
 * then, polling, up to `maxWaitMs`; it never passes a job that has not
 * finished, and it fails when the run is over without them.
 *
 * Read-only: the workflow's own token with `actions: read`.
 */

/** The two jobs, as the release run names them: the caller job `native-smoke`, the called job `updater signature (<os>)`. */
export const SIGNATURE_JOBS = ['native-smoke / updater signature (ubuntu-latest)', 'native-smoke / updater signature (windows-latest)'];

/** The release runs a tag push started for this commit, newest first. */
export async function releaseRunsOf(api, tag, sha) {
  const answer = await api(`/actions/workflows/release.yml/runs?event=push&head_sha=${sha}&per_page=100`);
  const runs = answer?.workflow_runs;
  if (!Array.isArray(runs)) throw new Error('Invalid workflow run list');
  return runs
    .filter((run) => run.event === 'push' && run.head_branch === tag && run.head_sha === sha)
    .sort((a, b) => (b.run_number ?? 0) - (a.run_number ?? 0) || (b.id ?? 0) - (a.id ?? 0));
}

/** Every job of the run's latest attempt, page by page. */
export async function jobsOf(api, runId) {
  const jobs = [];
  for (let page = 1; ; page++) {
    const answer = await api(`/actions/runs/${runId}/jobs?filter=latest&per_page=100&page=${page}`);
    const list = answer?.jobs;
    if (!Array.isArray(list)) throw new Error('Invalid job list');
    jobs.push(...list);
    if (list.length < 100) break;
  }
  return jobs;
}

/**
 * The verdict for the two jobs in one release run. A job that is listed but
 * not completed is pending; one that is not listed is pending while the run
 * goes on (a called workflow's jobs appear only when it starts) and missing
 * once the run is over.
 */
export function judgeSignatureJobs(run, jobs, required = SIGNATURE_JOBS) {
  const verdict = { green: [], failed: [], pending: [], missing: [] };
  for (const name of required) {
    const job = jobs.find((j) => j.name === name);
    if (job?.status === 'completed') {
      if (job.conclusion === 'success') verdict.green.push(name);
      else verdict.failed.push(`${name} (${job.conclusion ?? 'no conclusion'})`);
    } else if (job || run.status !== 'completed') verdict.pending.push(name);
    else verdict.missing.push(name);
  }
  return verdict;
}

/**
 * An answer of the GitHub API that is not a verdict. `status` is the HTTP
 * status (undefined for a network error or a timeout), `retryAfterMs` what
 * the API asked to wait (Retry-After, or the reset of an exhausted rate
 * limit).
 */
export class ApiError extends Error {
  constructor(message, { status, retryAfterMs, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ApiError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Whether an API failure passes by itself: a server error, a rate limit
 * (429, or 403 with a wait), a network error or a timeout. Everything else
 * (401, 403 without a wait, 404, another 4xx, a malformed answer) does not
 * get better by asking again.
 */
export function transient(error) {
  // githubApi wraps network errors and timeouts as ApiError without a status;
  // anything else (a malformed answer, a bug) is not asked again.
  if (!(error instanceof ApiError)) return false;
  const { status } = error;
  if (status === undefined) return true;
  return status >= 500 || status === 429 || (status === 403 && error.retryAfterMs !== undefined);
}

/** What a lasting API failure means for this step, in words that name the missing right. */
export function lastingFailure(error) {
  const status = error instanceof ApiError ? error.status : undefined;
  if (status === 401) return new Error(`GitHub API refused the workflow token (401): ${error.message}`, { cause: error });
  if (status === 403) return new Error(`GitHub API denied access (403) — the workflow needs \`permissions: actions: read\` to read the release run and its jobs: ${error.message}`, { cause: error });
  if (status === 404) return new Error(`GitHub API found nothing (404) — the tag, release.yml, or the run is not there, or the token cannot see it (\`actions: read\`): ${error.message}`, { cause: error });
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * The whole gate: the tag's commit, its release run, both jobs green — or a
 * reason. Red only on a verdict (a job red or missing, no release run, the
 * wait over) or on a lasting API failure; a passing one (a server error, a
 * rate limit, the network) is asked again within the same wait, at growing
 * intervals, so one bad answer never keeps an update from every install.
 */
export async function updaterSignatureGate({
  api,
  tag,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  maxWaitMs = 90 * 60_000,
  pollMs = 60_000,
  maxBackoffMs = 5 * 60_000,
  log = console.log,
}) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error(`Expected a coordinated release tag, got "${tag}"`);
  let sha;
  let waited = 0;
  let failures = 0;
  for (;;) {
    let run;
    let jobs;
    try {
      if (!sha) {
        const commit = await api(`/commits/${encodeURIComponent(tag)}`);
        if (!/^[a-f0-9]{40}$/.test(commit?.sha ?? '')) throw new Error(`Could not resolve ${tag} to a commit`);
        sha = commit.sha;
      }
      [run] = await releaseRunsOf(api, tag, sha);
      if (run) jobs = await jobsOf(api, run.id);
      failures = 0;
    } catch (error) {
      if (!transient(error)) throw lastingFailure(error);
      failures++;
      const wait = Math.min(error.retryAfterMs ?? pollMs * 2 ** (failures - 1), maxBackoffMs);
      if (waited + wait > maxWaitMs) throw new Error(`GitHub API kept failing for ${tag} until the wait was over (${failures} times in a row): ${error.message}`, { cause: error });
      log(`GitHub API failed (${error.message}); asking again in ${Math.round(wait / 1000)} s …`);
      await sleep(wait);
      waited += wait;
      continue;
    }
    if (!run) throw new Error(`No release run started by the push of ${tag} for ${sha}: the updater signature check of this release never ran`);
    const verdict = judgeSignatureJobs(run, jobs);
    if (verdict.failed.length) throw new Error(`The updater signature check is not green in release run ${run.id} (${run.html_url ?? ''}): ${verdict.failed.join(', ')}`);
    if (verdict.missing.length) throw new Error(`Release run ${run.id} of ${tag} ended without ${verdict.missing.join(', ')} (${run.html_url ?? ''})`);
    if (!verdict.pending.length) {
      log(`Updater signature check green for ${tag} (${sha}) in release run ${run.id}: ${verdict.green.join(', ')}.`);
      return { sha, runId: run.id };
    }
    if (waited >= maxWaitMs) throw new Error(`The updater signature check of ${tag} did not finish in time in release run ${run.id} — still running: ${verdict.pending.join(', ')}`);
    log(`Waiting for ${verdict.pending.join(', ')} in release run ${run.id} of ${tag} …`);
    await sleep(pollMs);
    waited += pollMs;
  }
}

/** The GitHub API over fetch, with the failures as ApiError (the CLI's `api`). */
export function githubApi({ repo, token, fetchImpl = fetch, now = () => Date.now() }) {
  return async (path) => {
    let response;
    try {
      response = await fetchImpl(`https://api.github.com/repos/${repo}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(30000),
      });
    } catch (error) {
      throw new ApiError(`GitHub API ${path}: ${error?.name ?? 'Error'}: ${error?.message ?? error}`, { cause: error });
    }
    if (response.ok) return response.json();
    const header = (name) => response.headers?.get?.(name) ?? null;
    let retryAfterMs;
    const retryAfter = header('retry-after');
    if (retryAfter !== null && /^\d+$/.test(retryAfter)) retryAfterMs = Number(retryAfter) * 1000;
    else if (header('x-ratelimit-remaining') === '0' && /^\d+$/.test(header('x-ratelimit-reset') ?? '')) {
      retryAfterMs = Math.max(0, Number(header('x-ratelimit-reset')) * 1000 - now()) + 1000;
    }
    throw new ApiError(`GitHub API ${path}: HTTP ${response.status}`, { status: response.status, retryAfterMs });
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { GITHUB_REPOSITORY: repo, GH_TOKEN: token, RELEASE_TAG: tag, GITHUB_STEP_SUMMARY: summary } = process.env;
  if (!repo || !token || !tag) throw new Error('Missing updater manifest workflow context');
  const { sha, runId } = await updaterSignatureGate({ tag, api: githubApi({ repo, token }) });
  if (summary) appendFileSync(summary, `Updater signature check green for ${tag} (\`${sha}\`) in release run ${runId}.\n`);
}
