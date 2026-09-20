const { JSONDB } = require('../db');
const path = require('path');
const fs = require('fs');

const testDir = path.join(__dirname, 'test-data');

// Clean previous test data
if (fs.existsSync(testDir)) {
  fs.rmSync(testDir, { recursive: true, force: true });
}

const db = new JSONDB(testDir);

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log('  ✓', message);
    passed++;
  } else {
    console.log('  ✗', message);
    failed++;
  }
}

console.log('Running basic tests...\n');

const users = db.collection({
  name: 'users',
  autoId: true,
  indexes: ['email']
});

// Insert
const u1 = users.insert({ name: 'Alice', email: 'alice@test.com', age: 25 });
assert(u1 && u1._id === 1, 'Insert returns document with auto id 1');

const u2 = users.insert({ name: 'Bob', email: 'bob@test.com', age: 30 });
assert(u2 && u2._id === 2, 'Insert returns document with auto id 2');

// Find by index
const found = users.findOne({ email: 'alice@test.com' });
assert(found && found.name === 'Alice', 'Find by indexed field works');

// Find by non-indexed
const byAge = users.find({ age: { $gte: 26 } }).toArray();
assert(byAge.length === 1 && byAge[0].name === 'Bob', 'Find by non-indexed field works');

// Update
users.updateOne({ email: 'alice@test.com' }, { $set: { age: 26 } });
const updated = users.findOne({ email: 'alice@test.com' });
assert(updated.age === 26, 'Update works');

// Delete
users.deleteOne({ email: 'bob@test.com' });
const afterDelete = users.findOne({ email: 'bob@test.com' });
assert(afterDelete === null, 'Delete works');

// Collection folder exists
const colPath = path.join(testDir, 'users');
assert(fs.existsSync(colPath), 'Collection folder created');
assert(fs.existsSync(path.join(colPath, 'index.json')), 'Index file exists');

console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed > 0) process.exit(1);
console.log('All tests passed!');
