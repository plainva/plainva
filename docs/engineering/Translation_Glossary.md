# Translation Glossary

Last reviewed: 2026-07-04. Reference for ALL translation work (locale JSONs, vault
templates, user guide). Every session that touches strings follows these
conventions — this keeps subsequent translations consistent, even without
native-speaker review.

## Supported Languages

Source of truth: `apps/desktop/src/services/languages.ts` (`APP_LANGUAGES`).
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
- Terminology register: the respective locale JSON is the authoritative term
  register for its language. User-guide pages adopt UI terms VERBATIM (bolded)
  from `apps/desktop/src/locales/<code>.json`; vault-template prose uses the
  same terms.

## Process Rules

- New UI strings are ALWAYS added to all files under `apps/desktop/src/locales/`
  at the same time (the parity test enforces this).
- User-visible changes require updating the user-guide pages in ALL language
  folders (mandatory working rule; details in the internal AI workflow,
  maintainer workspace).
- The README.md of the machine-translated user-guide languages carries a subtle
  marker line ("machine-translated — corrections welcome", in the target
  language); de/en carry none.
- Vault-template language versions live in `apps/desktop/src/services/vaultTemplates/`
  as `templates.<code>.ts`; if a language is missing, `getVaultTemplates` falls
  back to en.
