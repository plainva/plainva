import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { upsertFrontmatterKeys } from '../../frontmatter-surgical.js';
import { ImportWriter } from '../ImportWriter.js';
import { DEFAULT_IMPORT_LABELS, type ImportOptions, type ImportPlan, type ImportSource, type UnpackedFile } from '../ImportTypes.js';
import { dirOf, encodeTarget, relativeFrom } from '../notionFileLinks.js';
import { checkArchiveAbort, JEX_LIMITS, safeTarPath } from '../tarArchive.js';
import { trimEndChars } from '../../textScan.js';

const idPattern = /^[a-f0-9]{32}$/i;
const invalid = (): never => { throw new Error('import.jexInvalid'); };
type Item = { id: string; type: number; title: string; body: string; props: Record<string, string>; file: UnpackedFile };
type Model = { items: Item[]; byId: Map<string, Item>; notes: Item[]; folders: Item[]; tags: Item[]; resources: UnpackedFile[]; notePaths: Map<string, string>; folderPaths: Map<string, string>; payloads: Map<string, UnpackedFile>; noteTags: Map<string, string[]>; missingFolders: boolean };

export function isJexInput(files: UnpackedFile[]): boolean {
  return files.some(file => file.sourceFormat === 'jex' || /^[a-f0-9]{32}\.md$/i.test(file.relativePath) && /^type_: \d+\s*$/m.test(file.content));
}
function parseItem(file: UnpackedFile): Item {
  if (file.isText === false) return invalid();
  // Joplin separates the final property block from title/body with a blank
  // line. Parse from the end so a body containing "id:" is ordinary writing.
  const raw = trimEndChars(file.content.replace(/\r\n/g, '\n'), '\n');
  const split = raw.lastIndexOf('\n\n');
  const header = split < 0 ? '' : raw.slice(0, split);
  const props: Record<string, string> = Object.create(null);
  for (const line of raw.slice(split < 0 ? 0 : split + 2).split('\n')) {
    const match = /^([a-zA-Z][a-zA-Z0-9_]*):(?: (.*))?$/.exec(line);
    if (!match || Object.prototype.hasOwnProperty.call(props, match[1]!)) invalid();
    props[match![1]!] = (match![2] ?? '').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\\n/g, '\\n').replace(/\\\r/g, '\\r');
  }
  if (!idPattern.test(props.id ?? '') || file.relativePath.toLowerCase() !== `${props.id!.toLowerCase()}.md` || !/^\d+$/.test(props.type_ ?? '')) invalid();
  if (props.encryption_applied === '1' || props.encryption_blob_encrypted === '1') throw new Error('import.jexEncrypted');
  const boundary = header.indexOf('\n\n');
  return { id: props.id!.toLowerCase(), type: Number(props.type_), title: boundary < 0 ? header : header.slice(0, boundary), body: boundary < 0 ? '' : header.slice(boundary + 2), props, file };
}
function name(title: string, fallback: string): string {
  // eslint-disable-next-line no-control-regex -- Source titles may contain controls that are invalid in filenames.
  const clean = title.normalize('NFC').replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, '_').trim();
  let result = '', bytes = 0;
  for (const char of clean) { bytes += new TextEncoder().encode(char).length; if (bytes > 160) break; result += char; }
  result = trimEndChars(result, ' .');
  if (!result || result === '.' || result === '..') result = fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result)) result = `_${result}`;
  return result;
}
function parse(files: UnpackedFile[], opts: ImportOptions): Model {
  if (files.length > JEX_LIMITS.maxEntries) throw new Error('import.archiveTooLarge');
  const seen = new Set<string>();
  let bytes = 0, textBytes = 0;
  for (const file of files) {
    checkArchiveAbort(opts.signal);
    const key = safeTarPath(file.relativePath).normalize('NFC').toLowerCase();
    if (seen.has(key)) invalid();
    seen.add(key);
    const size = file.byteSize ?? new TextEncoder().encode(file.content).length;
    if (size > JEX_LIMITS.maxEntryBytes || (bytes += size) > JEX_LIMITS.maxTotalBytes) throw new Error('import.archiveTooLarge');
    if (/^[a-f0-9]{32}\.md$/i.test(file.relativePath) && (size > JEX_LIMITS.maxTextEntryBytes || (textBytes += size) > JEX_LIMITS.maxTextBytes)) throw new Error('import.archiveTooLarge');
  }
  const items = files.filter(f => /^[a-f0-9]{32}\.md$/i.test(f.relativePath)).map(parseItem);
  const byId = new Map(items.map(item => [item.id, item]));
  if (!items.length || items.length !== byId.size) invalid();
  const notes = items.filter(item => item.type === 1), folders = items.filter(item => item.type === 2), tags = items.filter(item => item.type === 5);
  const resources = files.filter(file => !/^[a-f0-9]{32}\.md$/i.test(file.relativePath));
  const folderPaths = new Map<string, string>(), taken = new Set<string>(['_joplin', 'attachments']);
  let missingFolders = false;
  function allocate(parent: string, title: string, id: string, ext = ''): string {
    const stem = `${parent ? `${parent}/` : ''}${name(title, id)}`;
    let path = `${stem}${ext}`;
    if (taken.has(path.toLowerCase())) path = `${stem} (${id})${ext}`;
    safeTarPath(path); taken.add(path.toLowerCase()); return path;
  }
  function folder(id: string, ancestors: Set<string>): string {
    if (!id) return '';
    const cached = folderPaths.get(id);
    if (cached) return cached;
    const item = byId.get(id);
    // Joplin's note-only exports deliberately omit the notebook. Their notes
    // belong at the import root, while the original parent ID stays recorded.
    if (!item) { missingFolders = true; return ''; }
    if (item.type !== 2 || ancestors.has(id) || ancestors.size >= 64) return invalid();
    const next = new Set(ancestors); next.add(id);
    const path = allocate(folder((item.props.parent_id ?? '').toLowerCase(), next), item.title, item.id);
    folderPaths.set(id, path); return path;
  }
  for (const item of folders) folder(item.id, new Set());
  const notePaths = new Map<string, string>();
  for (const item of notes) notePaths.set(item.id, allocate(folder((item.props.parent_id ?? '').toLowerCase(), new Set()), item.title, item.id, '.md'));
  const payloads = new Map<string, UnpackedFile>();
  for (const file of resources) {
    const match = /^resources\/([a-f0-9]{32})(?:\.[^/]+)?$/i.exec(file.relativePath);
    if (!match) continue;
    const id = match[1]!.toLowerCase();
    if (payloads.has(id)) invalid();
    payloads.set(id, file);
  }
  const noteTags = new Map<string, string[]>();
  for (const item of items.filter(i => i.type === 6)) {
    const noteId = (item.props.note_id ?? '').toLowerCase(), tag = byId.get((item.props.tag_id ?? '').toLowerCase());
    if (!notePaths.has(noteId) || tag?.type !== 5) invalid();
    noteTags.set(noteId, [...new Set([...(noteTags.get(noteId) ?? []), tag!.title])]);
  }
  return { items, byId, notes, folders, tags, resources, notePaths, folderPaths, payloads, noteTags, missingFolders };
}

