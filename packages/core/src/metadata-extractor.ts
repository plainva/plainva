import { parse as parseYaml } from "yaml";
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
    parsedYaml = parseYaml(yamlNode.value);
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
