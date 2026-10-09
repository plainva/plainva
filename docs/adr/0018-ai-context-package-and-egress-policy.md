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
10. **A picture goes at the user's own request, and never as the file**
    (built with P4-5). "Explain image" at a picture of the vault sends it,
    with a question, in a conversation of its own.
    - *Never picked.* The context package chooses notes; it never chooses a
      picture. A picture is in a request only because the user pressed the
      door at that picture — and it is a data class of its own (`images`), so
      the overview asks the first time and shows the picture itself.
    - *What goes is drawn anew.* The shell decodes the file, scales it down
      (longer edge 1,568 pixels) and encodes the canvas: PNG where the file's
      format says "sharp edges" and that stays small, JPEG otherwise. The
      file's own bytes never leave, so nothing of its metadata does — no
      place, no date, no camera. The overview shows exactly that copy with
      its size; the same copy is the image part of the conversation, kept in
      the record like every part that was sent (decision 7).
    - *The gate is the note's gate.* A picture has no frontmatter: its
      folder's rules and the vault's defaults decide. And a note's rule
      covers what the note shows — a picture goes to no cloud model when a
      note the rules keep from it embeds the picture. The viewer no longer
      knows which note a picture was opened from, so the embedding notes are
      looked up (the notes whose text names the file, then their embeds, in
      either syntax); when that cannot be answered, the picture stays —
      "cannot tell" is never "none". A model on the device needs no lookup.
      Nothing is read or drawn before the gate has decided.
    - *Read by the conversation's model.* A picture is tier 3 like a note's
      text, and reaches the model the same way a note does: with the
      conversation's read tools in reach, the run classed as carrying private
      and untrusted content, and a sentence beside the picture saying that
      what is written in it is content. The door's conversation has no tool
      with an outside effect, no app commands and no tool search.
    - *A model that reads none.* The protocols of the systems' own models
      have no place for a picture: the door says so before anything is read.
      Elsewhere the provider answers; where its own model list names a
      model's input kinds, the overview says beforehand that the model reads
      no pictures, and sends all the same if the user wants.
11. **What is made of an answer inherits the rules of its sources** (built
    with P4-6). The gate decides what a recipient gets; it must not be
    undone by writing the answer down. A model on the device may read a note
    kept from the cloud, and a conversation without the internet may read a
    note kept from it — so an answer the app turns into a note of the vault
    (ADR 0019 §11) carries those rules on: `plainva.ai.cloud: deny` or
    `plainva.ai.web: deny` in the new note, where the place it lands in
    would allow more. The rules are those of everything the conversation
    carried up to that answer. For what went along as context the overview's
    record names the notes, and their rules are looked up when the note is
    made; for what the tools let through, the gate reports each passing
    note's rules while the run is on, and the run's record keeps the
    dimension (`restricted`), never a path. A rule that cannot be looked up
    counts as a denial. Suggestions, transcripts and replies in a comment
    thread are written into, or beside, the note they come from and need no
    such step: they are under that note's rule already.
