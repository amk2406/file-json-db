# Changelog

All notable changes to **file-json-db** are documented in this file.

## [1.4.0] - 2026-10-08

### Fixed
- **Corrupted parts**: copy to `crash/` **only once** (stable filename, marked in `index.corruptedParts`). Original part file is never deleted. Subsequent loads skip re-parse and re-copy.
- **`_delete`**: removed double-save and incorrect remaining-docs logic that could drop or keep wrong documents.
- `package.json` author field (missing `>`), homepage and repository URLs.

### Added
- **Real snapshot transactions**
  - `startTransaction()` deep-clones the index; parts load lazily into an in-memory overlay
  - Inserts / updates / deletes only touch the overlay until `commit()`
  - `rollback()` discards the overlay — disk is unchanged
  - One active transaction per collection
- **Batched `insertMany`**
  - Fills existing parts up to `maxRecords` / `maxPartSize`
  - Writes each part once; saves the index once at the end
  - **Primary `idIndex`** – O(1) lookups by document id (`find({ _id: … })`).
- **Multi-value secondary indexes** – multiple documents can share the same indexed value.
- **Fast `count()`** – uses part metadata / indexes when possible; never materialises the full result set for simple queries.
- **Empty-part cleanup** – after deletes, empty part files are removed from disk and from the index.

### Improved
- Transaction commit writes all modified parts then swaps the index in one step
- Query engine prefers id index → secondary index → full scan.
- Index rebuild builds both `idIndex` and multi-value secondary indexes.
- Delete / update correctly maintain both index layers.

---

## [1.3.0] - 2026-10-08

### Improved
- **Backup layout** (no extra timestamp folder, no `index.json`):
  ```
  backupRoot/
    users/
      part-0001.json
      part-0002.json
    orders/
      part-0001.json
  ```
- New option `backup(root, { pack: true })` – packs every collection into a single `{collection}.json` file instead of copying individual parts.
- Index now tracks `corruptedParts` so rebuild and normal loads stay consistent.

---

## [1.2.0] - 2026-09-30

### Added
- **`errorLevel`** option (`'debug'` | `'ignore'`)
  - `debug` (default): corrupted part files are copied to a `crash/` folder inside the collection and a message is logged
  - `ignore`: silently skip corrupted parts
- **`maxRecords`** option – limit the maximum number of documents per part file
- New update operators:
  - `$addToSet`
  - `$pop`
  - `$rename`
- Improved empty-file handling (whitespace-only files return `[]`)

### Improved
- Default `maxPartSize` increased from 128 KB → **256 KB**
- `rebuildIndexes()` / `rebuildId()` now **always fully rescan** all existing part files and recalculate `nextId` from actual data
- Safer part loading – process never crashes on invalid JSON
- Better atomic writes (already present from 1.1.0)

### Fixed
- Empty part files no longer cause `JSON.parse` errors
- Missing / deleted parts are correctly handled during rebuild
- More robust behavior when a part reaches its size or record limit

---

## [1.1.0] - 2026-09-26

### Added
- `updateFunc` / `updateFuncAsync`

### Improved
- `$pull` now supports matching objects by fields (e.g. `{ id: 2 }`)
- Safer atomic writes with unique temp files + retry

---

## [1.0.2] - 2026-09-20

- Initial public release
