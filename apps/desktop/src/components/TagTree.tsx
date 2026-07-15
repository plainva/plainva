import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useVault } from "../contexts/VaultContext";
import { Hash, ChevronRight, ChevronDown, FileText } from "lucide-react";
import { pruneTagTree, type TagNode } from "./tagTreeModel";
import { renameTagInText, isValidTagName } from "@plainva/core";
import { appPrompt, appMessage } from "../services/appDialogs";

interface TagTreeProps {
  onSelectPath: (path: string, newTab?: boolean) => void;
  /** Sidebar search query (plan Suche O5): prunes the tag tree to branches
   *  whose full tag contains the filter (case-insensitive). */
  filter?: string;
}

export function TagTree({ onSelectPath, filter }: TagTreeProps) {
  const { t } = useTranslation();
  const { queryService, fileTreeVersion, vaultAdapter, triggerFileTreeUpdate } = useVault();
  const [tagTree, setTagTree] = useState<Record<string, TagNode>>({});
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [filesForTag, setFilesForTag] = useState<{path: string, title: string}[]>([]);
  const [expandedTags, setExpandedTags] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    const fetchTags = async () => {
      if (!queryService) return;
      try {
        const rawTags = await queryService.getAllTags();
        if (!active) return;
        
        const tree: Record<string, TagNode> = {};
        
        for (const row of rawTags) {
          // Remove leading # if any
          const tag = row.tag.startsWith("#") ? row.tag.substring(1) : row.tag;
          const parts = tag.split("/");
          
          let currentLevel = tree;
          let currentFullTag = "";
          
          for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            currentFullTag = currentFullTag ? `${currentFullTag}/${part}` : part;
            
            if (!currentLevel[part]) {
              currentLevel[part] = {
                name: part,
                fullTag: currentFullTag,
                count: 0,
                children: {},
                isExpanded: false
              };
            }
            
            // Only add count to the exact leaf node, or maybe bubble it up?
            // Obsidian tags bubble up counts usually. Let's add it to all ancestors.
            currentLevel[part].count += row.count;
            
            if (i < parts.length - 1) {
              currentLevel = currentLevel[part].children;
            }
          }
        }
        
        setTagTree(tree);
        // Retain selected tag if it still exists, otherwise clear
        if (selectedTag && !rawTags.find(r => r.tag === selectedTag || r.tag === `#${selectedTag}`)) {
           setSelectedTag(null);
           setFilesForTag([]);
        }
      } catch (err) {
        console.error("Failed to fetch tags", err);
      }
    };
    
    fetchTags();
    return () => { active = false; };
  }, [queryService, fileTreeVersion, selectedTag]);

  useEffect(() => {
    if (selectedTag && queryService) {
      queryService.getFilesByTag(selectedTag).then(files => {
        setFilesForTag(files);
      }).catch(err => {
        console.error("Failed to fetch files for tag", err);
      });
    } else {
      setFilesForTag([]);
    }
  }, [selectedTag, queryService, fileTreeVersion]);

  const isFiltering = !!filter && filter.trim() !== "";
  const visibleTree = useMemo(() => pruneTagTree(tagTree, filter ?? ""), [tagTree, filter]);

  const toggleExpand = (node: TagNode) => {
    setExpandedTags(prev => {
      const next = new Set(prev);
      if (next.has(node.fullTag)) {
        next.delete(node.fullTag);
      } else {
        next.add(node.fullTag);
      }
      return next;
    });
  };

  // Vault-wide tag rename (B6): right-click a tag -> new name -> rewrite every
  // note that carries it (frontmatter + inline #tag, plus its `tag/sub` children)
  // through the adapter's atomic + backup chain.
  const handleRenameTag = async (fullTag: string) => {
    if (!queryService || !vaultAdapter) return;
    const next = await appPrompt({
      title: t("tags.renameTag", { defaultValue: "Tag umbenennen" }),
      message: t("tags.renameMessage", { defaultValue: "Neuer Name für #{{tag}} (im ganzen Vault):", tag: fullTag }),
      initial: fullTag,
      confirmLabel: t("tags.renameAction", { defaultValue: "Umbenennen" }),
    });
    if (next === null) return;
    const newName = next.replace(/^#/, "").trim();
    if (!isValidTagName(newName) || newName === fullTag) return;
    const candidates = await queryService.findNotesWithTag(fullTag);
    let notes = 0;
    for (const path of candidates) {
      try {
        const fresh = await vaultAdapter.readTextFile(path);
        const res = renameTagInText(fresh, fullTag, newName);
        if (res.changed && res.content !== fresh) {
          await vaultAdapter.writeTextFile(path, res.content);
          notes += 1;
        }
      } catch {
        // Skip a note that cannot be read/written; the rest still apply.
      }
    }
    triggerFileTreeUpdate?.();
    setSelectedTag(null);
    await appMessage({
      title: t("tags.renameTag", { defaultValue: "Tag umbenennen" }),
      message: t("tags.renameDone", { defaultValue: "#{{old}} in {{notes}} Notizen zu #{{new}} umbenannt", old: fullTag, new: newName, notes }),
    });
  };

  const renderNode = (node: TagNode, level: number) => {
    const hasChildren = Object.keys(node.children).length > 0;
    const isSelected = selectedTag === node.fullTag;
    // While filtering, matched branches stay fully expanded so hits are visible.
    const isExpanded = isFiltering || expandedTags.has(node.fullTag);
    
    return (
      <div key={node.fullTag}>
        <div
          className="pv-rowhover"
          style={{
            display: 'flex', alignItems: 'center', padding: '4px 8px',
            paddingLeft: `${level * 12 + 8}px`,
            cursor: 'pointer',
            backgroundColor: isSelected ? 'var(--bg-active)' : undefined,
            color: isSelected ? 'var(--text-main)' : 'var(--text-muted)'
          }}
          onClick={() => setSelectedTag(node.fullTag)}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); void handleRenameTag(node.fullTag); }}
          title={t("tags.renameHint", { defaultValue: "Rechtsklick: Tag umbenennen" })}
        >
          <div
            style={{ width: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={(e) => {
              if (hasChildren) {
                e.stopPropagation();
                toggleExpand(node);
              }
            }}
          >
            {hasChildren ? (
              isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
            ) : <Hash size={12} />}
          </div>
          <span style={{ marginLeft: '4px', fontSize: '0.85rem' }}>{node.name}</span>
          <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-muted)', opacity: 0.7 }}>
            {node.count}
          </span>
        </div>
        {hasChildren && isExpanded && (
          <div>
            {Object.values(node.children).map(child => renderNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflowY: 'auto', borderBottom: selectedTag ? '1px solid var(--border-color)' : 'none' }}>
        {Object.keys(tagTree).length === 0 ? (
          <div style={{ padding: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center' }}>
            {t("sidebar.noTags", "No tags found.")}
          </div>
        ) : Object.keys(visibleTree).length === 0 ? (
          <div style={{ padding: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center' }}>
            {t("sidebar.noResults")}
          </div>
        ) : (
          <div style={{ padding: '0.5rem 0' }}>
            {Object.values(visibleTree).map(node => renderNode(node, 0))}
          </div>
        )}
      </div>
      
      {selectedTag && (
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '8px 12px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color-light)' }}>
            {t("sidebar.filesWithTag", "Files with #{{tag}}", { tag: selectedTag })}
          </div>
          <div style={{ padding: '0.5rem' }}>
            {filesForTag.length === 0 ? (
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t("sidebar.noFiles", "No files.")}</div>
            ) : (
              filesForTag.map(file => (
                <div
                  key={file.path}
                  className="pv-rowhover"
                  onClick={(e) => onSelectPath(file.path, e.ctrlKey || e.metaKey)}
                  style={{
                    padding: '6px 8px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    borderRadius: "var(--radius-xs)"
                  }}
                >
                  <FileText size={14} color="var(--accent-color)" />
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {file.title || file.path.split(/[/\\]/).pop()}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
