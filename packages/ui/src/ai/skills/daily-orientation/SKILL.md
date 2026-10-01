---
name: daily-orientation
description: A short orientation for today - what is due or scheduled today and in the next two days, what the user worked on lately, and the most important next step. Use when the user asks what matters today, how to start the day or what to do next.
license: AGPL-3.0-only
compatibility: Written for the assistant in Plainva; uses its vault, task and calendar tools.
allowed-tools: get_tasks get_calendar get_recent read_note get_outline search_vault
metadata:
  plainva.version: "1"
  plainva.risk: read
  plainva.tests: tests/scenarios.json
---

# Daily orientation

1. Start from the situation in the context: today's date, the daily note, the tasks that are due and the appointments.
2. Call `get_tasks` with the range `overdue`, then `today`; call `get_calendar` from today to two days ahead.
3. Call `get_recent` with the kind `edited` to see what the user worked on lately. Read a note only when its title does not say enough, and then only the section you need.
4. Answer with at most five points, the most urgent first: overdue before due today, fixed appointments before open tasks. Each point names its source as a wikilink.
5. End with one sentence: the most important next step and why.

Keep it short. Do not invent tasks, appointments or dates; leave out what the vault does not say.
