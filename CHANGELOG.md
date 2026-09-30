# Changelog

All notable changes to **file-json-db** are documented in this file.

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
