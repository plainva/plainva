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

/** The whole gate: the tag's commit, its release run, both jobs green — or a reason. */
export async function updaterSignatureGate({ api, tag, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), maxWaitMs = 90 * 60_000, pollMs = 60_000, log = console.log }) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error(`Expected a coordinated release tag, got "${tag}"`);
  const commit = await api(`/commits/${encodeURIComponent(tag)}`);
  const sha = commit?.sha;
  if (!/^[a-f0-9]{40}$/.test(sha ?? '')) throw new Error(`Could not resolve ${tag} to a commit`);
  for (let waited = 0; ; waited += pollMs) {
    const [run] = await releaseRunsOf(api, tag, sha);
    if (!run) throw new Error(`No release run started by the push of ${tag} for ${sha}: the updater signature check of this release never ran`);
    const verdict = judgeSignatureJobs(run, await jobsOf(api, run.id));
    if (verdict.failed.length) throw new Error(`The updater signature check is not green in release run ${run.id} (${run.html_url ?? ''}): ${verdict.failed.join(', ')}`);
    if (verdict.missing.length) throw new Error(`Release run ${run.id} of ${tag} ended without ${verdict.missing.join(', ')} (${run.html_url ?? ''})`);
    if (!verdict.pending.length) {
      log(`Updater signature check green for ${tag} (${sha}) in release run ${run.id}: ${verdict.green.join(', ')}.`);
      return { sha, runId: run.id };
    }
    if (waited >= maxWaitMs) throw new Error(`The updater signature check of ${tag} did not finish in time in release run ${run.id} — still running: ${verdict.pending.join(', ')}`);
    log(`Waiting for ${verdict.pending.join(', ')} in release run ${run.id} of ${tag} …`);
    await sleep(pollMs);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { GITHUB_REPOSITORY: repo, GH_TOKEN: token, RELEASE_TAG: tag, GITHUB_STEP_SUMMARY: summary } = process.env;
  if (!repo || !token || !tag) throw new Error('Missing updater manifest workflow context');
  const { sha, runId } = await updaterSignatureGate({
    tag,
    api: async (path) => {
      const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`GitHub API ${path}: HTTP ${response.status}`);
      return response.json();
    },
  });
  if (summary) appendFileSync(summary, `Updater signature check green for ${tag} (\`${sha}\`) in release run ${runId}.\n`);
}
