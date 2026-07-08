import { z } from "zod";

// --- AST Node Interfaces ---

export type MarkdownTextNode = { type: "text"; value: string };
export type MarkdownHtmlNode = { type: "html"; value: string };
export type MarkdownYamlNode = { type: "yaml"; value: string };
export type MarkdownEmphasisNode = { type: "emphasis"; children: MarkdownPhrasingNode[] };
export type MarkdownStrongNode = { type: "strong"; children: MarkdownPhrasingNode[] };
export type MarkdownLinkNode = { type: "link"; url: string; title?: string | null; children: MarkdownPhrasingNode[] };
export type MarkdownParagraphNode = { type: "paragraph"; children: MarkdownPhrasingNode[] };
export type MarkdownHeadingNode = { type: "heading"; depth: 1 | 2 | 3 | 4 | 5 | 6; children: MarkdownPhrasingNode[] };
export type MarkdownBlockquoteNode = { type: "blockquote"; children: MarkdownBlockContentNode[] };
export type MarkdownListItemNode = { type: "listItem"; spread?: boolean; checked?: boolean | null; children: MarkdownBlockContentNode[] };
export type MarkdownListNode = { type: "list"; ordered?: boolean; start?: number | null; spread?: boolean; children: MarkdownListItemNode[] };

// New Nodes
export type MarkdownCodeNode = { type: "code"; lang?: string | null; meta?: string | null; value: string };
export type MarkdownInlineCodeNode = { type: "inlineCode"; value: string };
export type MarkdownThematicBreakNode = { type: "thematicBreak" };
export type MarkdownBreakNode = { type: "break" };
export type MarkdownImageNode = { type: "image"; url: string; title?: string | null; alt?: string | null };
export type MarkdownDeleteNode = { type: "delete"; children: MarkdownPhrasingNode[] };
export type MarkdownTableCellNode = { type: "tableCell"; children: MarkdownPhrasingNode[] };
export type MarkdownTableRowNode = { type: "tableRow"; children: MarkdownTableCellNode[] };
export type MarkdownTableNode = { type: "table"; align?: Array<"left" | "right" | "center" | null> | null; children: MarkdownTableRowNode[] };

export type MarkdownDefinitionNode = { type: "definition"; identifier: string; label?: string | null; url: string; title?: string | null };
export type MarkdownFootnoteDefinitionNode = { type: "footnoteDefinition"; identifier: string; label?: string | null; children: MarkdownBlockContentNode[] };
export type MarkdownFootnoteReferenceNode = { type: "footnoteReference"; identifier: string; label?: string | null };

export type MarkdownPhrasingNode =
  | MarkdownTextNode
  | MarkdownHtmlNode
  | MarkdownEmphasisNode
  | MarkdownStrongNode
  | MarkdownLinkNode
  | MarkdownInlineCodeNode
  | MarkdownImageNode
  | MarkdownDeleteNode
  | MarkdownBreakNode
  | MarkdownFootnoteReferenceNode
  | MarkdownImageReferenceNode
  | MarkdownLinkReferenceNode;

export type MarkdownBlockContentNode =
  | MarkdownYamlNode
  | MarkdownHtmlNode
  | MarkdownHeadingNode
  | MarkdownParagraphNode
  | MarkdownBlockquoteNode
  | MarkdownListNode
  | MarkdownCodeNode
  | MarkdownThematicBreakNode
  | MarkdownTableNode
  | MarkdownDefinitionNode
  | MarkdownFootnoteDefinitionNode;

export type MarkdownRootNode = { type: "root"; children: MarkdownBlockContentNode[] };

export type MarkdownImageReferenceNode = { type: "imageReference"; identifier: string; label?: string | null; alt?: string | null; referenceType?: string };
export type MarkdownLinkReferenceNode = { type: "linkReference"; identifier: string; label?: string | null; referenceType?: string; children: MarkdownPhrasingNode[] };

// --- Zod Schemas ---
//
// The raw ZodObject schemas stay unannotated on purpose: z.discriminatedUnion
// must see the concrete object shape (its `type` literal), which the
// z.ZodType<T>-annotated public exports intentionally erase. Building the unions
// from the raw objects keeps this file free of `as any` casts; the exported
// aliases below are the same runtime instances, just interface-typed.

export let markdownPhrasingNodeSchema: z.ZodType<MarkdownPhrasingNode>;
export let markdownBlockContentNodeSchema: z.ZodType<MarkdownBlockContentNode>;

