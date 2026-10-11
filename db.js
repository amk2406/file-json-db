/**
 * file-json-db
 * A resilient, zero-dependency, MongoDB-style JSON document database for Node.js.
 * v1.4.0 - Real snapshot transactions, batched insertMany (maxRecords / part size)
 *
 * - Collection = Folder
 * - Data split into multiple part files
 * - Smart index kept in memory (idIndex + multi-value secondary indexes)
 * - Automatic recovery & self-healing
 * - Snapshot transactions with rollback
 * - Same familiar API style as low-json-db
 */

'use strict';

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');
const crypto = require('crypto');

const DEFAULT_MAX_PART_SIZE = 256 * 1024; // 256 KB

// ====================== HELPERS ======================

function ensureDirSync(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function atomicWriteSync(filePath, content) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);

  try {
    fs.writeFileSync(tmp, content, 'utf8');
    // Retry rename a few times to reduce rare race conditions
    let lastErr;
    for (let i = 0; i < 5; i++) {
      try {
        fs.renameSync(tmp, filePath);
        return;
      } catch (err) {
        lastErr = err;
        // Short yield instead of busy-wait
        try {
          const end = Date.now() + 5;
          while (Date.now() < end) {
            // minimal spin only for sync context; prefer async path when possible
          }
        } catch (_) {}
      }
    }
    throw lastErr;
  } catch (err) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
    throw err;
  }
}

async function atomicWriteAsync(filePath, content) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmp = path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);

  try {
    await fsp.writeFile(tmp, content, 'utf8');
    let lastErr;
    for (let i = 0; i < 5; i++) {
      try {
        await fsp.rename(tmp, filePath);
        return;
      } catch (err) {
        lastErr = err;
        await new Promise(r => setTimeout(r, 5));
      }
    }
    throw lastErr;
  } catch (err) {
    try { await fsp.unlink(tmp).catch(() => {}); } catch (_) {}
    throw err;
  }
}

function getNestedValue(obj, fieldPath) {
  if (!fieldPath) return undefined;
  const keys = fieldPath.split('.');
  let current = obj;
  for (const key of keys) {
    if (current == null) return undefined;
    current = current[key];
  }
  return current;
}

function setNestedValue(obj, fieldPath, value) {
  const keys = fieldPath.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (current[keys[i]] == null) current[keys[i]] = {};
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
}

function padPart(num) {
  return String(num).padStart(4, '0');
}

// ====================== QUERY MATCHER ======================

function matchQuery(doc, query) {
  if (!query || Object.keys(query).length === 0) return true;

  for (const [key, condition] of Object.entries(query)) {
    if (key === '$or') {
      if (!Array.isArray(condition) || !condition.some(q => matchQuery(doc, q))) return false;
      continue;
    }
    if (key === '$and') {
      if (!Array.isArray(condition) || !condition.every(q => matchQuery(doc, q))) return false;
      continue;
    }
    if (key === '$nor') {
      if (!Array.isArray(condition) || condition.some(q => matchQuery(doc, q))) return false;
      continue;
    }

    const value = getNestedValue(doc, key);

    if (condition && typeof condition === 'object' && !Array.isArray(condition) && condition !== null) {
      for (const [op, expected] of Object.entries(condition)) {
        switch (op) {
          case '$eq': if (value !== expected) return false; break;
          case '$ne': if (value === expected) return false; break;
          case '$gt': if (!(value > expected)) return false; break;
          case '$gte': if (!(value >= expected)) return false; break;
          case '$lt': if (!(value < expected)) return false; break;
          case '$lte': if (!(value <= expected)) return false; break;
          case '$in': if (!Array.isArray(expected) || !expected.includes(value)) return false; break;
          case '$nin': if (!Array.isArray(expected) || expected.includes(value)) return false; break;
          case '$exists': if ((value !== undefined) !== expected) return false; break;
          case '$regex': {
            const re = expected instanceof RegExp ? expected : new RegExp(expected, condition.$options || '');
            if (typeof value !== 'string' || !re.test(value)) return false;
            break;
          }
          case '$type': {
            const t = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
            if (t !== expected) return false;
            break;
          }
          case '$size': if (!Array.isArray(value) || value.length !== expected) return false; break;
          case '$elemMatch': {
            if (!Array.isArray(value) || !value.some(item => matchQuery(item, expected))) return false;
            break;
          }
          default: return false;
        }
      }
    } else {
      // Simple equality
      if (value !== condition) return false;
    }
  }
  return true;
}

// ====================== QUERY BUILDER ======================

class QueryBuilder {
  constructor(collection, query = {}) {
    this.collection = collection;
    this.query = query;
    this._limit = null;
    this._skip = 0;
    this._sort = null;
    this._project = null;
  }

  limit(n) {
    this._limit = n;
    return this;
  }

  skip(n) {
    this._skip = n;
    return this;
  }

  sort(obj) {
    this._sort = obj;
    return this;
  }

  project(obj) {
    this._project = obj;
    return this;
  }

  toArray() {
    return this.collection._executeQuery(this);
  }

  first() {
    const results = this.limit(1).toArray();
    return results[0] || null;
  }

  /** Count matching documents without materialising the full result set when possible. */
  count() {
    return this.collection._countQuery(this);
  }
}

// ====================== COLLECTION ======================

class Collection extends EventEmitter {
  constructor(options, dbPath, dbInstance) {
    super();

    this.name = options.name;
    this.dbPath = dbPath;
    this.db = dbInstance;

    this.autoId = options.autoId === true;
    this.idField = options.idField || '_id';
    this.idType = options.idType || 'auto';
    this.indexFields = Array.isArray(options.indexes) ? options.indexes : [];
    this.pretty = options.pretty !== false;
    this.maxPartSize = options.maxPartSize || DEFAULT_MAX_PART_SIZE;
    this.maxRecords = typeof options.maxRecords === 'number' ? options.maxRecords : null;
    this.errorLevel = options.errorLevel === 'ignore' ? 'ignore' : 'debug';

    this.collectionPath = path.join(dbPath, this.name);
    this.indexPath = path.join(this.collectionPath, 'index.json');

    this.index = null; // loaded index
    this._locked = false;
    this._queue = [];
    this._activeTx = null; // only one snapshot transaction at a time

    ensureDirSync(this.collectionPath);
    this._loadIndexSync();
  }

  // ---------- Lock ----------
  _withLock(fn) {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        this._locked = true;
        try {
          const result = await fn();
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          this._locked = false;
          if (this._queue.length > 0) {
            const next = this._queue.shift();
            next();
          }
        }
      };

