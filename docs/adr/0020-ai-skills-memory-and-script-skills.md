# ADR 0020: AI skills, memory and script skills

Status: Accepted

Date: 2026-09-24

## Context

A vault assistant gets better at a user's recurring work through skills
(reusable instructions), memory (facts and preferences) and, later, small
programs. All three are also the most direct way to smuggle instructions into
an agent: a skill file that arrives through sync, an imported vault or a
shared folder runs with the user's rights the next time it is invoked. The
industry learned this repeatedly in 2026 — hooks in project settings that ran
without consent (CVE-2026-48124), cloned skills that turned malicious after
1.7 million installs, npm packages that planted agent hooks despite valid
build provenance, `AGENTS.md` files loaded from untrusted checkouts.

## Decision

1. **Files in the vault, in the Agent Skills format.** The hidden `.agent/`
   folder holds `MEMORY.md`, `active_memory.md`, `TASKS.md`, `SKILLS.md`,
   `skills/<name>/SKILL.md` (with `scripts/`, `references/`, `assets/`),
   `scripts/<name>/` (signed WASM packages, later), `sessions/` (opt-in
   conversation notes) and `logs/` (readable run and learning reports).
   Skills follow the Agent Skills specification unchanged: `name` and
   `description` required, `license`, `compatibility`, `metadata` as a string
   map, `allowed-tools` as the pre-approval list. Plainva's own metadata —
   capabilities, allowed data classes and folders, risk class, input and
   output schema, model profile, token and cost budget, tests and fixtures,
   origin, version, signature, local or cloud suitability — lives in
   `metadata` under the prefix `plainva.`, so the skills stay readable by the
   roughly forty harnesses that implement the format. What a skill consists
   of is decided in the core, not by a shell's file listing: hidden entries
   inside a skill's folder — names that start with a dot — and the operating
   system's bookkeeping are not part of it. The scan and the import leave them
   out, so both shells hash the same files, the user approves what the dialog
   can show, and a leftover of an interrupted write lifts no approval.
2. **Nothing becomes active by arriving.** A skill, script, routine, memory
   **rule** or a vault-root `AGENTS.md` that appears new or **changed** through
   sync, import, publication or a vault switch is inactive until the user
   approves it **on this device** — whatever its signature says. The approval
   binds exactly the files and SHA-256 values the user saw (the pattern of
   SEP-2640, "Skills over MCP"); any change lifts it. Approvals are stored
   device-locally in app data, not in the vault. Names are scoped by origin;
   a skill never silently replaces another. "Arrived or changed, not
   approved" is a visible list in the skills workshop. Memory **facts** stay
   data (tier 3, ADR 0018).
3. **Memory is not policy.** Facts and preferences live in memory; security
   and permission rules are enforced by the policy engine. A memory note
   cannot unlock a capability.
4. **Skills create no rights.** A skill can only narrow what the tools allow.
   Core skills ship with the app (day orientation, weekly review, project
   status, meeting preparation, task triage, research with source capture,
   writing and summarising, mail and calendar capture, knowledge upkeep, link
   cleanup, memory curation, a privacy check before cloud egress, reflection
   on explicitly released personal notes without diagnosis). Twelve of them
   ship with the beta as real skills in the format, read-only: day
   orientation, weekly review, project status, meeting preparation, task
   triage, research, mail and calendar, writing and rewriting, knowledge
   upkeep, link cleanup, the privacy check and reflection. Memory curation
   follows with memory itself. "Research" is the one skill that names the
   internet's tools: what that means for a conversation, and for a skill of
   the vault that names them, is ADR 0019 §11 — a skill still creates no
   right, it names tools a conversation the user starts may carry where the
   vault allows the internet. "Mail and calendar" names the mail tools; their
   first call asks as in any conversation (ADR 0019 §10). Neither is offered
   as a prompt of the MCP server: a client there has its own way onto the
   web and no reach into the user's mail.
5. **Self-improvement is proposal-first.** A reviewer analyses a run, proposes
   memory or skill changes with evidence, shows diff, origin, new rights, cost
   and tests; the user applies, revises or rejects; a new version runs
   observed and rolls back on regression. A self-improvement may never widen
   capabilities, change provider or egress, install dependencies, activate
   scripts, change security rules or approvals, overwrite foreign skills,
   delete or weaken tests, request or store secrets, or approve an arrived
   skill.
