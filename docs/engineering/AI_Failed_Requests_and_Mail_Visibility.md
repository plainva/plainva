# Failed AI requests and what the assistant reads of a mail

Status: 2026-11-26 (plan Umsetzung 0.9.x, B7). Two rules, each written down as a table before the code that holds it:

1. **"Nothing was sent" is a fact of the run.** The assistant withdraws a typed question and says that nothing was sent only where nothing of the run left the device (table 1).
2. **The assistant reads of a mail only what the reader shows a person** — judged by the engine of the device, at the widths that are measured, with the limits that remain (table 2).

## 1. What can leave the device in one run

A *run* is one message the user sent (or "Send again"): the context is put together, the send overview may ask, the model is called, tools may run, the run is written.

| Way out | Where in the code | Before / after the model call | Carries | How the session learns it left |
|---|---|---|---|---|
| The question embedded for the search (a cloud search model) | `AiSession.contextOf` → `AiVaultHost.candidates` → `gatherCandidates` (`aiVaultHost.ts`) → `semanticCandidates` → `LocalEmbeddings` → `fetchProviderJson(host.egress, …)` (`localEmbeddings.ts`); `host.egress` is `session.egress` (`useDesktopEmbeddings.ts`, `mobileEmbeddings.ts`) | before | the question | through the session's egress (`departingEgress`) |
| The model call | `AiSession.execute` → `runAgent` → `runModelCall(this.out, …)` | — | the conversation | through the session's egress |
| The reader without tools (mail, appointment descriptions) | `createPrivateDataExecutor({ egress: this.out })` (`privateData.ts`) | after (a tool call) | a stranger's text | through the session's egress |
| Reading a page, a web search | `createWebExecutor({ egress: this.out, fetcher: host.web })` (`webTools.ts`): the fetch goes natively (`ai_web.rs`, `AiWebPlugin`), the page's processing through the egress | after (a tool call) | the address / query; the page to the model | the processing through the egress; the fetch only follows a tool call, which follows an answer |
| Foreign servers (MCP) | `createMcpExecutor` → `this.mcp.call(…)` | after (a tool call) | the call's arguments | only follows a tool call, which follows an answer |
| Mail and calendar searches | the vault's tools (`mailTools.ts`, `eventDetails.ts`) through the shell's mail and calendar clients | after (a tool call) | the search words | only follows a tool call, which follows an answer |
| Scripts | `createScriptExecutor` — the sandbox reaches only the conversation's own tools | after (a tool call) | — | (their tools are the rows above) |
| Listing a foreign server's tools at the start of a conversation | `this.mcp.manifests(…)` | before | nothing of the user's (the server's tool list is asked for) | not counted: no word of the user leaves |
| Title, summary of a conversation | written on the device (`conversationTitleFrom`) | — | — | nothing leaves |
| Learning, memory, routines, gists, the setup's test | runs of their own, through the session's egress | — (another run) | their own material | through the session's egress; a typed run never claims them |

**The fact.** Every request to any model — the chat, the search's embedding, the reader without tools, a page's processing, a transcription — passes the session's egress `this.out`. `departingEgress` wraps it once (`aiSession.ts`) and counts every request to a recipient that is not on this device, unless the egress answered it "never sent" (a refusal of the first class, `failureClassOf`) before anything came back; a request that throws, is cancelled, or ends in any other way counts. A run notes the count when it begins (`departedAt`). The turn of a typed question is withdrawn only where the count did not grow during the run — whatever left, or something else at the same time (in doubt), keeps the turn. Everything that is not a model request (the fetch of a page, a foreign server's call, a mail search) is reached only through a tool call, and a tool call only follows a model's answer — a run with one never withdraws (`received`, `turns == userTurn + 1`).

**The guard.** `apps/desktop/src/ai/aiEgressOneWay.test.ts` reads the sources: the desktop's `ai_http` is called in its egress alone, the phone's `AiNet` plugin is reached in its egress alone, each shell makes its egress once and hands it to `new AiSession`, and the session takes it in one place, wrapped by `departingEgress`. A new way to the native egress fails the commit.