      if (this._locked) {
        this._queue.push(execute);
      } else {
        execute();
      }
    });
  }

  // ---------- Index Management ----------
  _loadIndexSync() {
    try {
      if (fs.existsSync(this.indexPath)) {
        const content = fs.readFileSync(this.indexPath, 'utf8');
        this.index = JSON.parse(content);
        if (!this.index.parts) this.index.parts = {};
        if (!this.index.indexes) this.index.indexes = {};
        if (!this.index.idIndex) this.index.idIndex = {};
        if (!this.index.corruptedParts) this.index.corruptedParts = {};
        if (typeof this.index.nextId !== 'number') this.index.nextId = 1;
      } else {
        this._createEmptyIndex();
      }
    } catch (err) {
      this._emitError(err);
      this._createEmptyIndex();
      this._rebuildIndexSync();
    }
  }

  _createEmptyIndex() {
    this.index = {
      nextId: 1,
      parts: {},
      idIndex: {},       // id → partKey  (primary index)
      indexes: {},       // field → { value → [{ id, part }, ...] }  (multi-value)
      corruptedParts: {}
    };
  }

  _saveIndexSync() {
    try {
      const content = this.pretty
        ? JSON.stringify(this.index, null, 2)
        : JSON.stringify(this.index);
      atomicWriteSync(this.indexPath, content);
    } catch (err) {
      this._emitError(err);
    }
  }

  async _saveIndexAsync() {
    try {
      ensureDirSync(this.collectionPath)
      const content = this.pretty
        ? JSON.stringify(this.index, null, 2)
        : JSON.stringify(this.index);
      await atomicWriteAsync(this.indexPath, content);
    } catch (err) {
      this._emitError(err);
    }
  }

  _rebuildIndexSync() {
    try {
      const parts = this._listPartFiles();
      const previousCorrupted = (this.index && this.index.corruptedParts) ? { ...this.index.corruptedParts } : {};
      const newIndex = {
        nextId: 1,
        parts: {},
        idIndex: {},
        indexes: {},
        corruptedParts: previousCorrupted
      };

      let maxId = 0;

      for (const partName of parts) {
        const partKey = partName.replace('part-', '').replace('.json', '');

        if (newIndex.corruptedParts[partKey]) continue;

        // Temporarily clear the corrupted flag check path so _loadPartSync can run
        // (we already skipped known-corrupted above)
        const docs = this._loadPartSync(partName) || [];
        if (!Array.isArray(docs)) continue;

        let size = 0;
        try {
          size = fs.statSync(path.join(this.collectionPath, partName)).size;
        } catch (_) {}

        newIndex.parts[partKey] = { count: docs.length, size };

        for (const doc of docs) {
          if (!doc || typeof doc !== 'object') continue;
          const id = getNestedValue(doc, this.idField);
          if (id !== undefined && id !== null) {
            newIndex.idIndex[String(id)] = partKey;
            if (typeof id === 'number' && id > maxId) maxId = id;
          }

          for (const field of this.indexFields) {
            const val = getNestedValue(doc, field);
            if (val === undefined || val === null) continue;
            const key = String(val);
            if (!newIndex.indexes[field]) newIndex.indexes[field] = {};
            if (!newIndex.indexes[field][key]) newIndex.indexes[field][key] = [];
            newIndex.indexes[field][key].push({ id, part: partKey });
          }
        }
      }

      newIndex.nextId = maxId + 1;
      this.index = newIndex;
      this._saveIndexSync();

      this.emit('index-rebuilt', { collection: this.name });
      this.db?.emit('index-rebuilt', { collection: this.name });
    } catch (err) {
      this._emitError(err);
      if (!this.index) {
        this.index = { nextId: 1, parts: {}, idIndex: {}, indexes: {}, corruptedParts: {} };
      }
    }
  }

  // ---------- Part Files ----------
  _listPartFiles() {
    try {
      return fs.readdirSync(this.collectionPath)
        .filter(f => f.startsWith('part-') && f.endsWith('.json'))
        .sort();
    } catch (err) {
      this._emitError(err);
      return [];
    }
  }

  _partPath(partKey) {
    return path.join(this.collectionPath, `part-${partKey}.json`);
  }

  _loadPartSync(partKeyOrName) {
    const partKey = partKeyOrName.replace('part-', '').replace('.json', '');
    const filePath = this._partPath(partKey);

    // Already known-bad: skip parse + skip re-copy
    if (this.index && this.index.corruptedParts && this.index.corruptedParts[partKey]) {
      return [];
    }

    try {
      if (!fs.existsSync(filePath)) return null;

      const content = fs.readFileSync(filePath, 'utf8');

      // Empty or whitespace-only file
      if (!content || content.trim() === '') {
        return [];
      }

      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      // Corrupted part: copy ONCE to crash/, keep original in place, mark in index
      // so we never re-copy or re-parse the same damaged file on every load.
      if (this.errorLevel === 'debug') {
        try {
          if (!this.index.corruptedParts) this.index.corruptedParts = {};
          if (!this.index.corruptedParts[partKey]) {
            const crashDir = path.join(this.collectionPath, 'crash');
            ensureDirSync(crashDir);
            // Stable name – one copy per part, no timestamp spam
            const crashName = `part-${partKey}.json`;
            const crashPath = path.join(crashDir, crashName);
            if (!fs.existsSync(crashPath)) {
              fs.copyFileSync(filePath, crashPath);
              console.log(`[file-json-db] Failed to parse part-${partKey}.json → copied once to crash/${crashName}`);
            }
            this.index.corruptedParts[partKey] = {
              at: new Date().toISOString(),
              error: err.message
            };
            this._saveIndexSync();
          }
        } catch (copyErr) {
          // ignore copy failures
        }
        this._emitError(new Error(`Failed to load part ${partKey}: ${err.message}`));
      }
      // 'ignore' → silent; original file is never deleted
      return [];
    }
  }

  _savePartSync(partKey, docs) {
    try {
      ensureDirSync(this.collectionPath)
      const content = this.pretty
        ? JSON.stringify(docs, null, 2)
        : JSON.stringify(docs);
      atomicWriteSync(this._partPath(partKey), content);

      // Update size in index
      try {
        const size = fs.statSync(this._partPath(partKey)).size;
        if (!this.index.parts[partKey]) this.index.parts[partKey] = { count: 0, size: 0 };
        this.index.parts[partKey].count = docs.length;
        this.index.parts[partKey].size = size;
      } catch (_) {}
    } catch (err) {
      this._emitError(err);
    }
  }

  _findPartWithSpace() {
    for (const [partKey, meta] of Object.entries(this.index.parts)) {
      const sizeOk = (meta.size || 0) < this.maxPartSize;
      const recordsOk = this.maxRecords == null || (meta.count || 0) < this.maxRecords;
      if (sizeOk && recordsOk) return partKey;
    }
    return null;
  }

  _createNewPartKey() {
    const existing = Object.keys(this.index.parts).map(Number).filter(n => !isNaN(n));
    const next = existing.length ? Math.max(...existing) + 1 : 1;
    return padPart(next);
  }

  // ---------- ID Generation ----------
  generateId() {
    switch (this.idType) {
      case 'uuid':
        return crypto.randomUUID();
      case 'objectid': {
        const timestamp = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
        const random = crypto.randomBytes(8).toString('hex');
        return timestamp + random;
      }
      case 'auto':
      default:
        return this.index.nextId++;
    }
  }

  // ---------- Error helper ----------
  _emitError(err) {
    const error = err instanceof Error ? err : new Error(String(err));
    this.emit('error', error);
    this.db?.emit('error', error);
  }

  // ---------- Core Operations ----------

  insert(doc) {
    ensureDirSync(this.collectionPath);
    if (!doc || typeof doc !== 'object') return null;

    const document = { ...doc };

    if (this.autoId && getNestedValue(document, this.idField) === undefined) {
      setNestedValue(document, this.idField, this.generateId());
    }

    let partKey = this._findPartWithSpace();
    if (!partKey) {
      partKey = this._createNewPartKey();
      this.index.parts[partKey] = { count: 0, size: 0 };
    }

    let docs = this._loadPartSync(partKey) || [];
    docs.push(document);
    this._savePartSync(partKey, docs);

    const id = getNestedValue(document, this.idField);

    // Primary id index
    if (id !== undefined && id !== null) {
      if (!this.index.idIndex) this.index.idIndex = {};
      this.index.idIndex[String(id)] = partKey;
    }

    // Multi-value secondary indexes
    for (const field of this.indexFields) {
      const val = getNestedValue(document, field);
      if (val === undefined || val === null) continue;
      if (!this.index.indexes[field]) this.index.indexes[field] = {};
      const key = String(val);
      if (!this.index.indexes[field][key]) this.index.indexes[field][key] = [];
      this.index.indexes[field][key].push({ id, part: partKey });
    }

    this._saveIndexSync();

    this.emit('insert', { collection: this.name, document });
    this.db?.emit('insert', { collection: this.name, document });
    this.emit('save', { collection: this.name });
    this.db?.emit('save', { collection: this.name });

    return document;
  }

  insertAsync(doc) {
    return this._withLock(() => Promise.resolve(this.insert(doc)));
  }

  /**
   * Batched insertMany:
   * - Assigns IDs once
   * - Splits docs by maxRecords (if set) else by estimated JSON size vs maxPartSize
   * - Fills existing parts that still have room, then creates new parts
   * - Writes each part once and saves the index once at the end
   */
  insertMany(docs) {
    ensureDirSync(this.collectionPath);
    if (!Array.isArray(docs) || docs.length === 0) return [];

    const prepared = [];
    for (const doc of docs) {
      if (!doc || typeof doc !== 'object') continue;
      const document = { ...doc };
      if (this.autoId && getNestedValue(document, this.idField) === undefined) {
        setNestedValue(document, this.idField, this.generateId());
      }
      prepared.push(document);
    }
    if (prepared.length === 0) return [];

    // Estimate bytes per doc (rough) for size-based splitting
    const estimateSize = (d) => {
      try {
        return Buffer.byteLength(JSON.stringify(d), 'utf8') + 2; // +comma/newline
      } catch (_) {
        return 256;
      }
    };

    let cursor = 0;
    const inserted = [];

    while (cursor < prepared.length) {
      let partKey = this._findPartWithSpace();
      let existingDocs = [];
      let currentCount = 0;
      let currentSize = 0;

      if (partKey) {
        existingDocs = this._loadPartSync(partKey) || [];
        currentCount = existingDocs.length;
        currentSize = (this.index.parts[partKey] && this.index.parts[partKey].size) || 0;
      } else {
        partKey = this._createNewPartKey();
        this.index.parts[partKey] = { count: 0, size: 0 };
        existingDocs = [];
        currentCount = 0;
        currentSize = 0;
      }

      const batch = [];
      while (cursor < prepared.length) {
        const doc = prepared[cursor];
        const docSize = estimateSize(doc);

        const recordsOk =
          this.maxRecords == null || currentCount + batch.length + 1 <= this.maxRecords;
        const sizeOk = currentSize + docSize < this.maxPartSize || batch.length === 0;

        // Always allow at least one doc into a fresh/empty batch so we never stall
        if ((!recordsOk || !sizeOk) && batch.length > 0) break;

        batch.push(doc);
        currentSize += docSize;
        cursor++;
      }

      const merged = existingDocs.concat(batch);
      this._savePartSync(partKey, merged);

      // Update indexes for this batch only
      for (const document of batch) {
        const id = getNestedValue(document, this.idField);
        if (id !== undefined && id !== null) {
          if (!this.index.idIndex) this.index.idIndex = {};
          this.index.idIndex[String(id)] = partKey;
        }
        for (const field of this.indexFields) {
          const val = getNestedValue(document, field);
          if (val === undefined || val === null) continue;
          if (!this.index.indexes[field]) this.index.indexes[field] = {};
          const key = String(val);
          if (!this.index.indexes[field][key]) this.index.indexes[field][key] = [];
          this.index.indexes[field][key].push({ id, part: partKey });
        }
        inserted.push(document);
      }
    }

    this._saveIndexSync();

    this.emit('insert', { collection: this.name, count: inserted.length });
    this.db?.emit('insert', { collection: this.name, count: inserted.length });
    this.emit('save', { collection: this.name });
    this.db?.emit('save', { collection: this.name });

    return inserted;
  }

  insertManyAsync(docs) {
    return this._withLock(() => Promise.resolve(this.insertMany(docs)));
  }

  // ---------- Find ----------
  find(query = {}) {
    ensureDirSync(this.collectionPath)
    return new QueryBuilder(this, query);
  }

  findOne(query = {}) {
    return this.find(query).first();
  }

  findAsync(query = {}) {
    return Promise.resolve(this.find(query));
  }

  findOneAsync(query = {}) {
    return Promise.resolve(this.findOne(query));
  }

  /**
   * Resolve documents from a list of { id, part } index entries.
   * Returns matching docs (after full query filter).
   */
  _docsFromIndexEntries(entries, query) {
    if (!entries || entries.length === 0) return [];
    const results = [];
    // Group by part to minimise file reads
    const byPart = {};
    for (const e of entries) {
      if (!byPart[e.part]) byPart[e.part] = [];
      byPart[e.part].push(e.id);
    }
    for (const [partKey, ids] of Object.entries(byPart)) {
      const docs = this._loadPartSync(partKey);
      if (!docs) continue;
      const idSet = new Set(ids.map(String));
      for (const doc of docs) {
        const id = getNestedValue(doc, this.idField);
        if (idSet.has(String(id)) && matchQuery(doc, query)) {
          results.push(doc);
        }
      }
    }
    return results;
  }

  _executeQuery(builder) {
    const query = builder.query || {};
    ensureDirSync(this.collectionPath);

    // --- Fast path 1: exact lookup by primary id ---
    const idVal = query[this.idField];
    if (idVal !== undefined && typeof idVal !== 'object') {
      const partKey = this.index.idIndex && this.index.idIndex[String(idVal)];
      if (partKey) {
        const docs = this._loadPartSync(partKey) || [];
        const doc = docs.find(d => String(getNestedValue(d, this.idField)) === String(idVal));
        if (doc && matchQuery(doc, query)) {
          return this._applyBuilderTransforms([doc], builder);
        }
        // Stale index → rebuild once then full scan
        this._rebuildIndexSync();
        return this._fullScan(builder);
      }
      // id not in index → either missing or needs rebuild; try full scan
      return this._fullScan(builder);
    }

    // --- Fast path 2: exact equality on a secondary indexed field ---
    const indexedField = this.indexFields.find(
      f => query[f] !== undefined && typeof query[f] !== 'object'
    );
    if (indexedField) {
      const val = String(query[indexedField]);
      const entries = this.index.indexes[indexedField] && this.index.indexes[indexedField][val];
      if (Array.isArray(entries) && entries.length > 0) {
        const results = this._docsFromIndexEntries(entries, query);
        // If index returned nothing but we expected hits, rebuild
        if (results.length === 0 && entries.length > 0) {
          this._rebuildIndexSync();
          return this._fullScan(builder);
        }
        return this._applyBuilderTransforms(results, builder);
      }
      // No entries → either zero matches or stale; fall through to full scan only if needed
      // For pure equality on indexed field with no hits, return empty quickly
      if (Object.keys(query).length === 1) {
        return this._applyBuilderTransforms([], builder);
      }
    }

    return this._fullScan(builder);
  }

  /** Apply sort / skip / limit / project without re-scanning. */
  _applyBuilderTransforms(results, builder) {
    let final = results;
    if (builder._sort) {
      const sortKeys = Object.entries(builder._sort);
      final = final.slice().sort((a, b) => {
        for (const [key, dir] of sortKeys) {
          const va = getNestedValue(a, key);
          const vb = getNestedValue(b, key);
          if (va < vb) return dir === -1 || dir === 'desc' ? 1 : -1;
          if (va > vb) return dir === -1 || dir === 'desc' ? -1 : 1;
        }
        return 0;
      });
    }
    if (builder._skip) final = final.slice(builder._skip);
    if (builder._limit != null) final = final.slice(0, builder._limit);
    if (builder._project) {
      final = final.map(doc => {
        const projected = {};
        for (const [k, v] of Object.entries(builder._project)) {
          if (v) projected[k] = getNestedValue(doc, k);
        }
        return projected;
      });
    }
    return final;
  }

  /** Fast count – avoids materialising documents when possible. */
  _countQuery(builder) {
    const query = builder.query || {};
    // Empty query → sum part counts from index
    if (!query || Object.keys(query).length === 0) {
      let total = 0;
      for (const meta of Object.values(this.index.parts || {})) {
        total += meta.count || 0;
      }
      return total;
    }
    // id lookup
    const idVal = query[this.idField];
    if (idVal !== undefined && typeof idVal !== 'object' && Object.keys(query).length === 1) {
      return this.index.idIndex && this.index.idIndex[String(idVal)] ? 1 : 0;
    }
    // secondary index equality
    const indexedField = this.indexFields.find(
      f => query[f] !== undefined && typeof query[f] !== 'object'
    );
    if (indexedField && Object.keys(query).length === 1) {
      const entries = this.index.indexes[indexedField] && this.index.indexes[indexedField][String(query[indexedField])];
      return Array.isArray(entries) ? entries.length : 0;
    }
    // Fallback: full scan count (no materialisation of result array beyond counter)
    let count = 0;
    const parts = this._listPartFiles();
    for (const partName of parts) {
      const docs = this._loadPartSync(partName);
      if (!docs) continue;
      for (const doc of docs) {
        if (matchQuery(doc, query)) count++;
      }
    }
    if (builder._skip) count = Math.max(0, count - builder._skip);
    if (builder._limit != null) count = Math.min(count, builder._limit);
    return count;
  }

  _fullScan(builder) {
    const results = [];
    const parts = this._listPartFiles();

    for (const partName of parts) {
      const partKey = partName.replace('part-', '').replace('.json', '');
      if (this.index.corruptedParts && this.index.corruptedParts[partKey]) continue;

      const docs = this._loadPartSync(partName);
      if (!docs) continue;

      for (const doc of docs) {
        if (matchQuery(doc, builder.query)) {
          results.push(doc);
        }
      }
    }

    return this._applyBuilderTransforms(results, builder);
  }

  // ---------- Update ----------
  updateOne(filter, update) {
    return this._update(filter, update, true);
  }

  updateMany(filter, update) {
    return this._update(filter, update, false);
  }

  updateOneAsync(filter, update) {
    return this._withLock(() => Promise.resolve(this.updateOne(filter, update)));
  }

  updateManyAsync(filter, update) {
    return this._withLock(() => Promise.resolve(this.updateMany(filter, update)));
  }

  _update(filter, update, onlyOne) {
    const updatedDocs = [];
    const parts = this._listPartFiles();
    let found = false;

    for (const partName of parts) {
      if (onlyOne && found) break;

      const partKey = partName.replace('part-', '').replace('.json', '');
      let docs = this._loadPartSync(partKey);
      if (!docs) continue;

      let modified = false;

      for (let i = 0; i < docs.length; i++) {
        if (matchQuery(docs[i], filter)) {
          const original = { ...docs[i] };
          this._applyUpdate(docs[i], update);
          updatedDocs.push(docs[i]);
          modified = true;
          found = true;

          // Update indexes if needed
          this._updateIndexesForDoc(original, docs[i], partKey);

          if (onlyOne) break;
        }
      }

      if (modified) {
        this._savePartSync(partKey, docs);
      }
    }

    if (updatedDocs.length > 0) {
      this._saveIndexSync();
      this.emit('update', { collection: this.name, count: updatedDocs.length });
      this.db?.emit('update', { collection: this.name, count: updatedDocs.length });
      this.emit('save', { collection: this.name });
      this.db?.emit('save', { collection: this.name });
    }

    return onlyOne ? (updatedDocs[0] || null) : updatedDocs;
  }

  _applyUpdate(doc, update) {
    for (const [op, fields] of Object.entries(update)) {
      if (op === '$set') {
        for (const [k, v] of Object.entries(fields)) setNestedValue(doc, k, v);
      } else if (op === '$inc') {
        for (const [k, v] of Object.entries(fields)) {
          const current = getNestedValue(doc, k) || 0;
          setNestedValue(doc, k, current + v);
        }
      } else if (op === '$push') {
        for (const [k, v] of Object.entries(fields)) {
          let arr = getNestedValue(doc, k);
          if (!Array.isArray(arr)) {
            arr = [];
            setNestedValue(doc, k, arr);
          }
          arr.push(v);
        }
      } else if (op === '$pull') {
        for (const [k, v] of Object.entries(fields)) {
          let arr = getNestedValue(doc, k);
          if (!Array.isArray(arr)) continue;

          if (v && typeof v === 'object' && !Array.isArray(v)) {
            // Match objects by fields (e.g. { id: 2 })
            setNestedValue(doc, k, arr.filter(item => {
              if (item == null || typeof item !== 'object') return true;
              for (const [fk, fv] of Object.entries(v)) {
                if (item[fk] !== fv) return true; // keep if not matching
              }
              return false; // remove if all fields match
            }));
          } else {
            // Simple value match
            setNestedValue(doc, k, arr.filter(item => item !== v));
          }
        }
      } else if (op === '$unset') {
        for (const k of Object.keys(fields)) {
          const keys = k.split('.');
          let current = doc;
          for (let i = 0; i < keys.length - 1; i++) {
            if (current[keys[i]] == null) break;
            current = current[keys[i]];
          }
          if (current && typeof current === 'object') {
            delete current[keys[keys.length - 1]];
          }
        }
      } else if (op === '$addToSet') {
        for (const [k, v] of Object.entries(fields)) {
          let arr = getNestedValue(doc, k);
          if (!Array.isArray(arr)) {
            arr = [];
            setNestedValue(doc, k, arr);
          }
          const exists = arr.some(item => JSON.stringify(item) === JSON.stringify(v));
          if (!exists) arr.push(v);
        }
      } else if (op === '$pop') {
        for (const [k, v] of Object.entries(fields)) {
          let arr = getNestedValue(doc, k);
          if (!Array.isArray(arr) || arr.length === 0) continue;
          if (v === 1) arr.pop();
          else if (v === -1) arr.shift();
        }
      } else if (op === '$rename') {
        for (const [oldKey, newKey] of Object.entries(fields)) {
          const val = getNestedValue(doc, oldKey);
          if (val !== undefined) {
            setNestedValue(doc, newKey, val);
            // unset old
            const keys = oldKey.split('.');
            let current = doc;
            for (let i = 0; i < keys.length - 1; i++) {
              if (current[keys[i]] == null) break;
              current = current[keys[i]];
            }
            if (current && typeof current === 'object') {
              delete current[keys[keys.length - 1]];
            }
          }
        }
      }
    }
  }

  _updateIndexesForDoc(oldDoc, newDoc, partKey) {
    const oldId = getNestedValue(oldDoc, this.idField);
    const newId = getNestedValue(newDoc, this.idField);

    // Primary id index
    if (!this.index.idIndex) this.index.idIndex = {};
    if (oldId !== undefined && oldId !== null && String(oldId) !== String(newId)) {
      delete this.index.idIndex[String(oldId)];
    }
    if (newId !== undefined && newId !== null) {
      this.index.idIndex[String(newId)] = partKey;
    }

    // Multi-value secondary indexes
    for (const field of this.indexFields) {
      const oldVal = getNestedValue(oldDoc, field);
      const newVal = getNestedValue(newDoc, field);

      if (String(oldVal) === String(newVal)) continue;

      if (oldVal != null && this.index.indexes[field]) {
        const key = String(oldVal);
        const list = this.index.indexes[field][key];
        if (Array.isArray(list)) {
          this.index.indexes[field][key] = list.filter(
            e => String(e.id) !== String(oldId)
          );
          if (this.index.indexes[field][key].length === 0) {
            delete this.index.indexes[field][key];
          }
        }
      }
      if (newVal != null) {
        if (!this.index.indexes[field]) this.index.indexes[field] = {};
        const key = String(newVal);
        if (!this.index.indexes[field][key]) this.index.indexes[field][key] = [];
        this.index.indexes[field][key].push({ id: newId, part: partKey });
      }
    }
  }

  // ---------- Delete ----------
  deleteOne(filter) {
    return this._delete(filter, true);
  }

  deleteMany(filter) {
    return this._delete(filter, false);
  }

  deleteOneAsync(filter) {
    return this._withLock(() => Promise.resolve(this.deleteOne(filter)));
  }


  deleteManyAsync(filter) {
    return this._withLock(() => Promise.resolve(this.deleteMany(filter)));
  }

  /**
   * updateFunc - Find documents by filter, pass each to a user function,
   * and save whatever the function returns.
   *
   * @param {object} filter
   * @param {function} fn - (doc) => newDoc
   * @param {object} [options] - { multi: true/false }
   */
  updateFunc(filter, fn, options = {}) {
    if (typeof fn !== 'function') {
      throw new Error('updateFunc requires a function as second argument');
    }

    const multi = options.multi !== false; // default true
    const results = [];
    const parts = this._listPartFiles();
    let found = false;

    for (const partName of parts) {
      if (!multi && found) break;

      const partKey = partName.replace('part-', '').replace('.json', '');
      let docs = this._loadPartSync(partKey);
      if (!docs) continue;

      let modified = false;

      for (let i = 0; i < docs.length; i++) {
        if (matchQuery(docs[i], filter)) {
          const original = { ...docs[i] };
          const returned = fn({ ...docs[i] });

          if (returned && typeof returned === 'object') {
            // Preserve the original id if user forgot it
            const idField = this.idField;
            if (getNestedValue(returned, idField) === undefined) {
              setNestedValue(returned, idField, getNestedValue(original, idField));
            }
            docs[i] = returned;
            this._updateIndexesForDoc(original, returned, partKey);
            results.push(returned);
            modified = true;
            found = true;
            if (!multi) break;
          }
        }
      }

      if (modified) {
        this._savePartSync(partKey, docs);
      }
    }

    if (results.length > 0) {
      this._saveIndexSync();
      this.emit('update', { collection: this.name, count: results.length });
      this.db?.emit('update', { collection: this.name, count: results.length });
      this.emit('save', { collection: this.name });
      this.db?.emit('save', { collection: this.name });
    }

    return multi ? results : (results[0] || null);
  }

  updateFuncAsync(filter, fn, options = {}) {
    return this._withLock(() => Promise.resolve(this.updateFunc(filter, fn, options)));
  }


  _delete(filter, onlyOne) {
    const deleted = [];
    const parts = this._listPartFiles();
    let found = false;

    for (const partName of parts) {
      if (onlyOne && found) break;

      const partKey = partName.replace('part-', '').replace('.json', '');
      if (this.index.corruptedParts && this.index.corruptedParts[partKey]) continue;

      let docs = this._loadPartSync(partKey);
      if (!docs) continue;

      const remaining = [];
      let modified = false;

      for (const doc of docs) {
        if ((!onlyOne || !found) && matchQuery(doc, filter)) {
          deleted.push(doc);
          modified = true;
          found = true;

          const id = getNestedValue(doc, this.idField);

          // Remove from primary id index
          if (id !== undefined && id !== null && this.index.idIndex) {
            delete this.index.idIndex[String(id)];
          }

          // Remove from multi-value secondary indexes
          for (const field of this.indexFields) {
            const val = getNestedValue(doc, field);
            if (val != null && this.index.indexes[field]) {
              const key = String(val);
              const list = this.index.indexes[field][key];
              if (Array.isArray(list)) {
                this.index.indexes[field][key] = list.filter(
                  e => String(e.id) !== String(id)
                );
                if (this.index.indexes[field][key].length === 0) {
                  delete this.index.indexes[field][key];
                }
              }
            }
          }
        } else {
          remaining.push(doc);
        }
      }

      if (modified) {
        if (remaining.length === 0) {
          // Empty part → remove file and drop from index (compaction)
          try {
            const p = this._partPath(partKey);
            if (fs.existsSync(p)) fs.unlinkSync(p);
          } catch (_) {}
          delete this.index.parts[partKey];
        } else {
          this._savePartSync(partKey, remaining);
        }
      }
    }

    if (deleted.length > 0) {
      this._saveIndexSync();
      this.emit('delete', { collection: this.name, count: deleted.length });
      this.db?.emit('delete', { collection: this.name, count: deleted.length });
      this.emit('save', { collection: this.name });
      this.db?.emit('save', { collection: this.name });
    }

    return onlyOne ? (deleted[0] || null) : deleted;
  }

  // ---------- Utility ----------
  rebuildIndexes() {
    this._rebuildIndexSync();
  }

  rebuildId() {
    // Recalculate nextId from existing data
    this._rebuildIndexSync();
    return this.index.nextId;
  }
}

