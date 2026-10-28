'use strict';

const fs = require('fs');
const path = require('path');
const { JSONDB } = require('../db');

const DB_PATH = path.join(__dirname, 'project-test-db');

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

console.log('\n=== Project API Tests ===\n');

clean();
const db = new JSONDB(DB_PATH);
const col = db.collection({ name: 'users', autoId: true });

col.insert({ name: 'Alice', email: 'alice@test.com', age: 25, password: 'secret', role: 'admin' });
col.insert({ name: 'Bob', email: 'bob@test.com', age: 30, password: 'secret2', role: 'user' });

// Inclusion
const incl = col.find({}).project({ name: 1, email: 1 }).toArray();
assert(incl.length === 2, 'inclusion returns 2 docs');
assert(incl[0].name === 'Alice' && incl[0].email === 'alice@test.com', 'inclusion keeps name & email');
assert(incl[0]._id !== undefined, 'inclusion keeps _id by default');
assert(incl[0].password === undefined, 'inclusion drops password');
assert(incl[0].age === undefined, 'inclusion drops age');

// Exclusion
const excl = col.find({}).project({ password: 0, role: 0 }).toArray();
assert(excl.length === 2, 'exclusion returns 2 docs');
assert(excl[0].password === undefined, 'exclusion removes password');
assert(excl[0].role === undefined, 'exclusion removes role');
assert(excl[0].name === 'Alice', 'exclusion keeps name');
assert(excl[0]._id !== undefined, 'exclusion keeps _id by default');

// Exclude _id
const noId = col.find({}).project({ name: 1, _id: 0 }).toArray();
assert(noId[0]._id === undefined, 'can exclude _id');
assert(noId[0].name === 'Alice', 'still has name');

// Mixed (exclusion wins)
const mixed = col.find({}).project({ name: 1, password: 0, age: 1 }).toArray();
assert(mixed[0].name === 'Alice', 'mixed keeps name');
assert(mixed[0].age === 25, 'mixed keeps age');
assert(mixed[0].password === undefined, 'mixed exclusion wins for password');

console.log('\nAll project tests passed!\n');
clean();