6. **Scripts are programmatic access to the same tool API.** A script is a
   package of two files under `.agent/scripts/<name>/`: `manifest.json` —
   what it is for, the tools it may call, the inputs it asks for, its limits
   — and `main.js`, JavaScript that is the body of an async function of
   `input` and `tools`. As built (2026-10-08):
   - **One sandbox for both shells.** The guest is QuickJS compiled to
     WebAssembly, inside a Web Worker of the WebView, one fresh engine
     instance per run and none reused. The code sees the ECMAScript globals
     and nothing else — no file system, no network, no timer, no DOM, no host
     object. Its only way out is `await tools.<name>(…)`, which the host maps
     1:1 onto the tool registry, holds against the manifest, and hands to the
     executor a conversation uses: the same privacy gate, the same folders,
     the same record of what was read. No secret enters the guest. The
     runtime is deliberately not the one first planned (Wasmtime with Extism
     on the desktop, Chicory on Android, a Wasmer spike on iOS); see
     Alternatives.
   - **Limits come from the manifest and are enforced in three places.**
     Seconds of computing (1–30, default 5), memory (8–128 MB, default 32),
     steps (the engine's interrupt handler counts one per 10,000 jumps, and
     the host one per 2,000 pending jobs), tool calls (at most 50, default
     20), and the size of one call's arguments and of the result. The engine
     enforces steps, memory and a 64 KiB stack; the owner of the worker ends
     the worker when the time is over — the only thing that stops code which
     never reaches the interrupt handler, such as a regular expression that
     backtracks for ever —; and core enforces the tool list, the number of
     calls and the sizes. A run that is ended hands nothing back.
   - **A script's approval is this device's signature.** Decision 2 holds
     with one addition. The approval binds the SHA-256 of every file (the
     script's *seal*) and counts only with an Ed25519 signature over the
     vault, the script and the seal, made with a key that is created at the
     first approval and kept in this device's keychain. An approval record
     without a signature that holds — copied from another device, or written
     by whoever can write the app's data — is none: the script is new again.
     The signature is checked at every scan and again before every run.
   - **A publisher's signature informs; it never activates.** A `signature`
     file in the folder (minisign, over the seal) is held against the
     publishers Plainva knows — the key the updater trusts. The review says
     "signed by …", "signed with a key Plainva does not know", or nothing;
     a signature that does not fit the files makes the script invalid. No
     signature replaces the approval on this device.
   - **Checked before it runs.** The manifest is read strictly: an unknown
     field, an unknown tool, a tool no script may call, a limit outside its
     bounds each keep the script from being approved. Invisible characters
     in the manifest or the code make it invalid — code that reads
     differently from how it runs cannot be reviewed. The engine has to
     parse the code before it is approved or written. A dry run calls the
     tools that only read and writes down, without carrying it out, a call
     that would show or change something.
   - **Who starts one.** The user, from the workshop: the run stays on the
     device and nothing of it goes to a model. Or a model in an open
     conversation, through the tool search, as a tool of the class `script`
     (ADR 0019) whose result is a program's output and is fenced as
     untrusted data. Scripts are not offered to a conversation bound to a
     skill, to the MCP server, to a regression run or to a platform model.
   - **Read-only first.** The first version gives scripts the reading tools
     and the app's commands; mutating ones go through the approval chain of
     ADR 0019.
   - **The engine is an interim one.** `@tootallnate/quickjs-emscripten`
     0.23.0 (QuickJS of 2021, ES2020) was already part of the build; a test
     pins the module's hash and the functions it imports, so a new version
     is a new engine that is looked at before it runs anything. It is to be
     replaced by QuickJS-ng before a public release.
7. **Chat history lives in app data, not in the vault** — per vault,
   searchable, with adjustable retention, deletable — because transcripts
   contain excerpts that were sent to a provider and would otherwise sync past
   the policy system. A conversation note (Markdown summary) is opt-in per
   session and, once written, an ordinary vault file under sync and policy
   rules; the transition is shown.
8. **A skill is tested against a model, by hand.** A skill can bring
   scenarios (`tests/scenarios.json`, at most eight): a message that starts
   it, the tools a good run uses and those it must leave alone, the notes its
   answer names, text that must not appear. The regression run in the skills
   workshop runs each scenario as an **ordinary run of its skill** against the
   model a new conversation would use — the same gate, the same send overview,
   the same tools, the same usage ledger — and judges what the run did, never
   its wording. Four rules bound it:
   - **Never by itself.** The run starts from a dialog that first says how
     many scenarios would run against which model. A changed model or a
     changed skill starts nothing; the workshop only says that the last
     result no longer counts.
   - **A ceiling.** An amount in US dollars where the model's price is known,
     a token ceiling always; a model on this device has none, because nothing
     leaves the device and nothing is billed. The ceiling is checked between
     two scenarios — one scenario is bounded by its run limits — and what did
     not run is recorded as not run, not as failed.
   - **A result is about one model and one version.** It is stored per
     device in app data, next to the approvals, with the provider, the model
     and a hash over the skill's files and its scenarios. For another model or
     another version it says nothing, and is shown as that.
   - **Not applicable is not failed.** A scenario that names a note or a path
     the vault does not have was written for another vault — the scenarios of
     the skills that come with the app are written against the test vault. It
     does not run and is counted apart, so a real vault shows neither false
     failures nor false passes.

## Consequences

- A synced vault from another device, a colleague or an import never runs
  new instructions on this device without a look.
- Content-bound approvals mean an edit on another device re-asks here; the
  list of pending approvals keeps that visible rather than silent.
- Plainva skills are portable to other harnesses, and theirs to Plainva, but
  only through the same approval.
- `.agent/` is ordinary vault content to the index and the sync — the shared
  rule for internal paths does not exclude it, and the phone's index carries
  the skills' files (`apps/mobile/e2e-prod/ai-skills.spec.ts`). Skills
  therefore travel with the vault like notes, which is exactly why arriving
  activates nothing.
- A test result does not travel: each device tests against the model it uses,
  and pays for it there.
- Scripts are the same on the desktop and on the phone from their first
  version: there is one sandbox, so there is no "desktop only".
- The desktop's content security policy allows WebAssembly to be compiled
  (`script-src 'self' 'wasm-unsafe-eval'`); `eval` stays forbidden. The native
  smoke test asks the real window for exactly that.
- A script is slow next to native code — QuickJS interprets. That is the
  price of a sandbox with no compiler in it, and scripts are glue between
  tool calls, not number crunching.
- The interrupt handler is not a preemption point: native parts of the
  engine do not reach it. The time limit therefore rests on ending the
  worker, and the end of a run can come up to a second after its limit.

## Alternatives

- **Trust signed skills automatically.** Rejected: provenance attests who
  built something, not that it is benign; the npm incident shows valid
  provenance on hostile hooks.
- **Store approvals in the vault.** Rejected: whoever can write the vault could
  write the approval.
- **Free scripting with Node or Python.** Rejected: an unbounded runtime is
  the shell the tool design exists to avoid.
- **A native WebAssembly runtime per platform** (Wasmtime with Extism on the
  desktop, Chicory on Android, Wasmer on iOS) — the plan until the spike of
  2026-10-08. Rejected: three runtimes are three sandboxes that have to be
  kept equal, so parity would be a promise instead of a construction; a
  compiling runtime in the main process enlarges what has to be trusted; iOS
  allows no compiler outside the WebView, so the third runtime would have
  interpreted anyway. The WebView's own WebAssembly is already there in both
  shells, sandboxed by the platform, and the same guest runs in the unit
  tests under Node.
- **Running the code in the page** — a hidden frame, `new Function`, a
  compartment. Rejected: it shares the heap and the event loop with the app,
  so nothing can take memory or time away from it, and a way out of the
  compartment is a way into the app.
- **Treating a publisher's signature as the approval.** Rejected for the
  reason signed skills are not trusted automatically, and because a script
  that arrives through sync is then active on a device whose user never saw
  it.

## Links

- ADR 0017, ADR 0018, ADR 0019, ADR 0022; the Agent Skills specification;
  SEP-2640 (Skills over MCP).
