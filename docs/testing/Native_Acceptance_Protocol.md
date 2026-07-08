# Native Acceptance Protocol (Phase 7)

## 1. Overview
The **Native Acceptance Protocol** defines the automated and manual testing criteria required to ensure that Plainva Desktop meets the high standards for reliability, accessibility, and offline-first capabilities.

This document serves as the quality gate for Phase 7 (E2E & Native Acceptance).

## 2. E2E-Tests (Smoke Tests & Accessibility)
E2E tests use **Playwright** with a mocked `__TAURI_INTERNALS__` context for headless verification of the application logic.

### 2.1 Smoke Test Coverage
- **Vault Loading**: Verification that a mock vault mounts correctly.
- **Note Lifecycle**: 
  - Ability to select and open markdown files.
  - Ability to create new files (simulated).
  - Validation of UI transitions (e.g., Tab-state management).
- **Execution Command**:
  ```bash
  pnpm --filter desktop test:e2e
  ```

### 2.2 Accessibility (a11y) Checks
Accessibility is integrated directly into the Playwright test flow using `@axe-core/playwright`. 
At the end of key interaction paths, a full DOM analysis is performed.

**Current Enforced Standards:**
- **Color Contrast**: WCAG 2 AA minimum ratio (`4.5:1`).
- **Landmarks**: Unique landmarks (`aria-label` for `<aside>` sections).
- **Nested Interactive Elements**: Controls must not be nested (e.g., no buttons inside tabs).
- **ARIA Attributes**: Required labels on input and text editing fields (e.g., CodeMirror).

## 3. Recovery Drills (Index & SQLite)
To guarantee data consistency, especially during concurrent edits or system failures, recovery drills are implemented at the `@plainva/core` level.

### 3.1 VaultIndexer Drills
- **Full Re-Index (`indexVaultFull`)**: Validates that orphaned files (files removed from disk but present in the DB) are successfully cleaned up.
- **Verification**: `MockDatabaseAdapter` captures and asserts SQL queries executed during indexing.

### 3.2 Performance Benchmarks
- Ensures indexer performance does not degrade below acceptable thresholds (e.g., `< 50ms` for 1,000 files).
- **Execution Command**:
  ```bash
  pnpm --filter core run benchmark
  ```

## 4. Manual Native Acceptance (Tauri App)
Some aspects require manual or OS-level acceptance testing:

1. **System Trash Integration**:
   - Deleting a file via context menu moves it to the OS Trash (Trash/Recycle Bin) instead of permanent deletion.
2. **File System Watching**:
   - External file creations/modifications are instantly reflected in the FileTree.
3. **Focus Trap Management**:
   - Modals (Settings, Template Picker, WebDav Picker) correctly trap keyboard focus (Tab/Shift+Tab) and close on `Escape`.

## 5. Approval & Sign-off
Before merging major phase updates, the following must pass:
- [x] All Unit and Integration Tests (`vitest`).
- [x] All Playwright E2E Tests with `axe-core` violations at `0`.
- [x] Recovery Drills passing via MockDatabaseAdapter.
- [x] Manual Native OS features verified (Trash, FS Watcher).
