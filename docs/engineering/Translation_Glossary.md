# Translation Glossary

Last reviewed: 2026-10-30. Reference for ALL translation work (locale JSONs, vault
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

- Plural suffixes: always create ALL listed categories (even if `_many` only
  applies starting in the millions) — the parity test requires at least the
  categories reported by `Intl.PluralRules` and allows supersets
  (ICU-version-robust).
- zh-CN: no spaces between Han characters and punctuation; Western digits are
  fine; Chinese punctuation (，。？) in running text, but placeholders/code
  examples remain unchanged.
- ja: katakana for loanwords (タブ, テーマ, リンク, テンプレート); UI labels stay
  concise, user-guide running text uses です・ます.
- ja, zh-CN — bold next to running text: `**` opens or closes bold only where
  CommonMark lets it, and a bold run that begins or ends with punctuation or a
  symbol ("…", "：", "）", "⋮", "+") and touches a letter on its outside is not
  read as bold — the asterisks stay on the page, or the wrong words turn bold.
  Set one blank on the outside of such a run (`右上の **⋮** メニュー`,
  `**连接账户…** 中选择`, `**系统要求：** 在 iPhone 上`); it is the one blank the
  zh-CN rule above does not forbid. `apps/desktop/src/docsEmphasis.test.ts`
  parses every page of the guide and fails a marker that is not read as the
  one it was written as, in any language.
- Terminology register: the respective locale JSON is the authoritative term
  register for its language. User-guide pages adopt UI terms VERBATIM (bolded)
  from `packages/ui/src/locales/<code>.json`; vault-template prose uses the
  same terms.

## Due dates (nl)

Dutch had four words for one thing — "te doen", "met einddatum", "vervaldatum"
and "vervallen" (which reads as "expired") — and "Due" in the phone's Today
tab said "to do". Plainva follows the Microsoft To Do wording (decision
2026-10-24):

| Term | nl |
|---|---|
| Due date | vervaldatum |
| Due (a task that is due) | vervalt (vervalt vandaag, vervalt om 14:00) |
| With due date | met vervaldatum |
| Overdue | te laat |

"Einddatum" stays the end date of a timeline bar or an event. "Te doen" stays a
status option ("te doen → bezig → klaar"). `apps/desktop/src/translationTerms.test.ts`
fails when "met einddatum" or "Vervallen taken" comes back.

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

## Settings terms that must stay apart

The settings pages name three German things with three German words. Languages that
collapse two of them into one word make a path like "Appearance → Display" or
"Access → Access" read as a repeat, and the user guide can no longer say which one it
means. Keep them apart in every language (decision 2026-10-30):

| Language | Appearance (page, `settings.sectionAppearance`) | View (group, `settings.groupView`: reading/editing view) | Display (group, `settings.groupDisplay`: motion, density, zoom, third column) |
|---|---|---|---|
| en | Appearance | View | Display |
| de | Erscheinungsbild | Ansicht | Darstellung |
| fr | Apparence | Vue | Affichage |
| es | Apariencia | Vista | Visualización |
| pt-BR | Aparência | Visualização | Exibição |
| it | Aspetto | Vista | Visualizzazione |
| nl | Uiterlijk | Weergave | Schermweergave |
| pl | Wygląd | Widok | Wyświetlanie |
| zh-CN | 外观 | 视图 | 显示 |
| ja | 外観 | ビュー | 表示 |

nl: "Weergave" is the word for a view (database view, reading view, `leesweergave`),
so the page is "Uiterlijk" and the display group "Schermweergave" — never "Weergave"
for all three. ja: "ビュー" is the view (閲覧ビュー, 編集ビュー, database ビュー), "表示"
the display/presentation group, "外観" the page.

The card on a cloud account's page and the row inside it are two things too:
"Zugang auf diesem Gerät" (`cloudAccounts.accessGroup`: server, user, keys and the
sign-in line) and "Anmeldung auf diesem Gerät" (`accountAccess.lineLabel`, with the
provider titles "Google-Anmeldung …"): the sign-in itself.

| Language | Access card (`cloudAccounts.accessGroup`) | Sign-in row (`accountAccess.lineLabel`) |
|---|---|---|
| en | Access on this device | Sign-in on this device |
| de | Zugang auf diesem Gerät | Anmeldung auf diesem Gerät |
| fr | Accès sur cet appareil | Connexion sur cet appareil |
| es | Acceso en este dispositivo | Inicio de sesión en este dispositivo |
| pt-BR | Acesso neste dispositivo | Login neste dispositivo |
| it | Connessione su questo dispositivo | Accesso su questo dispositivo |
| nl | Toegang op dit apparaat | Aanmelding op dit apparaat |
| pl | Dostęp na tym urządzeniu | Logowanie na tym urządzeniu |
| zh-CN | 此设备上的访问 | 此设备的登录方式 |
| ja | このデバイスでのアクセス | この端末のログイン |

it: "accesso"/"accedi" is the word for signing in throughout the file (Accesso standard,
Accedi di nuovo), so the access card is "Connessione" — never "Accesso" for both.

fr addresses the user with "vous" everywhere (see the table above); the settings,
cloud-account and connect texts had drifted into "tu" and were brought back
(2026-10-30). `apps/desktop/src/translationTerms.test.ts` is the place to pin it if
it drifts again.

ja: the authorization code of the connect assistant (`connectAccess.*.authCode`) is
"認証コード" everywhere; "認可コード" is not used.

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
