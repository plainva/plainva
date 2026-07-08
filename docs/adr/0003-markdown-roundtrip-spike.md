# ADR 0003: Markdown Roundtrip Spike

Status: Accepted

Date: 2026-06-22

## Context

Plainva's central product promise depends on preserving plain Markdown vaults without migration, lock-in or silent formatting damage.

The master plan requires that existing Obsidian-style vaults remain usable after Plainva reads and writes them. The highest-risk early question is whether Plainva can open, parse, serialize and save Markdown while preserving meaningful file content and structure.

The validation target eventually includes Marco's real vault with about 500 Markdown files, wikilinks, frontmatter, callouts, embeds and `.base` usage. The first implementation step must not start by mutating that real vault.

## Decision

Plainva treats the Markdown roundtrip spike as a Phase 0 risk spike.

The spike starts with small controlled fixtures committed to the repo. It later expands to a read-only or copied test corpus derived from Marco's real vault.

The spike must verify parse-serialize behavior before any editor, storage adapter or sync implementation is trusted to write files.

The initial parser/serializer baseline follows the master plan's TypeScript-first direction and may use the unified/remark ecosystem for early validation. This ADR does not implement that stack and does not lock every parser option yet.

The spike must not:

- mutate real vault files in place,
- silently migrate or reformat existing vault content,
- require private vault data to be committed to the repo,
- hide differences that would matter to users or Obsidian compatibility.

## Consequences

- Roundtrip safety becomes an explicit gate before write-capable editor/storage work.
- Controlled fixtures can be reviewed and versioned without exposing private vault contents.
- Later real-vault validation must run against a copy or non-mutating harness.
- Diff output becomes part of the spike's value, not just pass/fail.
- Some formatter-normalization questions will need explicit decisions as fixtures reveal edge cases.

## Alternatives

- Start with app-shell work first: faster visible progress, but risks building on an unproven data-safety foundation.
- Test only against Marco's real vault immediately: realistic, but unsafe and unsuitable for a public repo.
- Treat Markdown serialization as an implementation detail: simpler short term, but directly conflicts with Plainva's Markdown-kernel promise.
- Use snapshot-only tests without parsing: useful later, but insufficient to validate parser/serializer behavior.

## Links

- Master project plan, sections 2.1, 3, 14.2 and 16 (internal planning document, maintainer workspace)
- `docs/adr/0001-monorepo-pnpm-turborepo.md`
- `docs/adr/0002-app-stack-baseline.md`
