import { stringify as stringifyYaml } from "yaml";
import { MarkdownAst, MarkdownYamlNode } from "./markdown-ast.js";
import { ReadableFrontmatter } from "./metadata.js";

export function updateFrontmatter(ast: MarkdownAst, data: ReadableFrontmatter): void {
  const yamlString = stringifyYaml(data).trim();

  const yamlNodeIndex = ast.children.findIndex((node) => node.type === "yaml");

  if (yamlNodeIndex !== -1) {
    // Update existing node
    const existingNode = ast.children[yamlNodeIndex] as MarkdownYamlNode;
    existingNode.value = yamlString;
  } else {
    // Insert new yaml node at the beginning
    const newNode: MarkdownYamlNode = {
      type: "yaml",
      value: yamlString
    };
    ast.children.unshift(newNode);
  }
}
