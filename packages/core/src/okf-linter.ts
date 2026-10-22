import { parseBlockYaml, yamlLinesOf } from "./frontmatter-block.js";
import { dataOfBlock } from "./frontmatter-entry.js";
import { MarkdownAst, MarkdownYamlNode } from "./markdown-ast.js";
import { extractFrontmatter } from "./metadata-extractor.js";
import { okfFieldFormsSchema } from "./metadata.js";

export type LintSeverity = "warning" | "error";

export interface LintMessage {
  ruleId: string;
  severity: LintSeverity;
  message: string;
}

/**
 * What the block says against the forms the spec gives its fields' values
 * (`okfFieldFormsSchema`), checked on the block as the YAML says it; null
 * where it says nothing against them.
 */
function fieldFormError(ast: MarkdownAst): string | null {
  const node = ast.children.find((child): child is MarkdownYamlNode => child.type === "yaml");
  if (!node) return null;
  try {
    const doc = parseBlockYaml(yamlLinesOf(node.value));
    // What the library would print as a warning while it reads the data — a
    // key that is a map, `{{title}}:` in a template — is no finding of the
    // linter's; the reader keeps quiet about it as well.
    doc.options.logLevel = "error";
    const checked = okfFieldFormsSchema.safeParse(dataOfBlock(doc));
    return checked.success ? null : checked.error.message;
  } catch {
    // A block the reader takes and the writers cannot say as data: nothing in it to check.
    return null;
  }
}

export function lintMarkdownAst(ast: MarkdownAst): LintMessage[] {
  const messages: LintMessage[] = [];

  const fmResult = extractFrontmatter(ast);
  // The reader takes every value since 2026-10-22 (ADR 0009): one that is not
  // of its field's kind is the text it is written with. What the spec says of
  // the values is checked here — as the reader's schema checked it until then.
  const invalid = !fmResult.success ? fmResult.error.message : fmResult.data !== null ? fieldFormError(ast) : null;
  const data = fmResult.success && invalid === null ? fmResult.data : null;

  // Rule: Frontmatter validity and presence
  if (invalid !== null) {
    messages.push({
      ruleId: "okf-invalid-frontmatter",
      severity: "error",
      message: `Invalid frontmatter: ${invalid}`
    });
  } else if (data === null) {
    messages.push({
      ruleId: "okf-missing-frontmatter",
      severity: "warning",
      message: "Note has no frontmatter."
    });
  }

  // Rule: 'type' field presence
  if (data !== null) {
    if (!data.type || data.type.trim() === "") {
      messages.push({
        ruleId: "okf-missing-type",
        severity: "warning",
        message: "Frontmatter is missing a valid 'type' field."
      });
    }
  }

  // Rule: Title presence (either in frontmatter or as H1)
  let hasTitle = false;
  if (data !== null && data.title && data.title.trim() !== "") {
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
