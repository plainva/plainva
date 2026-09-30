# ADR 0018: AI context package, egress policy and the send overview

Status: Accepted

Date: 2026-09-24

## Context

The quality of a vault assistant comes from what it is shown, not from larger
prompts. At the same time every byte shown to a cloud model leaves the device.
Plainva must therefore decide locally what is relevant, remove what may not
leave before anything else sees it, and show the user where it goes before it
goes. Conversations must also survive a change of provider without losing
their history, and providers answer a rewritten history differently (the
Anthropic Messages API rejects edited assistant turns with HTTP 400 when
thinking blocks are involved).

## Decision

1. **Pipeline.** Request and app situation → situation snapshot (local) →
   **privacy hard gate** → candidate generation (FTS5, graph and relations,
   properties and `.base`, recency, later embeddings) → ranker → compactor
   (metadata, gists, snippets, section handles) → context package and send
   overview → chosen model through the native egress (ADR 0017).
2. **The hard gate runs before scoring.** `EgressPolicyEngine`
   (`packages/core/src/ai/policy/`) removes every candidate the effective
   policy forbids for the chosen recipient before ranking, compaction or
   display — a denied note contributes no title, gist, file name, link anchor
   or embedding. Redaction also covers the titles of denied notes in backlink
   anchors and relation values of allowed neighbours.
3. **Policy in the vault.** Notes carry `plainva.ai` in frontmatter
   (`cloud: deny|allow`, `web: deny|allow`); folders inherit from
   `.agent/policy.yml` (`folders: { "<folder>/": { cloud: deny } }`), the
   nearest rule wins, a note overrides its folder. Local models stay allowed
   separately. Defaults are app-global with a vault override; encrypted
   workspaces default to `cloud: deny`. A policy change by the AI is a
   critical write (ADR 0019). The schema is part of the file format contract
   (the [File Format Reference](../user/en/File_Format_Reference.md) of the user guide).
4. **Sensitive data classes** — mood (`journalMoodProperty`, `rating`) and the
   place stamp lines (`📍 lat, lon`) — never enter a package automatically;
   place lines are redacted before egress; including them is an explicit
   choice per request, named in the send overview.
5. **Trust tiers travel with the data.** Every payload is `{data, trust,
   origin}`: tier 0 app policy, tier 1 user-approved (policies, skills, memory
   rules — bound to their content hash), tier 2 pending AI proposals, tier 3
   untrusted data (vault content, mail, calendar fields, web, tool results
   including MCP, script output, memory facts). Tier 3 appears only inside
   fenced "data, not instructions" blocks; a note never becomes a system
   instruction. Unicode format and tag characters are stripped from all tier 3
   input, and "View context" shows the cleaned text.
6. **Send overview as scope approval.** The full overview (provider and model,
   sources and sections, raw or compressed, redactions, estimated tokens and
   cost, excluded local sources, web and tool access, region and retention per
   model) appears on the first request of a session and **whenever the scope
   grows** — a new provider or model, a new data class, a new folder, web or
   tool access, a budget jump. Within an approved scope each answer carries a
   compact line ("sent to ⟨provider⟩: 4 sources, ~1,200 tokens") that expands
   to the full overview. "Confirm before every request" stays available;
   unattended runs are fail-closed. The overview is also the consent for
   Apple guideline 5.1.2(i) and Google Play's disclosure rules for third-party
   AI.
7. **Conversations are append-only.** A conversation is a list of immutable
   turns; context maintenance per provider (cache breakpoints, compaction
   variant) happens by appending, never by rewriting sent turns. Switching
   provider starts a new provider transcript from the stored turns, so no
   history is lost and no provider sees an edited past.
8. **Provider defaults, not limits.** Every adapter sends `store:false` where
   the API offers it; OpenAI prompt caching uses
   `prompt_cache_retention: "in_memory"` where the model supports it; the
   Gemini adapter stays on `generateContent`. A gateway (OpenRouter, Vercel)
   is a recipient only if the user chose it, and then it is named. Retention
   per model is data shown in the send overview.
9. **"Today" is the app's today.** Dates come from `today.ts`
   (`calendarDay`, `journalDay` with the day boundary); the model computes no
   date of its own.

## Consequences

- The gate is a pure function in core with its own evals (golden queries with
  locked notes, redaction in anchors); the native egress re-checks the
  recipient, so a WebView bug cannot widen the scope.
- Approval fatigue is traded for scope honesty: individual requests inside an
  approved scope are not confirmed one by one, but every send is traceable at
  the answer.
- Append-only transcripts cost tokens on long conversations; compaction
  appends a summary turn instead of editing.

## Alternatives

- **Per-request confirmation by default.** Rejected: it trains blind
  clicking; kept as an option.
- **Filtering after ranking.** Rejected: ranking and compaction would already
  have read denied content, and gists could leak it.
- **Policy only in a central file.** Rejected for notes: a policy that
  travels with the note survives moves and exports; folders use the central
  file because Plainva does not write marker files into user folders.

## Links

- ADR 0009 (`plainva:` namespace and OKF write path), ADR 0014 (encrypted
  workspaces), ADR 0017, ADR 0019.
