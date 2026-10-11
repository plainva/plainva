import { parse as parseYaml } from "yaml";
import { yamlLinesOf } from "./frontmatter-block.js";
import { MarkdownAst, MarkdownYamlNode } from "./markdown-ast.js";
import { readableFrontmatterSchema, ReadableFrontmatter } from "./metadata.js";

export type ExtractedFrontmatterResult = 
  | { success: true; data: ReadableFrontmatter | null }
  | { success: false; error: Error };

export function extractFrontmatter(ast: MarkdownAst): ExtractedFrontmatterResult {
  const yamlNode = ast.children.find((node): node is MarkdownYamlNode => node.type === "yaml");
  
  if (!yamlNode) {
    return { success: true, data: null };
  }

  let parsedYaml: unknown;
  try {
    // The block's lines as the writers read them (`yamlLinesOf`): the parser
    // ends a line at a carriage return of its own, the YAML library does not.
    parsedYaml = parseYaml(yamlLinesOf(yamlNode.value));
  } catch (e) {
    return { success: false, error: e instanceof Error ? e : new Error(String(e)) };
  }

  if (typeof parsedYaml !== "object" || parsedYaml === null) {
     parsedYaml = {};
  }

  const result = readableFrontmatterSchema.safeParse(parsedYaml);
  
  if (result.success) {
    return { success: true, data: result.data as ReadableFrontmatter };
  } else {
    return { success: false, error: result.error };
  }
}
