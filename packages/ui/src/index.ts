// Shared, shell-independent UI layer (ADR 0011). Consumed as TypeScript
// source through the workspace; nothing in this package may import shell
// APIs (@tauri-apps/*, @capacitor/*) — platform capabilities are injected
// by the consuming app shell. apps/desktop/src/sharedUiPurity.test.ts
// enforces the import ban.

// Pure helpers and view-models
export * from "./lib/bookmarksFile";
export * from "./lib/deleteThreshold";
export * from "./lib/calendarGrid";
export * from "./lib/cloudAccounts";
export * from "./lib/cloudAccountsLabels";
export * from "./lib/attachmentPath";
export * from "./lib/importAttachment";
export * from "./lib/insecureUrl";
export * from "./lib/dailyNotePath";
export * from "./lib/dateLocale";
export * from "./lib/dueLabel";
export * from "./lib/overflowGroup";
export * from "./lib/deviceSignIn";
export * from "./lib/indexMdGenerate";
export * from "./lib/indexMd";
export * from "./lib/okfConversion";
export * from "./lib/trustSignals";
export * from "./lib/okfProvenance";
export * from "./lib/indexMdAutoUpdate";
export * from "./lib/keychainSlots";
export * from "./lib/keychainMigration";
export * from "./lib/momentFormat";
export * from "./lib/featureParity";
export * from "./lib/qrScan";
export * from "./lib/largeFileBackupHint";
export * from "./lib/recentSearches";
export * from "./lib/rowSelection";
export * from "./lib/profileFields";
export * from "./lib/syncDiagnostics";
export * from "./lib/taskList";
export * from "./lib/templateActions";
export * from "./lib/dayAgenda";
export * from "./lib/renameTagVault";
export * from "./lib/zipBackup";
export * from "./services/graphState";
export * from "./services/graphActions";
export * from "./services/graphRelationTargets";
export * from "./lib/taskDatabase";
export * from "./lib/taskPromotion";
export * from "./lib/taskRecurrence";
export * from "./lib/newItemContent";
export * from "./lib/accountProfile";
export * from "./lib/accountRepair";
export * from "./lib/accountRepairCleanup";
export * from "./lib/profileNotice";
export * from "./lib/eventVisualState";
export * from "./lib/iconPickerModel";
export * from "./lib/authErrors";
export * from "./lib/secretsPort";
export * from "./lib/tokenBroker";
export * from "./lib/whatsNew";
export * from "./lib/docsLinks";
export { WhatsNewIcon } from "./components/WhatsNewIcon";
export * from "./lib/providerCatalog";
export * from "./lib/timeGrid";
export * from "./pim/eventColors";
export * from "./pim/eventWrite";
export * from "./pim/meetingNote";
export * from "./pim/calendarForm";
export * from "./pim/eventPeek";
export * from "./pim/spanLayout";
export * from "./pim/eventDays";
export * from "./pim/dueTime";
export * from "./pim/reminderPlan";
export * from "./pim/eventChanges";
export * from "./pim/baseOverlay";
export * from "./pim/entryEvent";
export * from "./pim/statusEvents";
export * from "./services/weekStart";
export * from "./pim/providerTask";
export * from "./pim/taskToProvider";
export * from "./pim/taskTimeBlock";
export * from "./pim/actualTime";
export * from "./pim/taskSync";
export * from "./pim/taskDeletion";
export * from "./lib/contentFont";
export * from "./lib/orderedAreas";
export * from "./lib/openTarget";
export * from "./lib/relativeLink";
export * from "./lib/textFileShape";
export * from "./services/barLayout";
export * from "./services/commandRegistry";
export * from "./services/inlineBase";
export * from "./lib/outline";
export * from "./lib/palette";
export * from "./lib/recentsFile";
export * from "./lib/renameNote";
export * from "./lib/startrekQuotes";
export * from "./lib/themeRegistry";
export * from "./lib/concurrencyLimiter";
export * from "./lib/iconSizes";
export * from "./lib/wikiResolver";
export * from "./lib/conflictFiles";
export * from "./lib/editableField";
export * from "./lib/errorText";
export * from "./lib/externalUpdateDecision";
export * from "./lib/fuzzyScore";
export * from "./lib/smartPaste";
export * from "./components/SelectionToolbar";
export * from "./lib/inlineMarkdown";
export * from "./lib/lineDiff";
export * from "./lib/linkParser";
export * from "./lib/markdownToHtml";
export * from "./lib/folderTemplates";
export * from "./lib/newNoteContent";
export * from "./lib/fileStem";
export * from "./lib/markdownToPlainText";
export * from "./lib/noteCardModel";
export * from "./lib/noteTitle";
export * from "./lib/occurrenceSnippet";
export * from "./lib/peekHistory";
export * from "./lib/safeUrl";
export * from "./lib/searchJump";
export * from "./lib/templateCaret";
export * from "./lib/searchSnippet";
export * from "./lib/settingsCatalog";
export * from "./lib/securityCatalog";
export * from "./lib/qr";
export * from "./lib/taskToggle";
export * from "./lib/textDiff";
export * from "./lib/treeFiles";
export * from "./lib/treeReveal";
export * from "./lib/vaultReplace";
export * from "./lib/dragAutoScroll";
export * from "./lib/typography";
export * from "./lib/useDebouncedValue";
export * from "./lib/useStableHandler";
export * from "./lib/wordCount";