// ====================== JSONDB ======================

class JSONDB extends EventEmitter {
  constructor(dbPath = './database') {
    super();
    this.dbPath = dbPath;
    this.collections = {};
    this.collectionOptions = {};

    try {
      ensureDirSync(dbPath);
    } catch (err) {
      this.emit('error', err);
    }
  }

  collection(nameOrOptions) {
    const options = typeof nameOrOptions === 'string'
      ? { name: nameOrOptions }
      : (nameOrOptions || {});

    if (!options.name) {
      throw new Error('Collection name is required');
    }

    const name = options.name;

    if (!this.collectionOptions[name]) {
      this.collectionOptions[name] = { ...options };
    } else {
      this.collectionOptions[name] = { ...this.collectionOptions[name], ...options };
    }

    if (!this.collections[name]) {
      this.collections[name] = new Collection(
        this.collectionOptions[name],
        this.dbPath,
        this
      );
    }

    return this.collections[name];
  }

  createCollection(nameOrOptions) {
    return this.collection(nameOrOptions);
  }

  listCollections() {
    try {
      return fs.readdirSync(this.dbPath)
        .filter(f => {
          const full = path.join(this.dbPath, f);
          return fs.statSync(full).isDirectory();
        });
    } catch (err) {
      this.emit('error', err);
      return [];
    }
  }