function warnings(model: Model): string[] {
  const result: string[] = ['import.jexOriginals'];
  if (model.missingFolders) result.push('import.jexMissingFolders');
  if (model.items.some(i => i.type === 4 && !model.payloads.has(i.id))) result.push('import.jexIncomplete');
  if (model.items.some(i => ![1, 2, 4, 5, 6].includes(i.type))) result.push('import.jexExtraRecords');
  if (!model.notes.length) result.push('import.jexNoNotes');
  return result;
}
export function analyzeJex(files: UnpackedFile[], opts: ImportOptions, source: ImportSource): ImportPlan {
  const model = parse(files, opts);
  return { sourceId: source.id, sourceName: source.name, totalNotes: model.notes.length, totalFolders: model.folders.length,
    totalTags: model.tags.length, totalAttachments: model.resources.length + 1, totalDatabases: 0,
    totalChecklists: model.notes.filter(i => i.props.is_todo === '1').length, warnings: warnings(model),
    requiredSpaceBytes: files.reduce((sum, file) => sum + (file.byteSize ?? file.content.length * 3), 0) * 2,
    estimatedDurationSec: Math.max(1, Math.ceil(files.length / 40)) };
}

type Node = { type: string; url?: string; children?: Node[]; position?: { start: { offset?: number }; end: { offset?: number } } };
const parser = unified().use(remarkParse);
/** Only real link/image/reference nodes are changed; code and text stay verbatim. */
export function rewriteJexLinks(body: string, fromPath: string, paths: Map<string, string>): { content: string; missing: number } {
  const edits: { start: number; end: number; value: string }[] = [];
  let missing = 0;
  function walk(node: Node) {
    if (node.type === 'html' && node.position?.start.offset !== undefined && node.position.end.offset !== undefined) {
      const start = node.position.start.offset;
      const raw = body.slice(start, node.position.end.offset);
      for (const match of raw.matchAll(/\b(?:href|src)\s*=\s*(["'])(:\/([a-f0-9]{32})(#[^"']*)?)\1/gi)) {
        const target = paths.get(match[3]!.toLowerCase());
        if (!target) { missing++; continue; }
        const at = start + match.index! + match[0].indexOf(match[2]!);
        edits.push({ start: at, end: at + match[2]!.length, value: encodeTarget(relativeFrom(dirOf(fromPath), target)) + (match[4] ?? '') });
      }
    }
    const id = /^:\/([a-f0-9]{32})(#[^\s]*)?$/i.exec(node.url ?? '');
    if (id && node.position) {
      const start = node.position.start.offset, end = node.position.end.offset;
      const target = paths.get(id[1]!.toLowerCase());
      if (!target) missing++;
      else if (start !== undefined && end !== undefined) {
        const raw = body.slice(start, end);
        const match = /(?:\]\(\s*<?|^ {0,3}\[[^\n]*\]:\s*<?)(:\/[a-f0-9]{32}(?:#[^\s>)]*)?)/i.exec(raw);
        if (match && match[1] === node.url) {
          const at = start + match.index + match[0].length - match[1]!.length;
          edits.push({ start: at, end: at + match[1]!.length, value: encodeTarget(relativeFrom(dirOf(fromPath), target)) + (id[2] ?? '') });
        } else missing++;
      }
    }
    for (const child of node.children ?? []) walk(child);
  }
  walk(parser.parse(body));
  let content = body;
  for (const edit of edits.sort((a, b) => b.start - a.start)) content = content.slice(0, edit.start) + edit.value + content.slice(edit.end);
  return { content, missing };
}

function times(item: Item) {
  const parseTime = (text?: string) => text && /^\d{4}-\d{2}-\d{2}T/.test(text) && Number.isFinite(Date.parse(text)) ? Date.parse(text) : undefined;
  return { createdMs: parseTime(item.props.user_created_time) ?? parseTime(item.props.created_time), modifiedMs: parseTime(item.props.user_updated_time) ?? parseTime(item.props.updated_time) };
}

export async function runJex(files: UnpackedFile[], opts: ImportOptions, source: ImportSource, onProgress?: (percent: number, message: string) => void) {
  const started = Date.now(), model = parse(files, opts), labels = opts.labels ?? DEFAULT_IMPORT_LABELS;
  if (opts.targetSubfolder && await opts.vaultAdapter?.exists(opts.targetSubfolder)) throw new Error('import.jexFreshTarget');
  const writer = new ImportWriter(opts, labels), paths = new Map<string, string>();
  const payloadIds = new Map([...model.payloads].map(([id, file]) => [file, id]));
  const records: string[] = [];
  let recordBytes = 0;
  for (const item of model.items) {
    checkArchiveAbort(opts.signal);
    const record = JSON.stringify({ path: item.file.relativePath, content: item.file.content });
    recordBytes += new TextEncoder().encode(record).length;
    if (recordBytes > JEX_LIMITS.maxTextBytes) throw new Error('import.archiveTooLarge');
    records.push(record);
  }
  return writer.runGuarded(source, started, async () => {
    writer.abortIfRequested();
    await writer.ensureRoot();
    // The original serialized records are retained verbatim in one companion
    // document, including unknown fields/types. It is data, never executable.
    await writer.writeFile('_Joplin/Export.json', `{"format":"joplin-raw-records-v1","records":[${records.join(',')}]}`);
    for (const folder of model.folderPaths.values()) await writer.writeFolder(folder);
    for (const [id, path] of model.notePaths) paths.set(id, await writer.reserve(path));
    for (let index = 0; index < model.resources.length; index++) {
      writer.abortIfRequested();
      const file = model.resources[index]!;
      try {
        const bytes = file.sourcePath ? await opts.readSourceBytes?.(file.sourcePath) : new TextEncoder().encode(file.content);
        if (!bytes || (file.byteSize !== undefined && bytes.length !== file.byteSize)) throw new Error(labels.jexIncomplete ?? 'Missing or unreadable resource');
        const path = await writer.writeBinary(`Attachments/Joplin/${file.relativePath}`, bytes);
        const id = payloadIds.get(file);
        if (id) paths.set(id, path);
      } catch (error) { writer.recordFailure(file.relativePath, error); }
      onProgress?.(Math.floor((index + 1) / Math.max(1, model.resources.length + model.notes.length) * 100), file.relativePath);
    }
    for (let index = 0; index < model.notes.length; index++) {
      writer.abortIfRequested();
      const item = model.notes[index]!, relativePath = model.notePaths.get(item.id)!;
      try {
        const rewritten = rewriteJexLinks(item.body, paths.get(item.id)!, paths);
        const metadata: Record<string, unknown> = { title: item.title, joplin: { id: item.id, ...item.props } };
        if (model.noteTags.has(item.id)) metadata.tags = model.noteTags.get(item.id);
        if (item.props.is_todo === '1') {
          metadata.type = 'task'; metadata.done = Number(item.props.todo_completed) > 0;
          const due = Number(item.props.todo_due);
          if (due > 0 && Number.isFinite(due) && !Number.isNaN(new Date(due).getTime())) metadata.due = new Date(due).toISOString().slice(0, 10);
        }
        const content = upsertFrontmatterKeys(rewritten.content, metadata);
        await writer.writeNote(relativePath, content, { type: item.props.is_todo === '1' ? 'task' : 'note', times: times(item), details: rewritten.missing ? (labels.jexIncomplete ?? 'Some link targets are missing; the original records were preserved.') : undefined });
      } catch (error) { writer.recordFailure(relativePath, error); }
      onProgress?.(Math.floor((model.resources.length + index + 1) / Math.max(1, model.resources.length + model.notes.length) * 100), relativePath);
    }
  });
}
