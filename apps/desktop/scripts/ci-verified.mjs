import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkRunsOf, judgeChecks, REQUIRED_CHECKS } from './release-gate.mjs';

/**
 * Whether CI may skip its run on `main` (stability plan R10, decision E3).
 *
 * `main` takes only fast-forwards of commits whose required checks are green
 * (branch protection), and a check run belongs to a commit, not to a branch.
 * So when `main` moves onto a commit, the four checks have already passed on
 * exactly that commit, on its `feature/**` branch, and running the whole suite
 * again only repeats the answer (it cost about 110 minutes a time). The run on
 * `main` asks GitHub first: are all four required checks green on this commit
 * already, by a run that finished? Only then it skips; a commit that did not
 * pass before — the emergency path, a rerun after a red one — runs in full.
 *
 * The skipped jobs report "skipped" on the commit. That changes neither the
 * green runs from the branch nor what the release gate decides: it reads the
 * last run of each check that actually ran (release-gate.mjs, judgeChecks).
 */
export function alreadyVerified(runs, required = REQUIRED_CHECKS) {
  const verdict = judgeChecks(runs, required);
  return { verified: verdict.green.length === required.length, verdict };
}

/** Only a push to `main` can skip; every other event runs in full. */
export function mayAsk({ event, ref }) {
  return event === 'push' && ref === 'refs/heads/main';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { GITHUB_REPOSITORY: repo, GITHUB_OUTPUT: output, GH_TOKEN: token, GITHUB_EVENT_NAME: event, GITHUB_REF: ref, GITHUB_SHA: sha } = process.env;
  if (!repo || !output || !sha) throw new Error('Missing workflow context');
  let verified = false;
  if (mayAsk({ event, ref })) {
    if (!token) throw new Error('Missing GH_TOKEN');
    const runs = await checkRunsOf(async (path) => {
      const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`GitHub API ${path}: HTTP ${response.status}`);
      return response.json();
    }, sha);
    const answer = alreadyVerified(runs);
    verified = answer.verified;
    const v = answer.verdict;
    console.log(verified
      ? `All required checks are already green on ${sha} (${v.green.join(', ')}): this run on main skips the suite.`
      : `Not verified before on ${sha} — green: ${v.green.join(', ') || 'none'}; failed: ${v.failed.join(', ') || 'none'}; running: ${v.pending.join(', ') || 'none'}; never ran: ${v.missing.join(', ') || 'none'}. Running in full.`);
  } else {
    console.log(`${event} on ${ref}: running in full.`);
  }
  appendFileSync(output, `verified=${verified}\n`);
}