12. **Which note a link names is asked of every note it could mean** (built
    with P5-7b). Decision 2 withholds a link to a note the rules keep back,
    and that needs an answer to "which note does this link name?". The app
    has more than one: the desktop's editor follows a link by a note's title
    (the `title` of its properties where it has one) or its whole path, the
    phone by a path from the note and by the file's name anywhere, the graph
    by the end of a path. Each opens one note, and not always the same. The
    gate used to ask the shell's own rule — so a link that rule did not
    follow was no link to a kept note for it, and the note's name went to a
    cloud model inside an allowed neighbour's text.
    - *The gate asks another question.* For every link it takes all files
      its spelling could mean under any of those rules — a path from the
      note it stands in, a path from the vault's root, the end of a path
      (the file's name among them), the title of a note's properties — and
      withholds the link where one of them is kept back
      (`filesALinkCouldMean` in `packages/core/src/ai/linkNames.ts`,
      `linkNamesDeniedNote` in `chat.ts`). Names are compared without regard
      to letter case and to how a letter is composed. What a tap opens in
      the shell at hand is always among the candidates.
    - *One answer in both shells.* The names come from the index: every
      file with the title it holds for it (`VaultQueryService.fileNames`),
      read at most every few seconds by the shared policy host
      (`createVaultPolicy`, `fileNames`). Every place that builds that host
      hands the names in; a test on the source of both shells fails a host
      built without them.
    - *Cannot tell is never none.* Where the names cannot be read, a link
      is withheld. Where more files share a name than are asked about (200 —
      each is a file to read for its own rule), the link is withheld.
    - *What counts as a link.* Wiki links and embeds; Markdown links with
      the destination bare or in angle brackets, where it may hold blanks;
      reference links — the definition that names the note and every use of
      its label. Not: a link written as HTML, and a note's name that merely
      stands in a text.
    - *The source check of the writing tools asks the same question* (ADR
      0019 §6): a link in an assistant's text leads "nowhere" only where no
      note could be meant by it, and is said to lead to a note the writer
      may not read only where every note it could mean is kept back.
13. **A conversation that ran on this device stays on this device** (built
    with P6). A conversation is append-only (decision 7): every request
    carries all of it, to whichever model is chosen now — and the model of
    an open conversation can be changed. What a model on the device is given
    is put together for a reader that may see everything: a note kept from
    the cloud is read like any other, a link to one keeps its name (decision
    2 withholds it for a cloud only), nothing is hinted at or redacted for a
    provider. The gate decides at the moment something is read; it had no
    say when the past of a conversation went to another recipient. Found
    with a test before memory was built: a note under `cloud: deny`, read
    with a local model, went to a cloud provider with the next message after
    the model was switched — the overview named a new recipient and nothing
    else.
    - *The rule is the simple one.* A conversation that was begun for a
      model on this device (`onDevice` in its record), or had one run there,
      does not go to a cloud recipient: nothing is built, asked or sent, the
      message stays in the field, and a notice says why and offers a new
      conversation with the model that was chosen (`keptOnDevice` in the
      session, the failure `kept_on_device`). Back with a model on the
      device it goes on as before.
    - *Not: checking the past again.* Telling what such a conversation
      carries beyond what a cloud may have would mean knowing every text it
      was ever given — the notes its context held, each tool result with the
      links in it, gists written from notes a cloud may not see. One channel
      overlooked is a leak, and the texts cannot be changed afterwards. A
      run whose provider is no longer known counts as one that ran here.
    - *The other direction is free.* A conversation that only ever went to
      clouds carries nothing that was not passed for one: it changes its
      model as before, to another provider (the overview comes back, a new
      recipient) or to a model on the device.

## Consequences

- The gate is a pure function in core with its own evals (golden queries with
  locked notes, redaction in anchors); the native egress re-checks the
  recipient, so a WebView bug cannot widen the scope.
- Approval fatigue is traded for scope honesty: individual requests inside an
  approved scope are not confirmed one by one, but every send is traceable at
  the answer.
- Append-only transcripts cost tokens on long conversations; compaction
  appends a summary turn instead of editing.
- A conversation that carries a picture carries it in every later request
  and in its record on the device; one picture is a few hundred kilobytes.
  Deleting the conversation deletes the copy.
- Looking up the notes that embed a picture is a scan of the note texts — a
  moment on a large vault, once per press of the door, and only for a cloud
  model. Two pictures of one file name count as one there: that can keep a
  picture back, never let one go.
- A link is withheld more often than before, and never less: where two notes
  share a name and one of them is kept back, a link by that bare name is
  withheld although the shell would have opened the other one. Writing the
  folder into the link (`[[Notes/Diary]]`) names the one that is meant.
- The names of all files are read from the index once per burst of
  questions — one query, a moment on a large vault — and each note a link
  could mean is read for its own rule, once per run.
- Starting with a model on the device and going on with a stronger one in a
  cloud means starting a new conversation: the question has to be asked
  again, and the cloud then gets what the gate passes for it. That is the
  price of decision 13, and it is paid also by a conversation that read
  nothing a cloud could not have had.

## Alternatives

- **Per-request confirmation by default.** Rejected: it trains blind
  clicking; kept as an option.
- **Filtering after ranking.** Rejected: ranking and compaction would already
  have read denied content, and gists could leak it.
- **Policy only in a central file.** Rejected for notes: a policy that
  travels with the note survives moves and exports; folders use the central
  file because Plainva does not write marker files into user folders.
- **Sending the picture's file as it is.** Rejected: a photo's file names
  where and when it was taken. Drawing it anew costs a moment and nothing of
  what a model reads from a picture.
- **A reader in quarantine for pictures** (ADR 0019, decisions 9 and 10).
  Rejected: the reader exists for what strangers send — a web page, a mail.
  A picture in the vault is the user's own file, like a note, and a
  description of a picture is not the picture: the user asks on about
  details no first report would have kept. The run is classed like one that
  read a note instead, and the door carries nothing with an outside effect.
- **Deciding by the picture's own path alone.** Rejected: attachments often
  sit in one folder for the whole vault, so a note's "never to the cloud"
  would not have covered the scan the note shows.
- **A storage of references instead of the copy that went.** Rejected: the
  file can change or go, and the record would then no longer say what a
  provider got.
- **Asking the shell's own link rule, and making the shells agree.** The
  rules of the editor, the phone and the graph should become one — that is
  the app's own work, outside the harness. The gate does not wait for it and
  does not depend on it: whichever rule a shell follows, the question "could
  this name a kept note?" is answered from the names of all files.
- **Withholding a link only where the note a tap opens is kept back.**
  Rejected: which note a tap opens differs by shell, and the same vault
  would send a kept note's name from one device and not from the other.
- **Checking every note of a name without a bound.** Rejected: a bare name
  can be shared by one note per folder, and each is a file to read. Beyond
  the bound the link is withheld instead.

## Links

- ADR 0009 (`plainva:` namespace and OKF write path), ADR 0014 (encrypted
  workspaces), ADR 0017, ADR 0019.
- The vault's memory — tier 3 like a note, with a rule per entry, a budget
  and a row of its own in the overview: ADR 0027.
- Pictures: `packages/core/src/ai/images.ts`, the image part in
  `packages/core/src/ai/conversation.ts` and the request codecs in
  `providers.ts`; `packages/ui/src/ai/aiImage.ts` (drawing anew, the lookup
  of embedding notes), `explainImage` in `packages/ui/src/ai/aiSession.ts`;
  `VaultQueryService.notesContaining`; `docs/engineering/AI_Threat_Model.md`
  (T20, T21).
- Which note a link names: `packages/core/src/ai/linkNames.ts`,
  `redactDeniedLinks` in `egressGate.ts`, `withholdDeniedLinks` and
  `linkNamesDeniedNote` in `chat.ts`, `VaultQueryService.fileNames`,
  `createVaultPolicy` in `packages/ui/src/ai/aiVaultHost.ts`; proved on the
  real index in `packages/core/test/ai-link-candidates.test.ts`, the wiring
  of both shells in `apps/desktop/src/ai/linkNamesWiring.test.ts`;
  `docs/engineering/AI_Threat_Model.md` (T5).
