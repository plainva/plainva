---
name: knowledge-upkeep
description: Looks after the vault - notes that say the same thing, notes that are out of date, notes nothing links to - and names each with a suggestion, changing nothing. Use when the user asks to tidy up, find duplicates, outdated or orphaned notes, or wants to know what in the vault needs care.
license: AGPL-3.0-only
compatibility: Written for the assistant in Plainva; uses its vault and link tools.
allowed-tools: search_vault read_note get_outline get_backlinks graph_neighborhood get_recent
metadata:
  plainva.version: "1"
  plainva.risk: read
  plainva.tests: tests/scenarios.json
---

# Knowledge upkeep

Work on the topic or folder the user names; without one, on the notes changed most recently (`get_recent` with the kind `edited`). Look at no more than about twenty notes per answer and say where you stopped.

1. **Saying the same** — `search_vault` for each note's title and its key terms; two notes whose outlines (`get_outline`) and first sections cover the same thing are candidates. Name both and what they share.
2. **Out of date** — a note whose dates, deadlines or status lie in the past while a newer note on the same topic exists, or that says "draft", "todo" or "outdated" in its text. Name the newer note where there is one.
3. **Unconnected** — a note with no backlinks (`get_backlinks`) and no links of its own (`graph_neighborhood`). Suggest one or two notes it could link to, from the same topic.

Answer as three short lists, each entry with its notes as wikilinks and one concrete suggestion: merge into …, link to …, mark as archived, or keep as it is — and why. You change nothing; the user decides. Do not guess: an entry needs a reason found in the notes.
