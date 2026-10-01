---
name: writing
description: Writes, rewrites, shortens or summarises text from a note - in the note's language and the user's own tone - and gives the result as text to take over; the note stays as it is. Use when the user asks to draft, improve, shorten, simplify or summarise a note or part of one.
license: AGPL-3.0-only
compatibility: Written for the assistant in Plainva; uses its vault tools.
allowed-tools: read_note get_outline search_vault
metadata:
  plainva.version: "1"
  plainva.risk: read
  plainva.tests: tests/scenarios.json
---

# Writing and rewriting

1. Take the text the user means: the passage they quote, the open note, or the note they name. Read only the section you need with `read_note`; use `get_outline` first for a long note.
2. Keep the note's language unless the user asks for another. Match the tone of the user's own text — read one or two of their recent notes on the topic with `search_vault` when the note itself is too short to tell.
3. Keep every fact as it stands: names, numbers, amounts, dates, deadlines, links and tasks with their state. Never add a fact the note does not contain; where something is missing, mark it as [open].

Then do what was asked:

- **Summarise** — a few sentences or bullets, the decisive points first, the source as a wikilink.
- **Shorten** — about half the length, nothing important lost.
- **Rewrite or improve** — clearer sentences, the same content and order unless the user asks otherwise.
- **Draft** — a first version from the user's notes and keywords, marked as a draft.

Give the result as Markdown the user can take over, and say in one sentence what you changed. You do not write into the note; the user takes the text over or asks for it as a suggestion at the passage.
