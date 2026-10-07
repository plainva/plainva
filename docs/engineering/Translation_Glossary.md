# Translation Glossary

Last reviewed: 2026-10-07. Reference for ALL translation work (locale JSONs, vault
templates, user guide). Every session that touches strings follows these
conventions — this keeps subsequent translations consistent, even without
native-speaker review.

## Supported Languages

Source of truth: `packages/ui/src/services/languages.ts` (`APP_LANGUAGES`).
Language code = BCP-47 = locale JSON basename = folder name under `docs/user/`.

## Invariants (never translate)

- Product/format names: **Plainva**, **OKF** (Open Knowledge Format), **Markdown**,
  **Frontmatter**, **CommonMark**, **Obsidian**, `.base`, `index.md`.
- Service/technology names: WebDAV, Nextcloud, Google Drive, OneDrive, Dropbox, S3
  (including provider examples like R2/MinIO), OAuth, PKCE.
- Frontmatter keys and values: `type`, `okf_version`, `description`, `plainva:*` —
  never localize these in user-guide code examples.
- Interpolation placeholders `{{...}}` (e.g. `{{count}}`, `{{name}}`, `{{date}}`,
  `{{time}}`, `{{title}}`): keep the token exactly as is; its position in the
  sentence is free.
- Palette/theme PROPER NAMES: Nord, Solarized, Gruvbox, Catppuccin (Latte/Mocha),
  LCARS, Antonio. Descriptive theme names (Papier, Sepia, Wald, Mitternacht,
  Hoher Kontrast, Phosphor) ARE translated (as de demonstrates).
- Star Trek quotes: canonical data lives in `services/startrekQuotes.ts`, NOT in
  the i18n JSONs; per language, only attested original dub lines — never a free
  translation.
- Method proper names in vault templates: PARA, Zettelkasten, ACE, "Linking Your
  Thinking", Maps of Content (MOC), Johnny.Decimal, GTD/Getting Things Done, as
  well as the personal names (Tiago Forte, Niklas Luhmann, Nick Milo, David Allen).
- Keyboard shortcuts (Ctrl, Cmd, Alt, Shift + letter) and the term "Vault" in all
  languages that use Latin script.

## Forms of Address and Core Terms per Language

| Code | Native Name | Form of Address/Tone | "Vault" | Plural Suffixes (JSON) |
|---|---|---|---|---|
| en | English | you, direkt | Vault | `_one`, `_other` |
| de | Deutsch | Du (capitalized), informal | Vault | `_one`, `_other` |
| fr | Français | vous (Software-Standard) | Vault (m., « le vault ») | `_one`, `_many`, `_other` |
| es | Español | tú, informell | Vault (m.) | `_one`, `_many`, `_other` |
| pt-BR | Português (Brasil) | você | Vault (m.) | `_one`, `_many`, `_other` |
| it | Italiano | tu, informell | Vault (m.) | `_one`, `_many`, `_other` |
| nl | Nederlands | je/jij | Vault (m.) | `_one`, `_other` |
| pl | Polski | impersonal preferred, otherwise „ty" (lowercase) | Vault (m., odm. „vaultu") | `_one`, `_few`, `_many`, `_other` |
| zh-CN | 简体中文 | 你 (not 您) | 仓库 (wie Obsidian zh) | `_other` |
| ja | 日本語 | です・ます style, no pronoun | 保管庫 (wie Obsidian ja) | `_other` |

Notes:

- The vault's word is the one of the table in every new string and page. Older
  strings drifted: between about 15 and 65 keys per language still say bóveda,
  coffre, kluis, sejf, cofre or 保险库 (counted 2026-10-07), and some user-guide
  pages use the same words. A page quotes a UI string as it is; new wording
  never copies the drift.
- Plural suffixes: always create ALL listed categories (even if `_many` only
  applies starting in the millions) — the parity test requires at least the
  categories reported by `Intl.PluralRules` and allows supersets
  (ICU-version-robust).
