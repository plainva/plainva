---
name: link-cleanup
description: Checks the links of a note or a folder - links to notes that do not exist, mentions that could be links, notes that should point to each other - and lists the proposed changes without making them. Use when the user asks to check, repair or clean up links, or why a note is not connected.
license: AGPL-3.0-only
compatibility: Written for the assistant in Plainva; uses its vault and link tools.
allowed-tools: read_note get_outline get_backlinks graph_neighborhood search_vault
metadata:
  plainva.version: "1"
  plainva.risk: read
  plainva.tests: tests/scenarios.json
---

# Link cleanup

1. Take the note the user means, or the open note; for a folder, its notes one by one, at most about twenty per answer.
2. Read the note with `read_note` and collect its wikilinks and Markdown links.
3. **Links that lead nowhere** — check each target with `get_outline`; a target that is not available is either missing or kept from you by the user's rules, so call it "not reachable", never "deleted". Suggest the existing note it probably meant (`search_vault` for its name), or creating the note.
4. **Mentions without a link** — names of existing notes that appear in the text as plain words; suggest turning the first mention into a link.
5. **One-way links** — with `get_backlinks` and `graph_neighborhood`, notes that link here without being linked back where a link back would help a reader.

Answer as a list of proposed changes, each with the line or section it concerns, the link as it is and as it should be, and the note as a wikilink. You change nothing; the user takes the changes over. Do not propose links to notes you have not found.