// .base database layer (R4.1): the Obsidian-compatible (de)serialization,
// the filter-expression model/mutators and the board grouping helpers —
// shared so the mobile shell edits databases through the SAME contract
// (never hand-written YAML).
export * from "./base/baseConfigCatalog";
export * from "./base/baseSelectorTypes";
export * from "./base/baseFormat";
export * from "./base/baseRelations";
export * from "./base/relationSchema";
export * from "./base/subItemsTree";
export * from "./base/dependencies";
export * from "./base/embedScope";
export * from "./base/coverImage";
export * from "./base/baseMembership";
export * from "./base/deletionPlan";
export * from "./base/noteDatabaseContext";
export * from "./base/relationCleanup";
export * from "./base/boardOrder";
export * from "./base/filterExpr";
export * from "./base/newItemNaming";
export * from "./base/pinboardModel";
export * from "./base/pinboardSweep";
export * from "./base/propertyModel";
export * from "./base/calendarRange";
export * from "./base/timelineModel";
export * from "./base/writeProperty";
export * from "./base/bulkSetProperty";
export * from "./base/deleteProperty";
export * from "./base/renameProperty";
export * from "./base/templateEngine";
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
export * from "./components/NoteCardBody";
export * from "./components/PlainvaLogo";
export * from "./components/QrScanner";
export * from "./hooks/useFocusTrap";
export * from "./hooks/useHoldDrag";

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
export * from "./components/codeHighlight";
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
export * from "./components/lucideIconDraw";
export * from "./components/mathMermaidLive";
export * from "./components/noteEmbedCore";
export * from "./graph/graphEngine";
export * from "./graph/graphLayout";
export * from "./graph/graphTypes";
export * from "./graph/contextScene";
export * from "./graph/vaultMapScene";
export * from "./graph/themeTokens";
export * from "./graph/baseGraphScene";
export * from "./vaultTemplates/types";
export * from "./vaultTemplates/baseBuilders";
export * from "./vaultTemplates/registry";
export * from "./vaultTemplates/scaffold";
export * from "./components/searchSetup";
export * from "./components/tableModel";
export * from "./services/diagnosticsLog";
export * from "./services/docMeta";
export * from "./services/dynamicDate";
export * from "./services/imageFiles";
export * from "./services/mermaidRender";
export * from "./services/toastStore";
export * from './lib/importLabels';