- zh-CN: no spaces between Han characters and punctuation; Western digits are
  fine; Chinese punctuation (，。？) in running text, but placeholders/code
  examples remain unchanged.
- ja: katakana for loanwords (タブ, テーマ, リンク, テンプレート); UI labels stay
  concise, user-guide running text uses です・ます.
- Terminology register: the respective locale JSON is the authoritative term
  register for its language. User-guide pages adopt UI terms VERBATIM (bolded)
  from `packages/ui/src/locales/<code>.json`; vault-template prose uses the
  same terms.

## AI terms (KI harness)

The assistant's words, fixed so that locales, the user guide and the suggestion author line agree.
The skill titles are UI strings (`ai.skills.*`); the MCP prompt names (`daily-orientation`,
`weekly-review`, `project-status`) are identifiers and never translated.

| Language | AI | Companion | Skills | Suggestion author |
|---|---|---|---|---|
| en | AI | companion | Skills | Plainva AI · ⟨model⟩ |
| de | KI | Begleiter | Skills | Plainva KI · ⟨Modell⟩ |
| fr | IA | compagnon | Compétences | Plainva IA · ⟨modèle⟩ |
| es | IA | compañero | Habilidades | Plainva IA · ⟨modelo⟩ |
| pt-BR | IA | assistente | Habilidades | Plainva IA · ⟨modelo⟩ |
| it | IA | compagno | Competenze | Plainva IA · ⟨modello⟩ |
| nl | AI | begeleider | Vaardigheden | Plainva AI · ⟨model⟩ |
| pl | AI | asystent | Umiejętności | Plainva AI · ⟨model⟩ |
| zh-CN | AI | 悬浮窗 | 技能 | Plainva AI · ⟨模型⟩ |
| ja | AI | コンパニオン | スキル | Plainva AI · ⟨モデル⟩ |

**External tools (MCP)** (`ai.ext.*`): tools of MCP servers the user connected. An
entry is a **server** — never a "service", which the app uses for the services of an
account — and never an "AI app", which is the other direction (`ai.mcp.*`, apps that
read the vault). The tool word is the one of `ai.overview.tools`; a server's ready-made
requests are **prompts**, the loanword, in every Latin-script language. "Review" is
the verb of the skills' "Review and approve", "Approve" its second half.

| Language | External tools (MCP) | Server | Access token | Prompts | Sandbox |
|---|---|---|---|---|---|
| en | External tools (MCP) | server | access token | prompts | sandbox |
| de | Externe Werkzeuge (MCP) | Server | Zugangstoken | Prompts | Sandbox |
| fr | Outils externes (MCP) | serveur | jeton d'accès | prompts | bac à sable |
| es | Herramientas externas (MCP) | servidor | token de acceso | prompts | entorno aislado |
| pt-BR | Ferramentas externas (MCP) | servidor | token de acesso | prompts | sandbox |
| it | Strumenti esterni (MCP) | server | token di accesso | prompt | sandbox |
| nl | Externe hulpmiddelen (MCP) | server | toegangstoken | prompts | sandbox |
| pl | Narzędzia zewnętrzne (MCP) | serwer | token dostępu | prompty | piaskownica |
| zh-CN | 外部工具（MCP） | 服务器 | 访问令牌 | 提示词 | 沙盒 |
| ja | 外部ツール（MCP） | サーバー | アクセストークン | プロンプト | サンドボックス |

**External agents** (`ai.agent.*`): an AI program of another maker that Plainva starts
in a vault's folder. It is an **agent** — never the "assistant", which is Plainva's
own, and never an "AI app", which reads the vault through Plainva (`ai.mcp.*`). What
it has in the AI tab is a **session**, never a "conversation": a conversation is the
assistant's and has a history, a session has neither. What it proposes is signed with
the user's name for it and the words "external agent". Where the language says "start
a session" for signing in (es *iniciar sesión*), the session's own buttons take
another verb (**Empezar la sesión**, **Terminar la sesión**), and the sign-in keeps
the usual one.