  dropCollection(name) {
    try {
      const colPath = path.join(this.dbPath, name);
      if (fs.existsSync(colPath)) {
        fs.rmSync(colPath, { recursive: true, force: true });
      }
      delete this.collections[name];
      delete this.collectionOptions[name];
      return true;
    } catch (err) {
      this.emit('error', err);
      return false;
    }
  }

  unloadCollection(name) {
    if (this.collections[name]) {
      delete this.collections[name];
      this.emit('unload', { collection: name });
      return true;
    }
    return false;
  }

  /**
   * Backup layout (no extra timestamp folder, no index.json):
   *
   *   backupRoot/
   *     users/
   *       part-0001.json
   *       part-0002.json
   *     orders/
   *       part-0001.json
   *
   * Only collection part files are written. index.json and crash/ are skipped.
   * Optionally pack each collection into a single .json file when options.pack === true.
   *
   * @param {string} backupRoot
   * @param {{ pack?: boolean }} [options]
   * @returns {string|null} path to backupRoot on success
   */
  backup(backupRoot = './backups', options = {}) {
    try {
      const pack = options.pack === true;
      ensureDirSync(backupRoot);

      const collections = this.listCollections();

      for (const colName of collections) {
        const srcColPath = path.join(this.dbPath, colName);
        if (!fs.existsSync(srcColPath) || !fs.statSync(srcColPath).isDirectory()) continue;

        const destColPath = path.join(backupRoot, colName);
        ensureDirSync(destColPath);

        const partFiles = fs.readdirSync(srcColPath)
          .filter(f => f.startsWith('part-') && f.endsWith('.json'));

        if (pack) {
          // Pack all documents of this collection into one file
          const allDocs = [];
          for (const part of partFiles) {
            try {
              const content = fs.readFileSync(path.join(srcColPath, part), 'utf8');
              if (!content || !content.trim()) continue;
              const parsed = JSON.parse(content);
              if (Array.isArray(parsed)) allDocs.push(...parsed);
            } catch (_) {
              // skip corrupted parts in backup
            }
          }
          const outFile = path.join(destColPath, `${colName}.json`);
          const body = JSON.stringify(allDocs, null, 2);
          fs.writeFileSync(outFile, body, 'utf8');
        } else {
          // Copy only part files (skip index.json, crash/, tmp files)
          for (const part of partFiles) {
            const src = path.join(srcColPath, part);
            const dest = path.join(destColPath, part);
            fs.copyFileSync(src, dest);
          }
        }
      }

      this.emit('backup', { path: backupRoot, pack });
      return backupRoot;
    } catch (err) {
      this.emit('error', err);
      return null;
    }
  }