**When the model call never went but something left before it.** The turn stays (second class: "Send again" in place), the notice names no "nothing was sent": a refusal whose words say so (`too_large`, `invalid_request`, `window_too_small`, `local_only`) is shown as `errors.somethingWentWrong` until a text of its own is decided; `unreachable` says "Could not reach …" (`ai.error.offline`), `no_key` and `unknown_endpoint` say what they say (none of them claims nothing was sent). The endpoints the run reached are kept with the notice (`departedTo`).

## 2. What the person sees in the mail reader, and what the engine measures

The walk over the reader's tree (`htmlVisibleText.ts`) leaves out what an element hides by its own style. What only the place of other boxes hides is asked of the engine (`engineVisibility.ts`).

| What decides what the person sees | Desktop | Phone / tablet | What the engine measures | Where it differs, what follows |
|---|---|---|---|---|
| Width of the reader | the frame is `width:100%` of the mail column (`mail.css`), any width; fitted (`applyFrameFit`) | the screen's width (portrait, landscape, split view, tablet), fitted with `growHeight` | 343 and 760 px, and the width the reader of this device showed a mail in last (`noteMailReaderWidth`, from `MailView.tsx` and `MailMessageScreen.tsx` at every fit, kept on the device) — before any mail was opened, the window's width | **Limit:** a width the person chooses later (a wider column, rotating the phone) can show differently from what the assistant read. Named in the guide. |
| Height | the frame has its own height and scrolls | the frame grows (`growHeight`) | the frame grows (`growHeight`) | scrolling inside the desktop frame reaches every line the grown frame shows: a word below the fold is reached by scrolling; nothing is clipped by the frame's height (the frame scrolls, `overflow` stays the document's). |
| Pictures from the network | shown after the person's choice (per message or always) | the same | never loaded; a remote picture is measured as **as large as it can be** where it has no size (see below) | see "remote pictures" |
| Dark mode / the theme's canvas | the theme's colours only for a mail that sets none | the same | the white sheet | colours decide contrast, which the walk judges; the engine judges covering, which colours do not change |
| Font size, zoom | the app's zoom scales the window; the mail's own sizes stand | the system's text size does not reach the frame | the frame's own sizes | the app's zoom scales everything alike, nothing comes to lie over anything else |
| Text direction overrides (U+202D, U+202E, `<bdo>`, `unicode-bidi: bidi-override`) | drawn mirrored | the same | the text under the override is found | it is not read (see below); right-to-left text, embeddings (U+202A, U+202B) and isolates (U+2066–2069) are no override and are read |

**Remote pictures.** The engine loads nothing from the network. A picture from the network without a width of its own is measured as wide as its box lets it be (the frame keeps every picture inside its box, `img{max-width:100%}`), and without a height of its own as tall as the whole mail laid out. That is as large as it can be where it can cover anything: a picture in the flow covers only words that run into it from before it — whatever follows it is pushed below it —, and nothing that runs out of an earlier box reaches further down than the mail itself. A picture with a size of its own keeps it.

**Cost.** Each text is first asked as a whole; only a text that meets something that paints, a later text, a clipping edge or the frame's edge is asked word by word. The pass gives the interface its turn after at most 12 ms and has a budget of 3 seconds for a mail; past the budget the assistant reads nothing of the mail and is told that it was too long to check in time (`TOO_LONG_TO_CHECK_BODY`, not the notice for a message that cannot be shown safely). The budget is chosen from the measurement in `Performance_Notes.md` ("The mail engine pass for the assistant"); not measured on a real phone.

**Direction overrides.** A direction override (U+202D, U+202E up to U+202C, `<bdo>`, `unicode-bidi: bidi-override`) draws the letters in the order they are written whatever their direction: a person sees them mirrored, a machine reads them plainly — a known way to show text that only a machine reads. Its text is blanked for the assistant. Right-to-left mail does not use it: Arabic and Hebrew run through the bidirectional algorithm, `dir="rtl"`, embeddings and isolates, none of which is an override; the gate holds that such mails keep every word.

**When the pass cannot finish.** Where the engine is there but the pass cannot finish — the frame does not load in five seconds, lays nothing out, the budget is spent, anything throws — the assistant reads nothing of the mail (`UNREADABLE_BODY`). Only where there is no layout engine at all (a test runner) the walk's reading stands; every web view of the app has one. Appointment descriptions are read through the walk alone: they have no reader frame.
