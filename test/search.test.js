'use strict';

const fs = require('fs');
const path = require('path');
const { JSONDB } = require('../db');

const DB_PATH = path.join(__dirname, 'search-test-db');

function clean() {
  if (fs.existsSync(DB_PATH)) {
    fs.rmSync(DB_PATH, { recursive: true, force: true });
  }
}

function assert(condition, message) {
  if (!condition) {
    console.error('FAIL:', message);
    process.exit(1);
  }
  console.log('  ✓', message);
}

console.log('\n=== Search API Tests ===\n');

clean();
const db = new JSONDB(DB_PATH);
const col = db.collection({ name: 'users', autoId: true });

col.insert({ name: 'Alice Johnson', email: 'alice@example.com', bio: 'Loves coding' });
col.insert({ name: 'Bob Smith', email: 'bob@test.com', bio: 'Frontend developer' });
col.insert({ name: 'Charlie Brown', email: 'charlie@example.com', bio: 'Backend engineer' });

// Basic search
const r1 = col.search({ keyword: 'alice' }).toArray();
assert(r1.length === 1 && r1[0].name.includes('Alice'), 'finds alice (case-insensitive)');

// Case insensitive
const r2 = col.search({ keyword: 'SMITH' }).toArray();
assert(r2.length === 1 && r2[0].name.includes('Bob'), 'case-insensitive by default');

// Specific fields
const r3 = col.search({ keyword: 'example.com', fields: ['email'] }).toArray();
assert(r3.length === 2, 'search only in email field');

// Exclude fields
const r4 = col.search({ keyword: 'developer', exclude: ['bio'] }).toArray();
assert(r4.length === 0, 'exclude prevents matching on bio');

// With limit + project
const r5 = col.search({ keyword: 'e' })
  .limit(2)
  .project({ name: 1 })
  .toArray();
assert(r5.length === 2, 'limit works with search');
assert(r5[0].email === undefined, 'project works with search');

// count
const cnt = col.search({ keyword: 'example.com', fields: ['email'] }).count();
assert(cnt === 2, 'count works with search');

console.log('\nAll search tests passed!\n');
clean();