  async backupAsync(backupRoot = './backups', options = {}) {
    return this.backup(backupRoot, options);
  }
}

// ====================== EXPORTS ======================


// ====================== TRANSACTION (real snapshot) ======================
/**
 * Snapshot transaction:
 * - On start: deep-clones the in-memory index; parts are loaded lazily into an overlay.
 * - All inserts/updates/deletes mutate only the overlay + working index.
 * - Disk is untouched until commit().
 * - rollback() discards the overlay — collection files stay as they were.
 * - Only one active transaction per collection (enforced).
 */
class Transaction {
  constructor(collection) {
    if (collection._activeTx) {
      throw new Error('Collection already has an active transaction');
    }
    this.collection = collection;
    this.active = true;
    collection._activeTx = this;

    // Snapshot of index at start (deep clone)
    this.workingIndex = JSON.parse(JSON.stringify(collection.index));
    // partKey → docs[]  (only parts that were read or written)
    this.partOverlay = new Map();
    // partKeys that were fully deleted (empty after delete)
    this.deletedParts = new Set();
    // Track original nextId for generateId inside tx
    this._nextId = this.workingIndex.nextId || 1;
  }

  _ensureActive() {
    if (!this.active) {
      throw new Error('Transaction is no longer active');
    }
  }

  _generateId() {
    const col = this.collection;
    switch (col.idType) {
      case 'uuid':
        return crypto.randomUUID();
      case 'objectid': {
        const timestamp = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
        const random = crypto.randomBytes(8).toString('hex');
        return timestamp + random;
      }
      case 'auto':
      default: {
        const id = this._nextId++;
        this.workingIndex.nextId = this._nextId;
        return id;
      }
    }
  }

