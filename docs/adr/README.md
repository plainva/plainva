# Architecture Decision Records

This folder contains Architecture Decision Records (ADRs) for Plainva.

ADRs document decisions that have long-term impact on architecture, toolchain, data format, storage, sync, security, plugin system, or AI harness. They are short, traceable, and do not retroactively change history; if a decision changes, a new ADR is written that replaces or supplements the old one.

## Filenames

ADRs are numbered consecutively:

```text
0001-title-in-kebab-case.md
0002-title-in-kebab-case.md
```

`0000-template.md` is only the template and not a decision.

## When an ADR is needed

An ADR makes sense for decisions about:

- Monorepo, toolchain, or build strategy
- Desktop, mobile, or web stack
- Markdown parser, roundtrip strategy, or data format
- Storage adapters, sync, conflicts, and offline model
- Security, secret, sandbox, or plugin boundaries
- AI harness, memory, retrieval, or agent permissions
- Breaking changes and public interfaces

## When no ADR is needed

No ADR is needed for:

- Typos and pure text corrections
- Small README or handover updates
- Mechanical structural changes without a long-term decision
- Pure placeholder files
- Small test or lint adjustments without architectural impact

## Status values

Recommended status values:

- `Proposed`
- `Accepted`
- `Superseded`
- `Rejected`

When an ADR is replaced, the new ADR references the old one under `Links`.
