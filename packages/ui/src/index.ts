// Shared, shell-independent UI layer (ADR 0011). Consumed as TypeScript
// source through the workspace; nothing in this package may import shell
// APIs (@tauri-apps/*, @capacitor/*) — platform capabilities are injected
// by the consuming app shell. apps/desktop/src/sharedUiPurity.test.ts
// enforces the import ban.

// Pure helpers and view-models
export * from "./lib/concurrencyLimiter";
export * from "./lib/conflictFiles";
export * from "./lib/editableField";
export * from "./lib/externalUpdateDecision";
export * from "./lib/fuzzyScore";
export * from "./lib/inlineMarkdown";
export * from "./lib/linkParser";
export * from "./lib/markdownToPlainText";
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

// React primitives and shared hooks
export * from "./components/ui/index";
export * from "./components/ui/useFixedPopover";
export * from "./hooks/useFocusTrap";