  /** Load a part into the overlay (from overlay, or disk, or empty). */
  _getPartDocs(partKey) {
    if (this.deletedParts.has(partKey)) return [];
    if (this.partOverlay.has(partKey)) {
      return this.partOverlay.get(partKey);
    }
    const docs = this.collection._loadPartSync(partKey);
    const copy = Array.isArray(docs) ? docs.map(d => ({ ...d })) : [];
    this.partOverlay.set(partKey, copy);
    return copy;
  }

  _setPartDocs(partKey, docs) {
    if (!docs || docs.length === 0) {
      this.partOverlay.set(partKey, []);
      this.deletedParts.add(partKey);
    } else {
      this.partOverlay.set(partKey, docs);
      this.deletedParts.delete(partKey);
    }
  }

  _findPartWithSpace() {
    for (const [partKey, meta] of Object.entries(this.workingIndex.parts || {})) {
      if (this.deletedParts.has(partKey)) continue;
      const overlay = this.partOverlay.get(partKey);
      const count = overlay ? overlay.length : (meta.count || 0);
      const size = overlay
        ? Buffer.byteLength(JSON.stringify(overlay), 'utf8')
        : (meta.size || 0);
      const sizeOk = size < this.collection.maxPartSize;
      const recordsOk =
        this.collection.maxRecords == null || count < this.collection.maxRecords;
      if (sizeOk && recordsOk) return partKey;
    }
    return null;
  }

