'use strict';

/**
 * file-json-db comprehensive test suite
 * Covers: CRUD, indexes, insertMany batching, transactions (commit/rollback/errors),
 * durability (crash recovery), corrupted parts, backup, performance.
 */

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { JSONDB } = require('../db');

const ROOT = path.join(__dirname, 'comprehensive-db');
const BACKUP = path.join(__dirname, 'comprehensive-backup');

let passed = 0;
let failed = 0;
const results = [];

function clean(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function assert(name, cond, detail = '') {
  if (cond) {
    passed++;
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    results.push({ name, ok: false, detail });
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function section(title) {
  console.log(`\n═══ ${title} ═══`);
}

function ms(start) {
  return (performance.now() - start).toFixed(2) + ' ms';
}

// ─────────────────────────────────────────────────────────────
async function run() {
  clean(ROOT);
  clean(BACKUP);

  // ── 1. Basic CRUD ──────────────────────────────────────────
  section('1. Basic CRUD');
  {
    const db = new JSONDB(ROOT);
    const col = db.collection({ name: 'crud', autoId: true, indexes: ['email'] });

    const a = col.insert({ name: 'Alice', email: 'a@x.com', age: 30 });
    const b = col.insert({ name: 'Bob', email: 'b@x.com', age: 25 });
    assert('insert returns doc with _id', a && a._id != null && b && b._id != null);
    assert('find all count', col.find({}).count() === 2);
    assert('findOne by name', col.findOne({ name: 'Alice' })?.email === 'a@x.com');
    assert('find by index field', col.find({ email: 'b@x.com' }).toArray().length === 1);
    assert('find by primary id', col.findOne({ _id: a._id })?.name === 'Alice');

    col.updateOne({ name: 'Alice' }, { $set: { age: 31 }, $inc: { visits: 1 } });
    assert('updateOne $set+$inc', col.findOne({ name: 'Alice' })?.age === 31);

    const del = col.deleteOne({ name: 'Bob' });
    assert('deleteOne', del?.name === 'Bob' && col.find({}).count() === 1);

    col.deleteMany({});
    assert('deleteMany all', col.find({}).count() === 0);
  }

  // ── 2. insertMany batching ─────────────────────────────────
  section('2. insertMany batching (maxRecords / maxPartSize)');
  {
    clean(ROOT);
    const db = new JSONDB(ROOT);
    const col = db.collection({
      name: 'batch',
      autoId: true,
      maxRecords: 10,
      indexes: ['g']
    });

    const docs = [];
    for (let i = 0; i < 35; i++) docs.push({ n: i, g: i % 3 });
    const t0 = performance.now();
    const out = col.insertMany(docs);
    const elapsed = ms(t0);

    assert('insertMany returns 35', out.length === 35);
    assert('total count 35', col.find({}).count() === 35);

    const partCounts = Object.values(col.index.parts).map(p => p.count);
    assert(
      'parts split by maxRecords=10',
      partCounts.length === 4 && partCounts.every((c, i) => (i < 3 ? c === 10 : c === 5)),
      `parts=${JSON.stringify(partCounts)}`
    );
    assert('multi-value index g=0 has multiple', (col.index.indexes.g?.['0'] || []).length >= 10);
    console.log(`    insertMany 35 docs: ${elapsed}`);
  }

  // ── 3. Snapshot transactions ───────────────────────────────
  section('3. Snapshot transactions');
  {
    clean(ROOT);
    const db = new JSONDB(ROOT);
    db.on('error', () => {});
    const col = db.collection({ name: 'tx', autoId: true, indexes: ['role'] });

    col.insertMany([
      { name: 'u0', role: 'admin' },
      { name: 'u1', role: 'user' },
      { name: 'u2', role: 'admin' }
    ]);
    const before = col.find({}).count();

    // 3a commit
    const tx = col.startTransaction();
    tx.insert({ name: 'tx-new', role: 'user' });
    tx.updateMany({ role: 'admin' }, { $set: { flagged: true } });
    tx.deleteOne({ name: 'u1' });
    assert('before commit disk unchanged', col.find({}).count() === before);
    const ok = await tx.commit();
    assert('commit returns true', ok === true);
    assert('after commit count', col.find({}).count() === before); // -1 +1
    assert('u1 deleted', col.findOne({ name: 'u1' }) === null);
    assert('tx-new present', col.findOne({ name: 'tx-new' }) != null);
    assert(
      'admins flagged',
      col.find({ flagged: true }).toArray().every(d => d.role === 'admin')
    );

    // 3b rollback
    const countBeforeRollback = col.find({}).count();
    const tx2 = col.startTransaction();
    tx2.deleteMany({});
    tx2.insert({ name: 'ghost' });
    assert('during tx disk still intact', col.find({}).count() === countBeforeRollback);
    await tx2.rollback();
    assert('after rollback count same', col.find({}).count() === countBeforeRollback);
    assert('ghost not persisted', col.findOne({ name: 'ghost' }) === null);

    // 3c only one active tx
    const tx3 = col.startTransaction();
    let blocked = false;
    try {
      col.startTransaction();
    } catch (_) {
      blocked = true;
    }
    assert('second concurrent tx blocked', blocked);
    await tx3.rollback();

    // 3d commit after simulated mid-tx error (ops already applied in overlay only)
    const tx4 = col.startTransaction();
    tx4.insert({ name: 'safe' });
    // Simulate application error before commit — then rollback
    try {
      throw new Error('app logic failed');
    } catch (_) {
      await tx4.rollback();
    }
    assert('error path + rollback leaves disk clean', col.findOne({ name: 'safe' }) === null);

    // 3e double commit / double rollback
    const tx5 = col.startTransaction();
    tx5.insert({ name: 'once' });
    await tx5.commit();
    let secondCommitThrows = false;
    try {
      await tx5.commit();
    } catch (_) {
      secondCommitThrows = true;
    }
    assert('second commit on inactive tx throws', secondCommitThrows);
  }

  // ── 4. Corrupted part durability ───────────────────────────
  section('4. Corrupted part recovery (copy-once)');
  {
    clean(ROOT);
    const db = new JSONDB(ROOT);
    db.on('error', () => {});
    const col = db.collection({ name: 'corrupt', autoId: true, errorLevel: 'debug' });
    col.on('error', () => {});

    col.insert({ name: 'keep-me' });
    const partPath = path.join(ROOT, 'corrupt', 'part-0001.json');
    // Corrupt the file
    fs.writeFileSync(partPath, '{ not valid json!!!');

    const docs1 = col.find({}).toArray();
    assert('corrupt load returns empty (no crash)', Array.isArray(docs1));

    const crashDir = path.join(ROOT, 'corrupt', 'crash');
    const crashes1 = fs.existsSync(crashDir) ? fs.readdirSync(crashDir) : [];
    assert('crash copy created once', crashes1.length === 1 && crashes1[0] === 'part-0001.json');

    // Load again — must not create another crash file
    col.find({}).toArray();
    const crashes2 = fs.readdirSync(crashDir);
    assert('no duplicate crash copies', crashes2.length === 1);

    // Original still on disk
    assert('original corrupt part still exists', fs.existsSync(partPath));
    assert('corruptedParts marked in index', !!col.index.corruptedParts?.['0001']);
  }

  // ── 5. Empty-part cleanup ──────────────────────────────────
  section('5. Empty-part cleanup after delete');
  {
    clean(ROOT);
    const db = new JSONDB(ROOT);
    const col = db.collection({ name: 'empty', autoId: true, maxRecords: 3 });
    col.insertMany([{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }]);
    const partsBefore = Object.keys(col.index.parts).length;
    assert('multiple parts exist', partsBefore >= 2);

    col.deleteMany({});
    assert('all docs gone', col.find({}).count() === 0);
    assert('no parts left in index', Object.keys(col.index.parts).length === 0);
    const files = fs.readdirSync(path.join(ROOT, 'empty')).filter(f => f.startsWith('part-'));
    assert('no part files on disk', files.length === 0);
  }

  // ── 6. Backup ──────────────────────────────────────────────
  section('6. Backup layout');
  {
    clean(ROOT);
    clean(BACKUP);
    const db = new JSONDB(ROOT);
    const col = db.collection({ name: 'bak', autoId: true });
    col.insertMany([{ x: 1 }, { x: 2 }]);

    const dest = db.backup(BACKUP);
    assert('backup returns path', dest === BACKUP);
    assert(
      'layout backup/bak/part-*.json',
      fs.existsSync(path.join(BACKUP, 'bak')) &&
        fs.readdirSync(path.join(BACKUP, 'bak')).some(f => f.startsWith('part-'))
    );
    assert(
      'no index.json in backup',
      !fs.existsSync(path.join(BACKUP, 'bak', 'index.json'))
    );

    clean(BACKUP);
    db.backup(BACKUP, { pack: true });
    assert(
      'packed backup has bak/bak.json',
      fs.existsSync(path.join(BACKUP, 'bak', 'bak.json'))
    );
  }

  // ── 7. Index rebuild ───────────────────────────────────────
  section('7. Index rebuild');
  {
    clean(ROOT);
    const db = new JSONDB(ROOT);
    const col = db.collection({ name: 'rebuild', autoId: true, indexes: ['tag'] });
    col.insertMany([
      { tag: 'a' },
      { tag: 'a' },
      { tag: 'b' }
    ]);
    // Corrupt in-memory index intentionally
    col.index.idIndex = {};
    col.index.indexes = {};
    col.rebuildIndexes();
    assert('rebuild restores idIndex', Object.keys(col.index.idIndex).length === 3);
    assert(
      'rebuild multi-value tag=a',
      (col.index.indexes.tag?.a || []).length === 2
    );
  }

  // ── 8. Durability: process restart simulation ──────────────
  section('8. Durability (reload collection from disk)');
  {
    clean(ROOT);
    const db1 = new JSONDB(ROOT);
    const c1 = db1.collection({ name: 'persist', autoId: true, indexes: ['k'] });
    c1.insertMany([{ k: 'x', v: 1 }, { k: 'y', v: 2 }]);
    const id = c1.findOne({ k: 'x' })._id;

    // New process / new JSONDB instance
    const db2 = new JSONDB(ROOT);
    const c2 = db2.collection({ name: 'persist', autoId: true, indexes: ['k'] });
    assert('data survives reopen', c2.find({}).count() === 2);
    assert('id lookup after reopen', c2.findOne({ _id: id })?.k === 'x');
    assert('secondary index after reopen', c2.find({ k: 'y' }).toArray().length === 1);
  }

  // ── 9. Performance ─────────────────────────────────────────
  section('9. Performance');
  {
    clean(ROOT);
    const db = new JSONDB(ROOT);
    const col = db.collection({
      name: 'perf',
      autoId: true,
      indexes: ['group'],
      maxRecords: 500,
      pretty: false
    });

    const N = 2000;
    const bulk = [];
    for (let i = 0; i < N; i++) {
      bulk.push({ i, group: 'g' + (i % 20), score: Math.random() * 100 });
    }

    let t = performance.now();
    col.insertMany(bulk);
    const insertMs = performance.now() - t;
    console.log(`    insertMany ${N}: ${insertMs.toFixed(2)} ms (${(N / (insertMs / 1000)).toFixed(0)} docs/s)`);
    assert(`insertMany ${N} under 15s`, insertMs < 15000, `${insertMs.toFixed(0)}ms`);

    t = performance.now();
    const cnt = col.find({}).count();
    const countMs = performance.now() - t;
    assert('fast count empty-query', cnt === N && countMs < 50, `${countMs.toFixed(2)}ms`);
    console.log(`    count(): ${countMs.toFixed(2)} ms`);

    t = performance.now();
    const byId = col.findOne({ _id: 1 });
    const idMs = performance.now() - t;
    assert('id lookup fast', byId != null && idMs < 200, `${idMs.toFixed(2)}ms`);
    console.log(`    findOne by _id: ${idMs.toFixed(2)} ms`);

    t = performance.now();
    const byIdx = col.find({ group: 'g5' }).toArray();
    const idxMs = performance.now() - t;
    assert('secondary index find', byIdx.length === N / 20 && idxMs < 200, `${idxMs.toFixed(2)}ms n=${byIdx.length}`);
    console.log(`    find by indexed field: ${idxMs.toFixed(2)} ms (${byIdx.length} docs)`);

    t = performance.now();
    col.updateMany({ group: 'g0' }, { $inc: { score: 1 } });
    const updMs = performance.now() - t;
    console.log(`    updateMany ~${N / 20} docs: ${updMs.toFixed(2)} ms`);
    assert('updateMany completes', updMs < 5000);

    t = performance.now();
    col.deleteMany({ group: 'g1' });
    const delMs = performance.now() - t;
    console.log(`    deleteMany ~${N / 20} docs: ${delMs.toFixed(2)} ms`);
    assert('deleteMany completes', delMs < 5000);
    assert('count after delete', col.find({}).count() === N - N / 20);
  }

  // ── 10. Transaction + durability stress ────────────────────
  section('10. Transaction commit durability');
  {
    clean(ROOT);
    const db = new JSONDB(ROOT);
    const col = db.collection({ name: 'txdur', autoId: true });

    const tx = col.startTransaction();
    for (let i = 0; i < 50; i++) tx.insert({ n: i });
    await tx.commit();

    // Reopen
    const db2 = new JSONDB(ROOT);
    const col2 = db2.collection({ name: 'txdur', autoId: true });
    assert('tx commit durable after reopen', col2.find({}).count() === 50);
  }

  // ── cleanup ────────────────────────────────────────────────
  clean(ROOT);
  clean(BACKUP);

  // ── summary ────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log('══════════════════════════════════════\n');

  if (failed > 0) {
    console.log('Failed tests:');
    results.filter(r => !r.ok).forEach(r => console.log(`  - ${r.name}: ${r.detail || ''}`));
    process.exit(1);
  }
  process.exit(0);
}

run().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