| Language | External agents | Session | Suggestion author | Sign-in |
|---|---|---|---|---|
| en | External agents | session | ⟨name⟩ (external agent) | sign-in |
| de | Externe Agenten | Sitzung | ⟨Name⟩ (externer Agent) | Anmeldung |
| fr | Agents externes | session | ⟨nom⟩ (agent externe) | connexion |
| es | Agentes externos | sesión | ⟨nombre⟩ (agente externo) | inicio de sesión |
| pt-BR | Agentes externos | sessão | ⟨nome⟩ (agente externo) | login |
| it | Agenti esterni | sessione | ⟨nome⟩ (agente esterno) | accesso |
| nl | Externe agents | sessie | ⟨naam⟩ (externe agent) | aanmelding |
| pl | Agenci zewnętrzni | sesja | ⟨nazwa⟩ (agent zewnętrzny) | logowanie |
| zh-CN | 外部智能体 | 会话 | ⟨名称⟩（外部智能体） | 登录 |
| ja | 外部エージェント | セッション | ⟨名前⟩（外部エージェント） | サインイン |

**Siri and Shortcuts** (`ai.system.*`, and the two string catalogs of the iOS app,
`PlainvaIntents.xcstrings` and `AppShortcuts.xcstrings`): the system's assistant on
an iPhone or iPad. *Siri* is never translated; *Shortcuts* takes the name the system
itself shows in that language. What the system may read is a **list of note titles**
— never "index" (the search's) and never "directory" (a folder); a title is
**passed on**, not "sent" (that is a message to a provider) and not "shared" (that is
a workspace). The four actions are named as the catalog names them, and the user
guide quotes them from there: they are the only UI terms of the guide that do not
come from a locale file. A spoken phrase must contain the app's name unchanged, so
it stays undeclined where the language would decline it (pl *w Plainva*).

| Language | Shortcuts | Add Journal Entry | Add Task | Open Note | Search Notes |
|---|---|---|---|---|---|
| en | Shortcuts | Add Journal Entry | Add Task | Open Note | Search Notes |
| de | Kurzbefehle | Journal-Eintrag hinzufügen | Aufgabe hinzufügen | Notiz öffnen | Notizen durchsuchen |
| fr | Raccourcis | Ajouter une entrée de journal | Ajouter une tâche | Ouvrir une note | Rechercher des notes |
| es | Atajos | Añadir entrada de diario | Añadir tarea | Abrir nota | Buscar notas |
| pt-BR | Atalhos | Adicionar entrada do diário | Adicionar tarefa | Abrir nota | Buscar notas |
| it | Comandi Rapidi | Aggiungi voce di diario | Aggiungi attività | Apri nota | Cerca note |
| nl | Opdrachten | Journaalitem toevoegen | Taak toevoegen | Notitie openen | Notities doorzoeken |
| pl | Skróty | Dodaj wpis do dziennika | Dodaj zadanie | Otwórz notatkę | Szukaj notatek |
| zh-CN | 快捷指令 | 写日志 | 添加任务 | 打开笔记 | 搜索笔记 |
| ja | ショートカット | ジャーナルに記入 | タスクを追加 | ノートを開く | ノートを検索 |

Two terms that must not borrow a word the app already uses for something else
(`ai.capture.action`, `ai.skills.research.title`): **Keep as a note** — an AI
answer kept as a note — is never the label of the mail-to-note action ("Save
as note" and its translations); its verb is the one of "Keep conversations".
The skill **Research** never uses the word of the search field.

| Language | Keep as a note | Research (the skill) |
|---|---|---|
| en | Keep as a note | Research |
| de | Als Notiz festhalten | Recherche |
| fr | Conserver comme note | Se documenter |
| es | Conservar como nota | Investigación |
| pt-BR | Manter como nota | Investigar |
| it | Conserva come nota | Documentarsi |
| nl | Bewaren als notitie | Onderzoek |
| pl | Zachowaj jako notatkę | Badanie tematu |
| zh-CN | 保留为笔记 | 调研 |
| ja | ノートとして残す | リサーチ |

## Daily note and journal (zh-CN)

The daily note (one note per day, named by the vault's date format) and the
journal (time-stamped lines under a heading of that note) are two things, and
zh-CN names them apart:

| Term | zh-CN |
|---|---|
| Daily note | 日记 (Obsidian's term) |
| Journal | 日志 |
| Journal entry | 日志条目 |

日记 is used everywhere — UI, user guide, vault templates and tour lessons; 每日笔记
is retired (decision 2026-09-24). 日志 also names technical logs such as the
deletion log. `apps/desktop/src/translationTerms.test.ts` fails when a retired
variant comes back or a daily-note string loses 日记.

## Process Rules

- New UI strings are ALWAYS added to all files under `packages/ui/src/locales/`
  at the same time (the parity test enforces this).
- User-visible changes require updating the user-guide pages in ALL language
  folders (mandatory working rule; details in the internal AI workflow,
  maintainer workspace).
- The README.md of the machine-translated user-guide languages carries a subtle
  marker line ("machine-translated — corrections welcome", in the target
  language); de/en carry none.
- Vault-template language versions live in `packages/ui/src/vaultTemplates/`
  as `templates.<code>.ts`; if a language is missing, `getVaultTemplates` falls
  back to en.

## Database metadata and summaries

The German timeline view is **Zeitleiste**; use **Zeitleistenansicht** in prose
when naming the view as a compound noun. This applies in both shells, keyboard
help and the guide. The Italian view terminology is already consistent.

Use these UI terms in the guide and tour. A summary belongs to the whole visible column; a rollup belongs to one related record. Labels name the pinboard’s configured property, while whole-note tags include inline tags.

| Language | Summary | No summary | Header colour | Whole-note tags |
|---|---|---|---|---|
| en | Summary | No summary | Header color | Tags · whole note |
| de | Zusammenfassung | Keine Zusammenfassung | Farbstreifen | Tags · ganze Notiz |
| fr | Synthèse | Aucune synthèse | Bande de couleur | Tags · note entière |
| es | Resumen | Sin resumen | Franja de color | Etiquetas · nota completa |
| pt-BR | Resumo | Sem resumo | Faixa de cor | Tags · nota inteira |
| it | Riepilogo | Nessun riepilogo | Fascia di colore | Tag · intera nota |
| nl | Samenvatting | Geen samenvatting | Kleurstrook | Tags · hele notitie |
| pl | Podsumowanie | Bez podsumowania | Pasek koloru | Tagi · cała notatka |
| zh-CN | 汇总 | 不汇总 | 顶部色条 | 标签 · 整篇笔记 |
| ja | 集計 | 集計なし | ヘッダーの色 | タグ · ノート全体 |

Tour lessons live beside the template modules as `tourLessons.<code>.json`; all ten languages share the builder and creation boundary.

A pinboard's **New entry** (window on the desktop, page on the phone) builds on the database's **Entry**: the same noun, never a second word for it. **Inherited** names the values the entry takes over from the board's active labels and the view's filters. **Discard** throws away what was written into THIS entry — keep it apart from **Delete**, which removes an existing note.

| Language | New entry | Inherited | Discard |
|---|---|---|---|
| en | New entry | Inherited | Discard |
| de | Neuer Eintrag | Übernommen | Verwerfen |
| fr | Nouvelle entrée | Hérité | Abandonner |
| es | Nueva entrada | Heredado | Descartar |
| pt-BR | Nova entrada | Herdado | Descartar |
| it | Nuova voce | Ereditato | Scarta |
| nl | Nieuw item | Overgenomen | Weggooien |
| pl | Nowy wpis | Przejęte | Odrzuć |
| zh-CN | 新建条目 | 沿用 | 丢弃 |
| ja | 新しいエントリー | 引き継ぎ | 破棄 |