  _createNewPartKey() {
    const existing = Object.keys(this.workingIndex.parts || {})
      .map(Number)
      .filter(n => !isNaN(n));
    const next = existing.length ? Math.max(...existing) + 1 : 1;
    return padPart(next);
  }

  _indexAddDoc(doc, partKey) {
    const id = getNestedValue(doc, this.collection.idField);
    if (id !== undefined && id !== null) {
      if (!this.workingIndex.idIndex) this.workingIndex.idIndex = {};
      this.workingIndex.idIndex[String(id)] = partKey;
    }
    for (const field of this.collection.indexFields) {
      const val = getNestedValue(doc, field);
      if (val === undefined || val === null) continue;
      if (!this.workingIndex.indexes[field]) this.workingIndex.indexes[field] = {};
      const key = String(val);
      if (!this.workingIndex.indexes[field][key]) this.workingIndex.indexes[field][key] = [];
      this.workingIndex.indexes[field][key].push({ id, part: partKey });
    }
  }

  _indexRemoveDoc(doc) {
    const id = getNestedValue(doc, this.collection.idField);
    if (id !== undefined && id !== null && this.workingIndex.idIndex) {
      delete this.workingIndex.idIndex[String(id)];
    }
    for (const field of this.collection.indexFields) {
      const val = getNestedValue(doc, field);
      if (val != null && this.workingIndex.indexes[field]) {
        const key = String(val);
        const list = this.workingIndex.indexes[field][key];
        if (Array.isArray(list)) {
          this.workingIndex.indexes[field][key] = list.filter(
            e => String(e.id) !== String(id)
          );
          if (this.workingIndex.indexes[field][key].length === 0) {
            delete this.workingIndex.indexes[field][key];
          }
        }
      }
    }
  }

  // ---------- Public API ----------

  insert(doc) {
    this._ensureActive();
    if (!doc || typeof doc !== 'object') return null;

    const document = { ...doc };
    if (
      this.collection.autoId &&
      getNestedValue(document, this.collection.idField) === undefined
    ) {
      setNestedValue(document, this.collection.idField, this._generateId());
    }

    let partKey = this._findPartWithSpace();
    if (!partKey) {
      partKey = this._createNewPartKey();
      if (!this.workingIndex.parts) this.workingIndex.parts = {};
      this.workingIndex.parts[partKey] = { count: 0, size: 0 };
    }

    const docs = this._getPartDocs(partKey);
    docs.push(document);
    this._setPartDocs(partKey, docs);

    this.workingIndex.parts[partKey] = {
      count: docs.length,
      size: Buffer.byteLength(JSON.stringify(docs), 'utf8')
    };
    this._indexAddDoc(document, partKey);

    return document;
  }

  insertAsync(doc) {
    return Promise.resolve(this.insert(doc));
  }

  insertMany(docs) {
    this._ensureActive();
    if (!Array.isArray(docs)) return [];
    const out = [];
    for (const d of docs) {
      const r = this.insert(d);
      if (r) out.push(r);
    }
    return out;
  }

  insertManyAsync(docs) {
    return Promise.resolve(this.insertMany(docs));
  }

  updateOne(filter, update) {
    return this._update(filter, update, true);
  }

  updateOneAsync(filter, update) {
    return Promise.resolve(this.updateOne(filter, update));
  }

  updateMany(filter, update) {
    return this._update(filter, update, false);
  }

  updateManyAsync(filter, update) {
    return Promise.resolve(this.updateMany(filter, update));
  }

  _update(filter, update, onlyOne) {
    this._ensureActive();
    const updated = [];
    const partKeys = new Set([
      ...Object.keys(this.workingIndex.parts || {}),
      ...this.partOverlay.keys()
    ]);

    for (const partKey of partKeys) {
      if (onlyOne && updated.length > 0) break;
      if (this.deletedParts.has(partKey) && !this.partOverlay.has(partKey)) continue;

      const docs = this._getPartDocs(partKey);
      let modified = false;

      for (let i = 0; i < docs.length; i++) {
        if (matchQuery(docs[i], filter)) {
          const original = { ...docs[i] };
          this.collection._applyUpdate(docs[i], update);
          this._indexRemoveDoc(original);
          this._indexAddDoc(docs[i], partKey);
          updated.push(docs[i]);
          modified = true;
          if (onlyOne) break;
        }
      }

      if (modified) {
        this._setPartDocs(partKey, docs);
        this.workingIndex.parts[partKey] = {
          count: docs.length,
          size: Buffer.byteLength(JSON.stringify(docs), 'utf8')
        };
      }
    }

    return onlyOne ? (updated[0] || null) : updated;
  }

  deleteOne(filter) {
    return this._delete(filter, true);
  }

  deleteOneAsync(filter) {
    return Promise.resolve(this.deleteOne(filter));
  }

  deleteMany(filter) {
    return this._delete(filter, false);
  }

  deleteManyAsync(filter) {
    return Promise.resolve(this.deleteMany(filter));
  }

  _delete(filter, onlyOne) {
    this._ensureActive();
    const deleted = [];
    const partKeys = new Set([
      ...Object.keys(this.workingIndex.parts || {}),
      ...this.partOverlay.keys()
    ]);

    for (const partKey of partKeys) {
      if (onlyOne && deleted.length > 0) break;
      if (this.deletedParts.has(partKey) && !this.partOverlay.has(partKey)) continue;

      const docs = this._getPartDocs(partKey);
      const remaining = [];
      let modified = false;

      for (const doc of docs) {
        if ((!onlyOne || deleted.length === 0) && matchQuery(doc, filter)) {
          deleted.push(doc);
          this._indexRemoveDoc(doc);
          modified = true;
        } else {
          remaining.push(doc);
        }
      }

      if (modified) {
        this._setPartDocs(partKey, remaining);
        if (remaining.length === 0) {
          delete this.workingIndex.parts[partKey];
        } else {
          this.workingIndex.parts[partKey] = {
            count: remaining.length,
            size: Buffer.byteLength(JSON.stringify(remaining), 'utf8')
          };
        }
      }
    }

    return onlyOne ? (deleted[0] || null) : deleted;
  }

