---
name: project-status
description: The status of one project - its goal, what is done, what is open, what blocks it and the next step, each with its source. Use when the user asks how a project stands, what is left to do in it or what comes next.
license: AGPL-3.0-only
compatibility: Written for the assistant in Plainva; uses its vault and task tools.
allowed-tools: read_note get_outline search_vault get_backlinks graph_neighborhood get_tasks query_base
metadata:
  plainva.version: "1"
  plainva.risk: read
  plainva.argument: project
  plainva.argument-description: The project - the name of its note or folder.
  plainva.tests: tests/scenarios.json
---

# Project status

1. Find the project: the open note when it is about a project, otherwise the project the user names. When neither is clear, ask which project is meant and stop.
2. Call `get_outline` on the project note, then read the sections that carry goals, decisions and open points.
3. Call `get_backlinks` and `graph_neighborhood` for meeting notes, tasks and documents that belong to it; read the newest of them first.
4. Call `get_tasks` with the range `all` and keep the tasks that live in the project's notes; a database of the project goes through `query_base`.

Answer in five short parts, each point with its source as a wikilink:

- **Goal**
- **Done**
- **Open**
- **Blocked by** — leave it out when nothing blocks the project.
- **Next step** — one, concrete, with who or what it waits for when the notes say so.

Mark statements that rest on an old note with its date. Do not fill gaps with guesses; name what the notes do not say.
