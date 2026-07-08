# Plainva Desktop

The Tauri v2 desktop app for Plainva. The visible app title is **Plainva**.

Current scope:

- React + Vite frontend
- Tauri v2 native shell under `src-tauri`
- Local vault folder selection and persisted last-opened vault
- Nested file tree with SQLite FTS5 search
- CodeMirror 6 Markdown editor with debounced auto-save
- Tabs with back/forward history
- Read, Live Preview and Source view modes
- Obsidian-style local image preview and wiki-link handling
- Sync (WebDAV/Nextcloud, Google Drive BYO, S3-compatible, OneDrive, Dropbox), versioned per-file snapshots and daily vault ZIP backups

Beta status: Plainva is pre-1.0. Snapshots and backups are on by default, but keeping your own backups of important vaults is still recommended.

Run the web frontend shell:

```powershell
pnpm --filter desktop dev
```

Build the frontend bundle:

```powershell
pnpm --filter desktop build
```

Run the native Tauri shell:

```powershell
pnpm --filter desktop tauri dev
```

Native Tauri commands require Rust/Cargo and the platform-specific Tauri prerequisites.
