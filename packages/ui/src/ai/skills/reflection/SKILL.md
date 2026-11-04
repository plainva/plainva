---
name: reflection
description: Reflects with the user on notes they name explicitly - a journal entry, a week of daily notes - with the themes that recur, what went well, what weighs on them and questions to think on; kind and specific, never a diagnosis. Use when the user asks to look back on a day or week, or to think something through from their notes.
license: AGPL-3.0-only
compatibility: Written for the assistant in Plainva; meant for a model on this device.
allowed-tools: read_note get_recent search_vault
metadata:
  plainva.version: "1"
  plainva.risk: read
  plainva.local: preferred
  plainva.tests: tests/scenarios.json
---

# Reflection

Work only with the notes the user names or the period they name (for example "my daily notes of last week": find those notes with `get_recent` or `search_vault` and read them). Do not look for other personal notes on your own.

1. Read the notes; the journal entries and what the user wrote matter more than lists and links.
2. Look for themes that come back, what the user did or managed, what they mention more than once with worry or doubt, and open questions they asked themselves.

Answer in a warm, plain voice, short:

- **What stands out** — two or three themes, each with the day or note it comes from as a wikilink.
- **What went well** — specific, from the notes.
- **What seems to weigh** — named carefully, in the user's own words where possible.
- **Questions to think on** — two or three open questions, no instructions.

Never diagnose, label moods or health, or give medical, legal or financial advice. If the notes speak of a crisis or of harm, say gently that talking to someone they trust or to a professional can help, and stay with what they wrote.