const textNode = z.object({ type: z.literal("text"), value: z.string() }).passthrough();
const htmlNode = z.object({ type: z.literal("html"), value: z.string() }).passthrough();
const yamlNode = z.object({ type: z.literal("yaml"), value: z.string() }).passthrough();
const inlineCodeNode = z.object({ type: z.literal("inlineCode"), value: z.string() }).passthrough();
const thematicBreakNode = z.object({ type: z.literal("thematicBreak") }).passthrough();
const breakNode = z.object({ type: z.literal("break") }).passthrough();
const codeNode = z.object({ type: z.literal("code"), lang: z.string().nullable().optional(), meta: z.string().nullable().optional(), value: z.string() }).passthrough();
const imageNode = z.object({ type: z.literal("image"), url: z.string(), title: z.string().nullable().optional(), alt: z.string().nullable().optional() }).passthrough();
const definitionNode = z.object({ type: z.literal("definition"), identifier: z.string(), label: z.string().nullable().optional(), url: z.string(), title: z.string().nullable().optional() }).passthrough();
const footnoteReferenceNode = z.object({ type: z.literal("footnoteReference"), identifier: z.string(), label: z.string().nullable().optional() }).passthrough();
const imageReferenceNode = z.object({ type: z.literal("imageReference"), identifier: z.string(), label: z.string().nullable().optional(), alt: z.string().nullable().optional(), referenceType: z.string().optional() }).passthrough();
const linkReferenceNode = z.object({ type: z.literal("linkReference"), identifier: z.string(), label: z.string().nullable().optional(), referenceType: z.string().optional(), children: z.array(z.lazy(() => markdownPhrasingNodeSchema)) }).passthrough();
const emphasisNode = z.object({ type: z.literal("emphasis"), children: z.array(z.lazy(() => markdownPhrasingNodeSchema)) }).passthrough();
const strongNode = z.object({ type: z.literal("strong"), children: z.array(z.lazy(() => markdownPhrasingNodeSchema)) }).passthrough();
const linkNode = z.object({ type: z.literal("link"), url: z.string(), title: z.string().nullable().optional(), children: z.array(z.lazy(() => markdownPhrasingNodeSchema)) }).passthrough();
const deleteNode = z.object({ type: z.literal("delete"), children: z.array(z.lazy(() => markdownPhrasingNodeSchema)) }).passthrough();
const paragraphNode = z.object({ type: z.literal("paragraph"), children: z.array(z.lazy(() => markdownPhrasingNodeSchema)) }).passthrough();
const headingNode = z.object({ type: z.literal("heading"), depth: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]), children: z.array(z.lazy(() => markdownPhrasingNodeSchema)) }).passthrough();
const blockquoteNode = z.object({ type: z.literal("blockquote"), children: z.array(z.lazy(() => markdownBlockContentNodeSchema)) }).passthrough();
const listItemNode = z.object({ type: z.literal("listItem"), spread: z.boolean().optional(), checked: z.boolean().nullable().optional(), children: z.array(z.lazy(() => markdownBlockContentNodeSchema)) }).passthrough();
const listNode = z.object({ type: z.literal("list"), ordered: z.boolean().optional(), start: z.number().int().nullable().optional(), spread: z.boolean().optional(), children: z.array(listItemNode) }).passthrough();
const footnoteDefinitionNode = z.object({ type: z.literal("footnoteDefinition"), identifier: z.string(), label: z.string().nullable().optional(), children: z.array(z.lazy(() => markdownBlockContentNodeSchema)) }).passthrough();
const tableCellNode = z.object({ type: z.literal("tableCell"), children: z.array(z.lazy(() => markdownPhrasingNodeSchema)) }).passthrough();
const tableRowNode = z.object({ type: z.literal("tableRow"), children: z.array(tableCellNode) }).passthrough();
const tableNode = z.object({ type: z.literal("table"), align: z.array(z.union([z.literal("left"), z.literal("right"), z.literal("center"), z.null()])).nullable().optional(), children: z.array(tableRowNode) }).passthrough();

// Public, interface-typed aliases (unchanged API surface).
export const markdownTextNodeSchema: z.ZodType<MarkdownTextNode> = textNode;
export const markdownHtmlNodeSchema: z.ZodType<MarkdownHtmlNode> = htmlNode;
export const markdownYamlNodeSchema: z.ZodType<MarkdownYamlNode> = yamlNode;
export const markdownInlineCodeNodeSchema: z.ZodType<MarkdownInlineCodeNode> = inlineCodeNode;
export const markdownThematicBreakNodeSchema: z.ZodType<MarkdownThematicBreakNode> = thematicBreakNode;
export const markdownBreakNodeSchema: z.ZodType<MarkdownBreakNode> = breakNode;
export const markdownCodeNodeSchema: z.ZodType<MarkdownCodeNode> = codeNode;
export const markdownImageNodeSchema: z.ZodType<MarkdownImageNode> = imageNode;
export const markdownDefinitionNodeSchema: z.ZodType<MarkdownDefinitionNode> = definitionNode;
export const markdownFootnoteReferenceNodeSchema: z.ZodType<MarkdownFootnoteReferenceNode> = footnoteReferenceNode;
export const markdownImageReferenceNodeSchema: z.ZodType<MarkdownImageReferenceNode> = imageReferenceNode;
export const markdownLinkReferenceNodeSchema: z.ZodType<MarkdownLinkReferenceNode> = linkReferenceNode;
export const markdownEmphasisNodeSchema: z.ZodType<MarkdownEmphasisNode> = emphasisNode;
export const markdownStrongNodeSchema: z.ZodType<MarkdownStrongNode> = strongNode;
export const markdownLinkNodeSchema: z.ZodType<MarkdownLinkNode> = linkNode;
export const markdownDeleteNodeSchema: z.ZodType<MarkdownDeleteNode> = deleteNode;
export const markdownParagraphNodeSchema: z.ZodType<MarkdownParagraphNode> = paragraphNode;
export const markdownHeadingNodeSchema: z.ZodType<MarkdownHeadingNode> = headingNode;
export const markdownBlockquoteNodeSchema: z.ZodType<MarkdownBlockquoteNode> = blockquoteNode;
export const markdownListItemNodeSchema: z.ZodType<MarkdownListItemNode> = listItemNode;
export const markdownListNodeSchema: z.ZodType<MarkdownListNode> = listNode;
export const markdownFootnoteDefinitionNodeSchema: z.ZodType<MarkdownFootnoteDefinitionNode> = footnoteDefinitionNode;
export const markdownTableCellNodeSchema: z.ZodType<MarkdownTableCellNode> = tableCellNode;
export const markdownTableRowNodeSchema: z.ZodType<MarkdownTableRowNode> = tableRowNode;
export const markdownTableNodeSchema: z.ZodType<MarkdownTableNode> = tableNode;

