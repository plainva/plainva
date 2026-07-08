import { MarkdownAst } from "./markdown-ast.js";
import { extractFrontmatter } from "./metadata-extractor.js";

export type LintSeverity = "warning" | "error";

export interface LintMessage {
  ruleId: string;
  severity: LintSeverity;
  message: string;
}

export function lintMarkdownAst(ast: MarkdownAst): LintMessage[] {
  const messages: LintMessage[] = [];

  const fmResult = extractFrontmatter(ast);

  // Rule: Frontmatter validity and presence
  if (!fmResult.success) {
    messages.push({
      ruleId: "okf-invalid-frontmatter",
      severity: "error",
      message: `Invalid frontmatter: ${fmResult.error.message}`
    });
  } else if (fmResult.data === null) {
    messages.push({
      ruleId: "okf-missing-frontmatter",
      severity: "warning",
      message: "Note has no frontmatter."
    });
  }

  // Rule: 'type' field presence
  if (fmResult.success && fmResult.data !== null) {
    if (!fmResult.data.type || fmResult.data.type.trim() === "") {
      messages.push({
        ruleId: "okf-missing-type",
        severity: "warning",
        message: "Frontmatter is missing a valid 'type' field."
      });
    }
  }

  // Rule: Title presence (either in frontmatter or as H1)
  let hasTitle = false;
  if (fmResult.success && fmResult.data !== null && fmResult.data.title && fmResult.data.title.trim() !== "") {
    hasTitle = true;
  }

  if (!hasTitle) {
    // Check for H1 in the AST
    const hasH1 = ast.children.some(
      (node) => node.type === "heading" && node.depth === 1
    );
    if (hasH1) {
      hasTitle = true;
    }
  }

  if (!hasTitle) {
    messages.push({
      ruleId: "okf-missing-title",
      severity: "warning",
      message: "Note is missing a title. Please provide an H1 heading or a 'title' field in frontmatter."
    });
  }

  return messages;
}
