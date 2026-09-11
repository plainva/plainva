import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Allocate a single draft before the platform matrix starts. Concurrent
// find-or-create calls produced two drafts during the 0.8.2 release.
export async function prepareDesktopRelease({ tag, sha, notes, api }) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag) || !/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error('Expected a coordinated release tag and exact commit');
  }
  if (!notes.trim()) throw new Error('Release notes must not be empty');
  const matches = [];
  for (let page = 1; ; page++) {
    const releases = await api(`/releases?per_page=100&page=${page}`);
    if (!Array.isArray(releases)) throw new Error('Invalid release inventory');
    matches.push(...releases.filter((release) => release.tag_name === tag));
    if (releases.length < 100) break;
  }
  if (matches.length > 1) throw new Error('Multiple releases have this tag; resolve the ambiguity before building');
  if (matches.length === 1) {
    const release = matches[0];
    if (!Number.isSafeInteger(release.id) || !release.draft || release.prerelease || release.target_commitish !== sha) {
      throw new Error('Existing release is published or belongs to a different source');
    }
    return release.id;
  }
  const release = await api('/releases', 'POST', {
    tag_name: tag,
    target_commitish: sha,
    name: `Plainva ${tag}`,
    body: notes,
    draft: true,
    prerelease: false,
    make_latest: 'false',
  });
  if (!Number.isSafeInteger(release.id) || !release.draft) throw new Error('Draft creation returned an invalid release');
  return release.id;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { GITHUB_REF_NAME: tag, GITHUB_SHA: sha, GITHUB_REPOSITORY: repo, GITHUB_OUTPUT: output, GH_TOKEN: token } = process.env;
  if (!repo || !output || !token || !tag || !sha) throw new Error('Missing release workflow context');
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('Expected a coordinated desktop release tag');
  for (const path of ['apps/desktop/package.json', 'apps/mobile/package.json', 'apps/desktop/src-tauri/tauri.conf.json']) {
    if (JSON.parse(readFileSync(path, 'utf8')).version !== tag.slice(1)) throw new Error(`Version mismatch: ${path}`);
  }
  const id = await prepareDesktopRelease({ tag, sha, notes: readFileSync(`docs/releases/${tag}.md`, 'utf8'), api: async (path, method = 'GET', body) => {
    const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Release API: HTTP ${response.status}`);
    return response.json();
  } });
  appendFileSync(output, `release_id=${id}\n`);
  console.log(`Prepared one draft for ${tag}.`);
}