  /**
   * Commit: write all overlay parts to disk, then replace the collection index.
   * Disk is only touched here. On failure the collection index is left unchanged
   * if we haven't swapped yet; partial part writes are recoverable via rebuildIndexes.
   */
  async commit() {
    this._ensureActive();
    const col = this.collection;

    try {
      // Write / delete parts
      for (const [partKey, docs] of this.partOverlay.entries()) {
        if (this.deletedParts.has(partKey) || docs.length === 0) {
          try {
            const p = col._partPath(partKey);
            if (fs.existsSync(p)) fs.unlinkSync(p);
          } catch (_) {}
          delete this.workingIndex.parts[partKey];
        } else {
          col._savePartSync(partKey, docs);
          // _savePartSync already updates col.index.parts — we overwrite index below
        }
      }

      // Also remove any parts marked deleted that weren't in overlay with data
      for (const partKey of this.deletedParts) {
        try {
          const p = col._partPath(partKey);
          if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch (_) {}
        delete this.workingIndex.parts[partKey];
      }

      // Swap index + persist
      this.workingIndex.nextId = this._nextId;
      col.index = this.workingIndex;
      col._saveIndexSync();

      this.active = false;
      col._activeTx = null;

      col.emit('transactionCommit', { collection: col.name });
      col.db?.emit('transactionCommit', { collection: col.name });
      col.emit('save', { collection: col.name });
      col.db?.emit('save', { collection: col.name });

      return true;
    } catch (err) {
      col._emitError(err);
      // Leave transaction active so caller can retry or rollback
      return false;
    }
  }

  async rollback() {
    this._ensureActive();
    this.partOverlay.clear();
    this.deletedParts.clear();
    this.workingIndex = null;
    this.active = false;
    this.collection._activeTx = null;

    this.collection.emit('transactionRollback', {
      collection: this.collection.name
    });
    this.collection.db?.emit('transactionRollback', {
      collection: this.collection.name
    });
    return true;
  }
}

// Patch Collection with missing methods
const CollectionProto = Collection.prototype;

CollectionProto.startTransaction = function () {
  return new Transaction(this);
};

CollectionProto.aggregate = function (pipeline = []) {
  let docs = this._fullScan({ query: {}, _sort: null, _skip: 0, _limit: null, _project: null });

  for (const stage of pipeline) {
    if (stage.$match) {
      docs = docs.filter(doc => matchQuery(doc, stage.$match));
    } else if (stage.$sort) {
      const sortKeys = Object.entries(stage.$sort);
      docs.sort((a, b) => {
        for (const [key, dir] of sortKeys) {
          const va = getNestedValue(a, key);
          const vb = getNestedValue(b, key);
          if (va < vb) return dir === -1 ? 1 : -1;
          if (va > vb) return dir === -1 ? -1 : 1;
        }
        return 0;
      });
    } else if (stage.$limit) {
      docs = docs.slice(0, stage.$limit);
    } else if (stage.$skip) {
      docs = docs.slice(stage.$skip);
    } else if (stage.$project) {
      docs = docs.map(doc => {
        const projected = {};
        for (const [k, v] of Object.entries(stage.$project)) {
          if (v) projected[k] = getNestedValue(doc, k);
        }
        return projected;
      });
    } else if (stage.$group) {
      const groups = {};
      const idExpr = stage.$group._id;
      for (const doc of docs) {
        const key = idExpr === null ? 'null' : String(getNestedValue(doc, idExpr.replace(/^\$/, '') || idExpr));
        if (!groups[key]) {
          groups[key] = { _id: idExpr === null ? null : getNestedValue(doc, idExpr.replace(/^\$/, '') || idExpr) };
        }
        for (const [field, expr] of Object.entries(stage.$group)) {
          if (field === '_id') continue;
          if (expr.$sum) {
            const val = expr.$sum === 1 ? 1 : (getNestedValue(doc, expr.$sum.replace(/^\$/, '')) || 0);
            groups[key][field] = (groups[key][field] || 0) + val;
          } else if (expr.$avg) {
            const val = getNestedValue(doc, expr.$avg.replace(/^\$/, '')) || 0;
            if (!groups[key]['_' + field + '_sum']) {
              groups[key]['_' + field + '_sum'] = 0;
              groups[key]['_' + field + '_count'] = 0;
            }
            groups[key]['_' + field + '_sum'] += val;
            groups[key]['_' + field + '_count'] += 1;
            groups[key][field] = groups[key]['_' + field + '_sum'] / groups[key]['_' + field + '_count'];
          } else if (expr.$min) {
            const val = getNestedValue(doc, expr.$min.replace(/^\$/, ''));
            if (groups[key][field] === undefined || val < groups[key][field]) groups[key][field] = val;
          } else if (expr.$max) {
            const val = getNestedValue(doc, expr.$max.replace(/^\$/, ''));
            if (groups[key][field] === undefined || val > groups[key][field]) groups[key][field] = val;
          } else if (expr.$push) {
            if (!groups[key][field]) groups[key][field] = [];
            groups[key][field].push(getNestedValue(doc, expr.$push.replace(/^\$/, '')));
          }
        }
      }
      docs = Object.values(groups).map(g => {
        const clean = { ...g };
        for (const k of Object.keys(clean)) {
          if (k.startsWith('_') && k !== '_id') delete clean[k];
        }
        return clean;
      });
    } else if (stage.$count) {
      return [{ [stage.$count]: docs.length }];
    }
  }
  return docs;
};

CollectionProto.import = function (filePath, options = {}) {
  try {
    if (!fs.existsSync(filePath)) return false;
    const content = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(content);
    const docs = Array.isArray(data) ? data : (data.data || data.documents || []);
    if (options.clear) {
      // Clear existing
      const parts = this._listPartFiles();
      for (const p of parts) {
        try { fs.unlinkSync(path.join(this.collectionPath, p)); } catch (_) {}
      }
      this._createEmptyIndex();
      this._saveIndexSync();
    }
    this.insertMany(docs);
    this.emit('import', { collection: this.name, count: docs.length });
    this.db?.emit('import', { collection: this.name, count: docs.length });
    return true;
  } catch (err) {
    this._emitError(err);
    return false;
  }
};

CollectionProto.importAsync = function (filePath, options = {}) {
  return this._withLock(() => Promise.resolve(this.import(filePath, options)));
};


module.exports = {
  JSONDB,
  Collection,
  QueryBuilder,
  Transaction
};
