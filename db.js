/**
 * file-json-db
 * A resilient, zero-dependency, MongoDB-style JSON document database for Node.js.
 * v1.1.0 - Improved $pull, updateFunc, safer atomic writes, better resilience
 *
 * - Collection = Folder
 * - Data split into multiple part files
 * - Smart index kept in memory
 * - Automatic recovery & self-healing
 * - Same familiar API style as low-json-db
 */

'use strict';

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');
const crypto = require('crypto');

const DEFAULT_MAX_PART_SIZE = 128 * 1024; // 128 KB

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
        const start = Date.now();
        while (Date.now() - start < 5) {}
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

  count() {
    return this.toArray().length;
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

    this.collectionPath = path.join(dbPath, this.name);
    this.indexPath = path.join(this.collectionPath, 'index.json');

    this.index = null; // loaded index
    this._locked = false;
    this._queue = [];

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
      indexes: {}
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
      const newIndex = {
        nextId: 1,
        parts: {},
        indexes: {}
      };

      let maxId = 0;

      for (const partName of parts) {
        const docs = this._loadPartSync(partName);
        if (!docs) continue;

        const partKey = partName.replace('part-', '').replace('.json', '');
        let size = 0;
        try {
          size = fs.statSync(path.join(this.collectionPath, partName)).size;
        } catch (_) {}

        newIndex.parts[partKey] = { count: docs.length, size };

        for (const doc of docs) {
          const id = getNestedValue(doc, this.idField);
          if (typeof id === 'number' && id > maxId) maxId = id;

          // Secondary indexes
          for (const field of this.indexFields) {
            const val = getNestedValue(doc, field);
            if (val === undefined || val === null) continue;
            const key = String(val);
            if (!newIndex.indexes[field]) newIndex.indexes[field] = {};
            newIndex.indexes[field][key] = { id, part: partKey };
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

    try {
      if (!fs.existsSync(filePath)) return null;
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? parsed : null;
    } catch (err) {
      this._emitError(new Error(`Failed to load part ${partKey}: ${err.message}`));
      return null;
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
      if (meta.size < this.maxPartSize) return partKey;
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
    ensureDirSync(this.collectionPath)
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

    // Update secondary indexes
    const id = getNestedValue(document, this.idField);
    for (const field of this.indexFields) {
      const val = getNestedValue(document, field);
      if (val === undefined || val === null) continue;
      if (!this.index.indexes[field]) this.index.indexes[field] = {};
      this.index.indexes[field][String(val)] = { id, part: partKey };
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

  insertMany(docs) {
    if (!Array.isArray(docs)) return [];
    return docs.map(d => this.insert(d)).filter(Boolean);
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

  _executeQuery(builder) {
    const results = [];
    const query = builder.query || {};
    ensureDirSync(this.collectionPath)

    // Try fast path if query uses an indexed field
    const indexedField = this.indexFields.find(f => query[f] !== undefined && typeof query[f] !== 'object');

    if (indexedField) {
      const val = String(query[indexedField]);
      const entry = this.index.indexes[indexedField] && this.index.indexes[indexedField][val];
      if (entry) {
        const docs = this._loadPartSync(entry.part);
        if (docs) {
          const doc = docs.find(d => getNestedValue(d, this.idField) === entry.id);
          if (doc && matchQuery(doc, query)) {
            results.push(doc);
          } else {
            // Index points to missing document → rebuild
            this._rebuildIndexSync();
            return this._fullScan(builder);
          }
        } else {
          // Part missing → rebuild
          this._rebuildIndexSync();
          return this._fullScan(builder);
        }
      }
      // If not found in index, fall through to full scan (or return empty if exact match expected)
    }

    // Full scan for non-indexed or complex queries
    return this._fullScan(builder);
  }

  _fullScan(builder) {
    const results = [];
    const parts = this._listPartFiles();

    for (const partName of parts) {
      const docs = this._loadPartSync(partName);
      if (!docs) continue;

      for (const doc of docs) {
        if (matchQuery(doc, builder.query)) {
          results.push(doc);
        }
      }
    }

    // Sort
    if (builder._sort) {
      const sortKeys = Object.entries(builder._sort);
      results.sort((a, b) => {
        for (const [key, dir] of sortKeys) {
          const va = getNestedValue(a, key);
          const vb = getNestedValue(b, key);
          if (va < vb) return dir === -1 || dir === 'desc' ? 1 : -1;
          if (va > vb) return dir === -1 || dir === 'desc' ? -1 : 1;
        }
        return 0;
      });
    }

    // Skip + Limit
    let final = results;
    if (builder._skip) final = final.slice(builder._skip);
    if (builder._limit != null) final = final.slice(0, builder._limit);

    // Project
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
            if (current[keys[i]] == null) return;
            current = current[keys[i]];
          }
          delete current[keys[keys.length - 1]];
        }
      }
    }
  }

  _updateIndexesForDoc(oldDoc, newDoc, partKey) {
    const id = getNestedValue(newDoc, this.idField);

    for (const field of this.indexFields) {
      const oldVal = getNestedValue(oldDoc, field);
      const newVal = getNestedValue(newDoc, field);

      if (String(oldVal) !== String(newVal)) {
        if (oldVal != null && this.index.indexes[field]) {
          delete this.index.indexes[field][String(oldVal)];
        }
        if (newVal != null) {
          if (!this.index.indexes[field]) this.index.indexes[field] = {};
          this.index.indexes[field][String(newVal)] = { id, part: partKey };
        }
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
      let docs = this._loadPartSync(partKey);
      if (!docs) continue;

      const remaining = [];
      let modified = false;

      for (const doc of docs) {
        if (!found && matchQuery(doc, filter)) {
          deleted.push(doc);
          modified = true;
          found = true;

          // Remove from indexes
          const id = getNestedValue(doc, this.idField);
          for (const field of this.indexFields) {
            const val = getNestedValue(doc, field);
            if (val != null && this.index.indexes[field]) {
              delete this.index.indexes[field][String(val)];
            }
          }

          if (onlyOne) {
            // keep the rest
            continue;
          }
        } else {
          remaining.push(doc);
        }
      }

      if (modified) {
        this._savePartSync(partKey, onlyOne ? [...remaining, ...docs.filter(d => !deleted.includes(d))] : remaining);
        // simpler rewrite
        this._savePartSync(partKey, remaining);
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

  backup(backupRoot = './backups') {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(backupRoot, `backup-${timestamp}`);
      ensureDirSync(backupPath);

      const copyRecursive = (src, dest) => {
        ensureDirSync(dest);
        for (const item of fs.readdirSync(src)) {
          const srcPath = path.join(src, item);
          const destPath = path.join(dest, item);
          if (fs.statSync(srcPath).isDirectory()) {
            copyRecursive(srcPath, destPath);
          } else {
            fs.copyFileSync(srcPath, destPath);
          }
        }
      };

      copyRecursive(this.dbPath, backupPath);
      this.emit('backup', { path: backupPath });
      return backupPath;
    } catch (err) {
      this.emit('error', err);
      return null;
    }
  }

  async backupAsync(backupRoot = './backups') {
    return this.backup(backupRoot);
  }
}

// ====================== EXPORTS ======================


// ====================== TRANSACTION ======================

class Transaction {
  constructor(collection) {
    this.collection = collection;
    this.operations = [];
    this.snapshot = null;
    this.active = true;
  }

  _ensureActive() {
    if (!this.active) {
      throw new Error('Transaction is no longer active');
    }
  }

  insert(doc) {
    this._ensureActive();
    this.operations.push({ type: 'insert', doc: { ...doc } });
    return doc;
  }

  insertAsync(doc) {
    return Promise.resolve(this.insert(doc));
  }

  insertMany(docs) {
    this._ensureActive();
    const result = [];
    for (const d of docs) {
      result.push(this.insert(d));
    }
    return result;
  }

  insertManyAsync(docs) {
    return Promise.resolve(this.insertMany(docs));
  }

  updateOne(filter, update) {
    this._ensureActive();
    this.operations.push({ type: 'updateOne', filter, update });
    return null;
  }

  updateOneAsync(filter, update) {
    return Promise.resolve(this.updateOne(filter, update));
  }

  updateMany(filter, update) {
    this._ensureActive();
    this.operations.push({ type: 'updateMany', filter, update });
    return [];
  }

  updateManyAsync(filter, update) {
    return Promise.resolve(this.updateMany(filter, update));
  }

  deleteOne(filter) {
    this._ensureActive();
    this.operations.push({ type: 'deleteOne', filter });
    return null;
  }

  deleteOneAsync(filter) {
    return Promise.resolve(this.deleteOne(filter));
  }

  deleteMany(filter) {
    this._ensureActive();
    this.operations.push({ type: 'deleteMany', filter });
    return [];
  }

  deleteManyAsync(filter) {
    return Promise.resolve(this.deleteMany(filter));
  }

  async commit() {
    this._ensureActive();
    try {
      for (const op of this.operations) {
        switch (op.type) {
          case 'insert':
            this.collection.insert(op.doc);
            break;
          case 'updateOne':
            this.collection.updateOne(op.filter, op.update);
            break;
          case 'updateMany':
            this.collection.updateMany(op.filter, op.update);
            break;
          case 'deleteOne':
            this.collection.deleteOne(op.filter);
            break;
          case 'deleteMany':
            this.collection.deleteMany(op.filter);
            break;
        }
      }
      this.active = false;
      this.collection.emit('transactionCommit', { collection: this.collection.name });
      this.collection.db?.emit('transactionCommit', { collection: this.collection.name });
      return true;
    } catch (err) {
      this.collection._emitError(err);
      return false;
    }
  }

  async rollback() {
    this._ensureActive();
    this.operations = [];
    this.active = false;
    this.collection.emit('transactionRollback', { collection: this.collection.name });
    this.collection.db?.emit('transactionRollback', { collection: this.collection.name });
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
