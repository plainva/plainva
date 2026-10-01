---
name: privacy-check
description: Checks notes for what should not go to a cloud - personal data, account and card numbers, passwords and keys, health details - and names for each the rule that would keep it on this device. Use when the user asks what in a note or folder is sensitive, or before sharing notes with an AI service.
license: AGPL-3.0-only
compatibility: Written for the assistant in Plainva; meant for a model on this device.
allowed-tools: read_note search_vault get_outline
metadata:
  plainva.version: "1"
  plainva.risk: read
  plainva.local: preferred
  plainva.tests: tests/scenarios.json
---

# Privacy check

1. Take the note or folder the user names, or the open note. For a folder, list its notes with `search_vault` and check at most about twenty per answer.
2. Read each note and look for: names with addresses, phone numbers or birth dates; account, card, ID and tax numbers; passwords, PINs, keys and tokens; health details; anything the note itself marks as private.
3. A note you cannot read is already kept from you by the user's rules — say so, it needs no further rule.

Answer per note, as a wikilink, with:

- **What is sensitive** — the kind, and where (section or line), without repeating the sensitive value itself.
- **Suggestion** — keep the whole note on this device (the note's own rule "never to the cloud"), a rule for its whole folder in the privacy settings, or move the sensitive part into a note of its own.

End with the notes that look harmless, in one line. Never quote a password, number or health detail in the answer.
