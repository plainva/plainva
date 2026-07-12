// Shared, shell-independent UI layer (ADR 0011). Consumed as TypeScript
// source through the workspace; nothing in this package may import shell
// APIs (@tauri-apps/*, @capacitor/*) — platform capabilities are injected
// by the consuming app shell. apps/desktop/src/sharedUiPurity.test.ts
// enforces the import ban.

// Pure helpers and view-models
export * from "./lib/bookmarksFile";
export * from "./lib/calendarGrid";
export * from "./lib/concurrencyLimiter";
export * from "./lib/conflictFiles";
export * from "./lib/editableField";
export * from "./lib/externalUpdateDecision";
export * from "./lib/fuzzyScore";
export * from "./lib/inlineMarkdown";
export * from "./lib/linkParser";
export * from "./lib/markdownToHtml";
export * from "./lib/markdownToPlainText";
export * from "./lib/noteTitle";
export * from "./lib/occurrenceSnippet";
export * from "./lib/peekHistory";
export * from "./lib/searchJump";
export * from "./lib/searchSnippet";
export * from "./lib/taskToggle";
export * from "./lib/textDiff";
export * from "./lib/treeFiles";
export * from "./lib/treeReveal";
export * from "./lib/typography";
export * from "./lib/useDebouncedValue";
export * from "./lib/useStableHandler";
export * from "./lib/wordCount";

// .base database layer (R4.1): the Obsidian-compatible (de)serialization,
// the filter-expression model/mutators and the board grouping helpers —
// shared so the mobile shell edits databases through the SAME contract
// (never hand-written YAML).
export * from "./base/baseFormat";
export * from "./base/baseRelations";
export * from "./base/boardOrder";
export * from "./base/filterExpr";
export * from "./base/newItemNaming";
export * from "./base/propertyModel";
export * from "./base/renameProperty";
export * from "./base/templateFiles";

// App-language registry (the i18n singleton itself is a side-effect module,
// exported only via the "@plainva/ui/i18n" subpath)
export * from "./services/languages";

// Central OAuth app registrations (public client identifiers, shared by
// the desktop and mobile shells)
export * from "./services/providerDefaults";

// Platform-services contract: shell capabilities injected by the app
export * from "./platform/settings";
export * from "./platform/credentials";
export * from "./platform/services";

// React primitives and shared hooks
export * from "./components/ui/index";
export * from "./components/ui/useFixedPopover";
export * from "./components/ui/ToastHost";
export * from "./components/PlainvaLogo";
export * from "./hooks/useFocusTrap";

// Editor layer (M0.4): the CodeMirror session and its portable plugins.
// Shell capabilities (file access, note embeds, URL opening) arrive through
// EditorSessionDeps / PlatformServices — never through direct shell imports.
export * from "./adapters/pathGuard";
export * from "./components/AtMentionPlugin";
export * from "./components/DocIcon";
export * from "./components/ImagePreviewPlugin";
export * from "./components/LivePreviewPlugin";
export * from "./components/MarkdownTheme";
export * from "./components/SlashCommandIcons";
export * from "./components/SlashCommandPlugin";
export * from "./components/WikiLinkPlugin";
export * from "./components/blockActions";
export * from "./components/blockHandles";
export * from "./components/blockModel";
export * from "./components/blockTransforms";
export * from "./components/callouts";
export * from "./components/documentHeader";
export * from "./components/editorCompletion";
export * from "./components/editorSession";
export * from "./components/editorTouchCommands";
export * from "./components/editorTriggers";
export * from "./components/emojiData";
export * from "./components/foldingExtension";
export * from "./components/listIndent";
export * from "./components/listKeymap";
export * from "./components/lucideIconData";
export * from "./components/mathMermaidLive";
export * from "./components/searchSetup";
export * from "./components/tableModel";
export * from "./services/diagnosticsLog";
export * from "./services/docMeta";
export * from "./services/dynamicDate";
export * from "./services/imageFiles";
export * from "./services/mermaidRender";
export * from "./services/toastStore";
