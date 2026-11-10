/**
 * The richer vault of the screenshot walk: a project note with properties,
 * tasks, a callout, a table and a code block, a roadmap, a daily note and a
 * reading list — what the main scene needs to show the editor's surfaces. It
 * goes on top of the smoke spec's double, which provides `window.mockFs`.
 * Passed to `page.addInitScript`, so it must stay self-contained.
 */
export function installReviewVault(): void {
  const fs = (window as unknown as { mockFs: Record<string, unknown> }).mockFs;
  const add = (p: string, c: string) => { fs['/test-vault/' + p] = c; };
  fs['/test-vault/Projects'] = { isDir: true };
  fs['/test-vault/Daily'] = { isDir: true };
  fs['/test-vault/Areas'] = { isDir: true };
  add('Projects/Website relaunch.md', `---
status: active
due: 2026-11-20
tags: [project, web]
owner: Alex
---
# Website relaunch

The new site should explain **what Plainva is** in one sentence and show real screenshots. See [[Roadmap]] and [[Daily/2026-11-10]].

## Goals
- Clear hero with a Markdown sentence
- Three feature pages instead of six
- [ ] Collect screenshots #todo
- [x] Write the outline
- [ ] Translate into ten languages 📅 2026-11-18

## Open questions
> [!note] Pricing
> Hosting costs are shown from public data.

| Page | Owner | State |
|---|---|---|
| Home | Alex | draft |
| Features | — | open |

\`\`\`js
const hero = "Your notes, plain Markdown.";
\`\`\`
`);
  add('Projects/Roadmap.md', '---\nstatus: paused\ntags: [project]\n---\n# Roadmap\n\nLinks back to [[Website relaunch]].\n\n- [ ] Plan 0.9.0\n');
  add('Daily/2026-11-10.md', '# 2026-11-10\n\n- 08:15 Coffee and planning\n- 09:30 Call about the [[Website relaunch]]\n\n- [ ] Answer issue #153\n');
  add('Areas/Reading list.md', '# Reading list\n\n#reading\n\n1. How to take smart notes\n2. The Pragmatic Programmer\n');
  add('Ideas.md', '# Ideas\n\nA short note with a #idea tag and a link to [[Roadmap]].\n');
}
