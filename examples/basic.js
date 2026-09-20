const { JSONDB } = require('../db');
const path = require('path');

const db = new JSONDB(path.join(__dirname, '../data'));

// Listen to events
db.on('error', (err) => {
  console.error('[ERROR]', err.message);
});

db.on('index-rebuilt', (info) => {
  console.log('[INFO] Index rebuilt for:', info.collection)                                    
});

db.on('insert', (info) => {
  console.log('[INSERT]', info.document._id);
});

const users = db.collection({
  name: 'users',
  autoId: true,
  indexes: ['email', 'name'],
  maxPartSize: 50 * 1024 // smaller for demo
});

console.log('=== Inserting users ===');
for (let index = 0; index < 1000; index++) {
  users.insert({ name: 'Alice'+index, email: 'alice@'+index+'example.com', age: index+10 });
  users.insert({ name: 'Bob'+index, email: 'bob'+index+'@example.com', age: 32 });
  users.insert({ name: 'Charlie'+index, email: 'char'+index+'lie@example.com', age: 25 });
  
}

console.log('\n=== Find by indexed field (email) ===');
console.log(users.findOne({ email: 'bob@example.com' }));

console.log('\n=== Find by non-indexed field (age) ===');
console.log(users.find({ age: { $gte: 28 } }).toArray());

console.log('\n=== Update ===');
users.updateOne(
  { email: 'alice@example.com' },
  { $set: { age: 29 }, $push: { tags: 'admin' } }
);
console.log(users.findOne({ email: 'alice@example.com' }));

console.log('\n=== List collections ===');
console.log(db.listCollections());

console.log('\nDone.');
