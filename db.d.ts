import { EventEmitter } from 'events';

/**
 * Options when creating a collection.
 */
export interface CollectionOptions {
  /** Collection name (required) */
  name: string;
  /** Automatically generate an ID when missing (default: false) */
  autoId?: boolean;
  /** Field used as the document ID (default: "_id") */
  idField?: string;
  /** ID generation strategy: "auto" | "uuid" | "objectid" (default: "auto") */
  idType?: 'auto' | 'uuid' | 'objectid';
  /** Fields that should have secondary indexes */
  indexes?: string[];
  /** Pretty-print JSON files (default: true) */
  pretty?: boolean;
  /** Target maximum size of a part file in bytes (default: 256 KB) */
  maxPartSize?: number;
  /** Maximum number of records per part file (default: null = unlimited) */
  maxRecords?: number | null;
  /** How to handle corrupted part files: "debug" | "ignore" (default: "debug") */
  errorLevel?: 'debug' | 'ignore';
  /**
   * When true, always keep a full id → part map in the index.
   * When false (default) and idType is "auto", a more compact range-based
   * structure is preferred to save memory.
   */
  keepIdIndex?: boolean;
}

export interface ImportOptions {
  /** Clear existing data before import (default: false) */
  clear?: boolean;
}

/**
 * Options for the collection.search() method.
 */
export interface SearchOptions {
  /** The keyword / term to search for */
  keyword: string;
  /** Fields to search in. If omitted or null, all fields are searched */
  fields?: string[] | null;
  /** Fields to exclude from the search */
  exclude?: string[];
  /** Perform case-insensitive search (default: true) */
  caseInsensitive?: boolean;
}

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
export declare class JSONDB extends EventEmitter {
  constructor(dbPath?: string);

  /** Get or create a collection */
  collection(nameOrOptions: string | CollectionOptions): Collection;
  /** Alias of collection() */
  createCollection(nameOrOptions: string | CollectionOptions): Collection;
  /** List all collection names */
  listCollections(): string[];
  /** Permanently delete a collection and its files */
  dropCollection(name: string): boolean;
  /** Unload a collection from memory (files stay on disk) */
  unloadCollection(name: string): boolean;
  /** Create a backup of the whole database */
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
  backup(backupRoot?: string): string | null;
  backupAsync(backupRoot?: string): Promise<string | null>;

  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'save' | 'insert' | 'update' | 'delete' | 'import' | 'backup' | 'unload' | 'index-rebuilt' | 'transactionCommit' | 'transactionRollback', listener: (info: any) => void): this;
  on(event: string, listener: (...args: any[]) => void): this;
}

/**
 * A collection of documents. Maps to a folder containing part-*.json files + index.json.
 */
export declare class Collection extends EventEmitter {
  readonly name: string;
  readonly autoId: boolean;
  readonly idField: string;
  readonly idType: string;
  readonly indexFields: string[];
  readonly pretty: boolean;
  readonly maxPartSize: number;
  readonly keepIdIndex: boolean;

  // ----- Insert -----
  insert(document: object): object | null;
  insertAsync(document: object): Promise<object | null>;
  /**
   * Batched insertMany:
   * - Assigns IDs once
   * - Splits docs by maxRecords (if set) else by estimated JSON size vs maxPartSize
   * - Fills existing parts that still have room, then creates new parts
   * - Writes each part once and saves the index once at the end
   */
  insertMany(documents: object[]): object[];
  insertManyAsync(documents: object[]): Promise<object[]>;

  // ----- Find -----
  /** Create a query builder (chain .limit().sort().project().toArray()) */
  find(query?: object): QueryBuilder;
  findOne(query?: object): object | null;
  findAsync(query?: object): Promise<QueryBuilder>;
  findOneAsync(query?: object): Promise<object | null>;

  /**
   * Simple keyword search across the collection.
   * Returns a QueryBuilder so you can still chain limit / sort / project / toArray.
   *
   * @example
   * users.search({ keyword: "john", fields: ["name", "email"] })
   *   .limit(10)
   *   .project({ name: 1 })
   *   .toArray();
   */
  search(options: SearchOptions): QueryBuilder;
  searchAsync(options: SearchOptions): Promise<QueryBuilder>;

  // ----- Update -----
  updateOne(filter: object, update: object): object | null;
  updateOneAsync(filter: object, update: object): Promise<object | null>;
  updateMany(filter: object, update: object): object[];
  updateManyAsync(filter: object, update: object): Promise<object[]>;

  // ----- Delete -----
  deleteOne(filter: object): object | null;
  deleteOneAsync(filter: object): Promise<object | null>;
  deleteMany(filter: object): object[];
  deleteManyAsync(filter: object): Promise<object[]>;

  // ----- Advanced -----
  /**
   * updateFunc - Find documents by filter, pass each to a user function,
   * and save whatever the function returns.
   *
   * @param {object} filter
   * @param {function} fn - (doc) => newDoc
   * @param {object} [options] - { multi: true/false }
   */
  updateFunc(filter: object, fn: (doc: object) => object, options?: { multi?: boolean }): object | object[] | null;
  updateFuncAsync(filter: object, fn: (doc: object) => object, options?: { multi?: boolean }): Promise<object | object[] | null>;

  startTransaction(): Transaction;
  aggregate(pipeline?: object[]): object[];
  import(filePath: string, options?: ImportOptions): boolean;
  importAsync(filePath: string, options?: ImportOptions): Promise<boolean>;

  rebuildIndexes(): void;
  rebuildId(): number;

  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'save' | 'insert' | 'update' | 'delete' | 'import' | 'index-rebuilt' | 'transactionCommit' | 'transactionRollback', listener: (info: any) => void): this;
  on(event: string, listener: (...args: any[]) => void): this;
}

/**
 * Fluent query builder returned by find() and search().
 */
export declare class QueryBuilder {
  /** Limit the number of results */
  limit(n: number): this;
  /** Skip the first N results */
  skip(n: number): this;
  /** Sort results. Example: { age: -1, name: 1 } */
  sort(obj: object): this;
  /**
   * Project (select / hide) fields.
   * - Inclusion: { name: 1, email: 1 }
   * - Exclusion: { password: 0 }
   * - Mixed is allowed; exclusion wins.
   * - _id is kept by default unless {_id: 0}
   */
  project(obj: object): this;
  /** Execute the query and return an array of documents */
  toArray(): object[];
  /** Return only the first matching document (or null) */
  first(): object | null;
  /** Count matching documents (efficient when possible) */
  count(): number;
}

/**
 * Snapshot transaction. Changes are held in memory until commit() or rollback().
 */
export declare class Transaction {
  insert(doc: object): object | null;
  insertAsync(doc: object): Promise<object | null>;
  insertMany(docs: object[]): object[];
  insertManyAsync(docs: object[]): Promise<object[]>;
  updateOne(filter: object, update: object): object | null;
  updateOneAsync(filter: object, update: object): Promise<object | null>;
  updateMany(filter: object, update: object): object[];
  updateManyAsync(filter: object, update: object): Promise<object[]>;
  deleteOne(filter: object): object | null;
  deleteOneAsync(filter: object): Promise<object | null>;
  deleteMany(filter: object): object[];
  deleteManyAsync(filter: object): Promise<object[]>;

  updateFunc(filter: object, fn: (doc: object) => object, options?: { multi?: boolean }): object | object[] | null;
  updateFuncAsync(filter: object, fn: (doc: object) => object, options?: { multi?: boolean }): Promise<object | object[] | null>;
  commit(): Promise<boolean>;
  rollback(): Promise<boolean>;
}

export { JSONDB as default };
