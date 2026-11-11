import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The gate at the start of a desktop release (Sammelplan § 3.149).
 *
 * Until 2026-10-30 every platform leg of the release ran the full unit suite
 * again before it built — about 50 minutes on Windows alone, twice enough to
 * hit the job's time limit before the app was built (0.8.6). The same commit
 * had already passed that suite: `main` only takes a commit whose required
 * checks are green (branch protection since 2026-09-28). So the release now
 * asks GitHub instead of repeating the work: the tag's commit must be on
 * `main`, and each required check must have passed on exactly that commit.
 * Anything else stops the release before a draft is made or a leg starts.
 *
 * Read-only: the workflow's own token with `contents: read` and
 * `checks: read`.
 */

/** The checks branch protection requires on `main` — the job names in ci.yml and codeql.yml. */
export const REQUIRED_CHECKS = ['Checks', 'WebKit editor regression', 'Rust checks', 'Analyze (JavaScript/TypeScript)'];

/**
 * Whether a commit lies on `main`, from the answer of
 * `GET /compare/{sha}...main`: `main` is the same commit or ahead of it.
 * "behind" or "diverged" means the tag points somewhere `main` never was.
 */
export function onMain(compareStatus) {
  return compareStatus === 'identical' || compareStatus === 'ahead';
}

/**
 * The verdict for each required check over all check runs of the commit.
 *
 * A commit gets its checks more than once — on the feature branch, then again
 * when `main` moves onto it, and on every rerun. The run that finished LAST
 * decides: green only if it succeeded, so a later red rerun is not hidden by an
 * earlier green one. A check that has only runs still going is pending; one
 * with no run at all is missing.
 */
export function judgeChecks(runs, required = REQUIRED_CHECKS) {
  const verdict = { green: [], failed: [], pending: [], missing: [] };
  for (const name of required) {
    // A skipped run did nothing, so it decides nothing: the run on `main` skips
    // a commit whose checks are already green on its branch (ci-verified.mjs,
    // decision E3). A check that has only skipped runs never ran.
    const mine = runs.filter((run) => run.name === name && run.conclusion !== 'skipped');
    const done = mine
      .filter((run) => run.status === 'completed')
      .sort((a, b) => String(a.completed_at ?? '').localeCompare(String(b.completed_at ?? '')) || (a.id ?? 0) - (b.id ?? 0));
    const last = done.at(-1);
    if (last) {
      if (last.conclusion === 'success') verdict.green.push(name);
      else verdict.failed.push(`${name} (${last.conclusion ?? 'no conclusion'})`);
    } else if (mine.length) {
      verdict.pending.push(name);
    } else {
      verdict.missing.push(name);
    }
  }
  return verdict;
}

/** Every check run of a commit, page by page (`filter=all`: the default hides all but the newest per name). */
export async function checkRunsOf(api, sha) {
  const runs = [];
  for (let page = 1; ; page++) {
    const answer = await api(`/commits/${sha}/check-runs?filter=all&per_page=100&page=${page}`);
    const list = answer?.check_runs;
    if (!Array.isArray(list)) throw new Error('Invalid check-run list');
    runs.push(...list);
    if (list.length < 100) break;
  }
  return runs;
}

/**
 * The whole gate. Waits while required checks are still running (a tag pushed
 * right after `main` moved meets `main`'s own run of the same commit), up to
 * `maxWaitMs`; then green or a reason.
 */
export async function releaseGate({ api, ref, expectedSha, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), maxWaitMs = 45 * 60_000, pollMs = 60_000, log = console.log }) {
  if (!/^v\d+\.\d+\.\d+$/.test(ref)) throw new Error(`Expected a coordinated release tag, got "${ref}"`);
  const commit = await api(`/commits/${encodeURIComponent(ref)}`);
  const sha = commit?.sha;
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error(`Could not resolve ${ref} to a commit`);
  if (expectedSha && expectedSha !== sha) throw new Error(`${ref} is ${sha}, the run was started for ${expectedSha}`);
  const compare = await api(`/compare/${sha}...main`);
  if (!onMain(compare?.status)) {
    throw new Error(`${ref} (${sha}) is not on main (main is ${compare?.status ?? 'unknown'} relative to it): a release is built only from a commit main has taken`);
  }
  log(`${ref} is ${sha}, on main.`);
  for (let waited = 0; ; waited += pollMs) {
    const verdict = judgeChecks(await checkRunsOf(api, sha));
    if (verdict.failed.length) throw new Error(`Required checks are not green on ${sha}: ${verdict.failed.join(', ')}`);
    if (!verdict.pending.length && !verdict.missing.length) {
      log(`Required checks green on ${sha}: ${verdict.green.join(', ')}.`);
      return sha;
    }
    if (waited >= maxWaitMs) {
      throw new Error(`Required checks did not finish on ${sha} in time — still running: ${verdict.pending.join(', ') || 'none'}; never ran: ${verdict.missing.join(', ') || 'none'}`);
    }
    log(`Waiting for ${[...verdict.pending, ...verdict.missing].join(', ')} on ${sha} …`);
    await sleep(pollMs);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { GITHUB_REPOSITORY: repo, GITHUB_OUTPUT: output, GH_TOKEN: token, RELEASE_REF: ref, EXPECTED_SHA: expectedSha } = process.env;
  if (!repo || !output || !token || !ref) throw new Error('Missing release workflow context');
  const sha = await releaseGate({
    ref,
    expectedSha: expectedSha || undefined,
    api: async (path) => {
      const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`GitHub API ${path}: HTTP ${response.status}`);
      return response.json();
    },
  });
  appendFileSync(output, `source_sha=${sha}\n`);
}
