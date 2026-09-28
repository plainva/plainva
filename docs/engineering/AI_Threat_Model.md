# AI harness threat model

Scope: the AI harness in both shells, Plainva's MCP server and client, skills and scripts (ADR 0016–0021). It complements the [encrypted workspace threat model](Encrypted_Workspace_Threat_Model.md). Every control named here has a test or an eval in CI, or a package that builds it; nothing is "later" without a trigger.

## What is protected

- **Vault content**, above all what the policy keeps local (`plainva.ai: {cloud: deny}`, folder rules, encrypted workspaces) and the sensitive classes (mood, place stamps).
- **Provider keys and account tokens** (keychain, `SecureStore`).
- **The user's approval** — the one grammar of proposals, and the scope approval of the send overview.
- **Third parties** — mail recipients, event attendees, members of shared workspaces.
- **Device integrity** — nothing the harness does may run code outside the declared tools.

## Who attacks, and from where

| Entry | Example |
|---|---|
| Prompt injection in tier 3 content | a note synced from another device or imported from a web clipper, a mail, an event description, a web page, an MCP tool result, script output |
| Content that arrives as instructions | a skill, memory rule, routine or vault-root `AGENTS.md` that appears through sync, import or a shared folder |
| Local processes | anything running as the user, reaching for the MCP channel |
| The WebView | script that runs through a rendering bug in untrusted content |
| Providers and gateways | a recipient that stores more than promised, a gateway the user did not choose |
| The model itself | a wrong tool call, a wrong edit, an invented source |

## Threats and controls

| # | Threat | Controls | Proof |
|---|---|---|---|
| T1 | **Rendering beacon:** an injected `![](https://host/?d=…)`, reference image, `//` URL, HTML `<img>`, `srcset` or CSS `url()` in AI-written text fires when the preview renders it — past the send overview | pre-write linter makes every non-allowed network destination inert wherever it stands (`https[://]…`), independent of Markdown parsing | `packages/core/src/ai/injectionCorpus.test.ts` — a real CommonMark/GFM parser is the oracle |
| T2 | **Exfiltration through tools** (web fetch with data in the URL, a mail to the attacker) | web tools off until switched on per vault; Rule of Two (approval per outside effect when a run has untrusted input, private data and effects); privileged planner and quarantined processor (P4); egress allowlist in the native egress | `ruleOfTwo` tests; P4 injection gate |
| T3 | **Key theft** | keys never enter the WebView: the native egress reads them by purpose-bound slot and inserts them itself; no AI path uses `keychain_get` | P1a gate: no key in any return value, event, error text, log or prompt |
| T4 | **Unwanted writes** | writing means proposing (author `plainva-ai/<model>`); critical class (delete, bulk, rename, `plainva.ai.*`, `.agent/`, OKF trust fields) needs dry run and confirmation; delete only through the deletion guard; version history | P1.5 and P5 gates |
| T5 | **Policy bypass** — a denied note reaching a cloud recipient | hard gate before scoring; titles of denied notes redacted in backlink anchors and relation values; the native egress re-checks the recipient | `policy.test.ts` (gate, redaction, case and Unicode forms of folder names) |
| T6 | **Instruction smuggling** — invisible tag characters, bidi overrides, forged fences | tier 3 only inside `<untrusted_data>` blocks; format characters (`\p{Cf}`, the tag block included) stripped; forged opening or closing tags escaped | `injectionCorpus.test.ts` |
| T7 | **Hostile skills and rules via sync** | nothing becomes active by arriving: approval per device, bound to the SHA-256 of the files seen, stored outside the vault | P3 gate |
| T8 | **Local processes against the MCP server** | no listening port; named pipe or Unix socket for the signed-in user only; pairing per client; grants per client and folder; audit | P1b gate: a test against the process's open sockets |
| T9 | **Path escapes at the native boundary** | symlinks and junctions resolved before checking; NUL, `..` and mixed separators rejected | P1b path cases |
| T10 | **Rug pull by an MCP server** (client side) | tool descriptions, prompts and instructions hashed and compared on every reload; any change blocks the server; descriptions capped at 2,048 characters | P4.5 gate |
| T11 | **Silent change of recipient** | a failover never changes the provider or model the user approved; the egress policy applies before any choice | P1a |
| T12 | **Sensitive classes** | mood and place lines never enter a package automatically; place lines redacted before egress | P1b |
| T13 | **Encrypted workspaces** | cloud off by default; AI suggestions only once the sealed comment path carries the author | ADR 0016 |
| T14 | **Unattended runs** | fail-closed; never all three Rule of Two properties; reduced budget; mandatory conversation note | P8 gate |
| T15 | **Supply chain on the key path** | own thin provider adapters, no provider SDK, no telemetry (ADR 0016) | conformance suite |

## Reviews made for P0

- **CSP.** The desktop CSP allows `img-src 'self' blob: https: data:` and `connect-src 'self' https: ipc:`; the HTTP plugin allows `https://**` and `http://**`. Remote images in notes are a feature and stay. AI-written content goes through the pre-write linter before it is stored (T1), and AI calls do not use the WebView's network at all — they run through the native egress with its own allowlist. A per-vault switch "load remote images in notes" (like mail's `allowRemoteImages`) would narrow T1 further for content the user wrote; it is a candidate, not part of the harness.
- **CORS.** Irrelevant for the harness: provider calls run in Rust, Kotlin and Swift, not through the browser's `fetch`. For the record: Anthropic allows browser calls with an explicit opt-in header, OpenAI and Gemini do not.
- **Telemetry.** No provider SDK, so no SDK telemetry to audit; the adapters send nothing but the request (conformance suite).

## Residual risks

- A script running in the WebView (a rendering bug) can use the session — ask the harness things, read what the WebView can read — but it cannot read keys, widen the egress allowlist or bypass the approval of proposals, which the native side and the user carry.
- Renderer extensions (diagrams, math) that fetch or link on their own are reviewed with the proposal surfaces (P1.5): the linter covers Markdown and HTML destinations, not a diagram language's own link syntax.
- A person can approve a harmful proposal. The proposal shows the full diff, the author, and what the linter defused; it does not decide for them.
- Malware running as the user can read the vault files directly; no harness design changes that.
