# Changelog

All notable changes to **file-json-db** will be documented in this file.

## [1.1.0] - 2026-09-26

### Added
- **`updateFunc(filter, fn, options?)`** and **`updateFuncAsync(...)`**
  - Find documents using a filter
  - Pass each matching document to your own function
  - Save whatever the function returns
  - Supports `{ multi: true/false }` option

### Improved
- **`$pull` operator**
  - Now supports removing specific objects from arrays by matching fields
  - Example: `$pull: { names: { id: 2 } }` removes the object that has `id: 2`

- **Atomic writes**
  - Unique temporary file names (includes process id + timestamp)
  - Retry logic on rename to reduce rare race conditions on some filesystems

- **Resilience**
  - Better handling when part files are corrupted or missing
  - Safer index rebuilding

### Fixed
- Race condition that could occasionally occur during file rename
- More reliable behavior when a part file reaches its maximum size limit (automatically creates a new part)

---

## [1.0.2] - 2026-09-20

- Initial public release on npm
- Collections as folders
- Chunked part files
- Smart index with automatic rebuild
- MongoDB-style query & update operators
- Transactions, aggregation, import, backups, events