markdownPhrasingNodeSchema = z.lazy(() => z.discriminatedUnion("type", [
  textNode,
  htmlNode,
  emphasisNode,
  strongNode,
  linkNode,
  inlineCodeNode,
  imageNode,
  deleteNode,
  breakNode,
  footnoteReferenceNode,
  imageReferenceNode,
  linkReferenceNode,
]));

markdownBlockContentNodeSchema = z.lazy(() => z.discriminatedUnion("type", [
  yamlNode,
  htmlNode,
  headingNode,
  paragraphNode,
  blockquoteNode,
  listNode,
  codeNode,
  thematicBreakNode,
  tableNode,
  definitionNode,
  footnoteDefinitionNode,
]));

export const markdownRootNodeSchema: z.ZodType<MarkdownRootNode> = z.object({ type: z.literal("root"), children: z.array(markdownBlockContentNodeSchema) }).passthrough();
export const markdownAstSchema = markdownRootNodeSchema;
export type MarkdownAst = z.infer<typeof markdownAstSchema>;

// --- Type Guards ---

export function isMarkdownTextNode(node: any): node is MarkdownTextNode { return node?.type === "text"; }
export function isMarkdownHtmlNode(node: any): node is MarkdownHtmlNode { return node?.type === "html"; }
export function isMarkdownYamlNode(node: any): node is MarkdownYamlNode { return node?.type === "yaml"; }
export function isMarkdownEmphasisNode(node: any): node is MarkdownEmphasisNode { return node?.type === "emphasis"; }
export function isMarkdownStrongNode(node: any): node is MarkdownStrongNode { return node?.type === "strong"; }
export function isMarkdownLinkNode(node: any): node is MarkdownLinkNode { return node?.type === "link"; }
export function isMarkdownParagraphNode(node: any): node is MarkdownParagraphNode { return node?.type === "paragraph"; }
export function isMarkdownHeadingNode(node: any): node is MarkdownHeadingNode { return node?.type === "heading"; }
export function isMarkdownBlockquoteNode(node: any): node is MarkdownBlockquoteNode { return node?.type === "blockquote"; }
export function isMarkdownListItemNode(node: any): node is MarkdownListItemNode { return node?.type === "listItem"; }
export function isMarkdownListNode(node: any): node is MarkdownListNode { return node?.type === "list"; }

export function isMarkdownCodeNode(node: any): node is MarkdownCodeNode { return node?.type === "code"; }
export function isMarkdownInlineCodeNode(node: any): node is MarkdownInlineCodeNode { return node?.type === "inlineCode"; }
export function isMarkdownThematicBreakNode(node: any): node is MarkdownThematicBreakNode { return node?.type === "thematicBreak"; }
export function isMarkdownBreakNode(node: any): node is MarkdownBreakNode { return node?.type === "break"; }
export function isMarkdownImageNode(node: any): node is MarkdownImageNode { return node?.type === "image"; }
export function isMarkdownDeleteNode(node: any): node is MarkdownDeleteNode { return node?.type === "delete"; }
export function isMarkdownTableNode(node: any): node is MarkdownTableNode { return node?.type === "table"; }
export function isMarkdownTableRowNode(node: any): node is MarkdownTableRowNode { return node?.type === "tableRow"; }
export function isMarkdownTableCellNode(node: any): node is MarkdownTableCellNode { return node?.type === "tableCell"; }

export function isMarkdownDefinitionNode(node: any): node is MarkdownDefinitionNode { return node?.type === "definition"; }
export function isMarkdownFootnoteDefinitionNode(node: any): node is MarkdownFootnoteDefinitionNode { return node?.type === "footnoteDefinition"; }
export function isMarkdownFootnoteReferenceNode(node: any): node is MarkdownFootnoteReferenceNode { return node?.type === "footnoteReference"; }
export function isMarkdownImageReferenceNode(node: any): node is MarkdownImageReferenceNode { return node?.type === "imageReference"; }
export function isMarkdownLinkReferenceNode(node: any): node is MarkdownLinkReferenceNode { return node?.type === "linkReference"; }
