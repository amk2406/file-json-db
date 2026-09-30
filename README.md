# file-json-db – Complete Guide (A to Z)

A resilient, **zero-dependency, MongoDB-style JSON document database for Node.js**.

`file-json-db` stores documents on disk while keeping a smart index in memory. Collections are represented as folders, data is split across multiple part files, and writes use atomic file replacement with retry handling.

This README explains the database from the basics to the more advanced features, with practical examples and simple explanations.

---

## Table of Contents

1. [What is file-json-db?](#1-what-is-file-json-db)
2. [Installation / How to use](#2-installation--how-to-use)
3. [Creating a Database](#3-creating-a-database)
4. [Creating Collections](#4-creating-collections)
5. [Collection Options](#5-collection-options)
6. [Inserting Documents](#6-inserting-documents)
7. [Reading Documents](#7-reading-documents)
8. [Query Operators](#8-query-operators)
9. [Query Builder](#9-query-builder)
10. [Updating Documents](#10-updating-documents)
11. [Update Operators](#11-update-operators)
12. [updateFunc](#12-updatefunc)
13. [Deleting Documents](#13-deleting-documents)
14. [Indexes](#14-indexes)
15. [Index Rebuilding](#15-index-rebuilding)
16. [Transactions](#16-transactions)
17. [Aggregation](#17-aggregation)
18. [Importing Data](#18-importing-data)
19. [Backups](#19-backups)
20. [Events](#20-events)
21. [Error Handling and Recovery](#21-error-handling-and-recovery)
22. [Part Files and Storage](#22-part-files-and-storage)
23. [Real-World Examples](#23-real-world-examples)
24. [Important Notes & Best Practices](#24-important-notes--best-practices)
25. [Quick Reference (Cheat Sheet)](#25-quick-reference-cheat-sheet)
26. [Final Words](#26-final-words)

---

# 1. What is file-json-db?

`file-json-db` is a small document database for Node.js.

Instead of running a separate database server, your application stores its documents directly on the filesystem.

The package describes itself as a:

> resilient, zero-dependency, MongoDB-style JSON document database for Node.js.

The database uses a few important ideas:

- A **database** is a directory.
- A **collection** is a directory inside the database.
- Collection data is split into multiple `part-XXXX.json` files.
- An in-memory index keeps track of parts and configured indexed fields.
- Writes use atomic temporary files and rename operations.
- Asynchronous writes are queued through an internal lock.
- Corrupted part files can be handled without crashing the process.
- The API uses familiar document-database concepts such as filters, update operators, indexes, aggregation, and transactions.

### Key features

- Zero external runtime dependencies
- Node.js support
- JSON document storage
- Multiple part files per collection
- In-memory indexes
- Automatic index rebuilding
- Atomic writes
- Retry handling for file replacement
- Async write queue
- MongoDB-style query operators
- Query builder
- Update operators
- `updateFunc()` / `updateFuncAsync()`
- Transactions
- Aggregation pipeline
- Import
- Backup
- Events
- Configurable part size
- Configurable maximum records per part
- Corrupted-part recovery options

### What it is NOT

`file-json-db` is a file-based embedded database.

It is not a separate database server such as MongoDB or PostgreSQL.

Your application accesses the database directly through Node.js, and the database files live on the filesystem.

---

# 2. Installation / How to use

Install the package with npm:

```bash
npm install file-json-db
```

The package currently targets Node.js `>=14.0.0`.

## CommonJS

```js
const { JSONDB } = require('file-json-db');
```

## Creating a database

```js
const { JSONDB } = require('file-json-db');

const db = new JSONDB('./data');
```

The path is created if it does not already exist.

## Basic project

```text
my-project/
│
├── app.js
├── package.json
│
└── data/
    └── users/
        ├── index.json
        └── part-0001.json
```

The exact number of part files depends on the amount of data and the collection configuration.

---

# 3. Creating a Database

Create a database by constructing `JSONDB`:

```js
const { JSONDB } = require('file-json-db');

const db = new JSONDB('./data');
```

The constructor accepts an optional path:

```js
const db = new JSONDB('./database');
```

If no path is supplied:

```js
const db = new JSONDB();
```

the default database path is:

```text
./database
```

### Database methods

The database object provides:

```js
db.collection()
db.createCollection()
db.listCollections()
db.dropCollection()
db.unloadCollection()
db.backup()
db.backupAsync()
```

---

# 4. Creating Collections

A collection is created with:

```js
const users = db.collection('users');
```

You can also use:

```js
const users = db.createCollection('users');
```

Both return a `Collection`.

## Collection directory

A collection is represented by a directory:

```text
data/
└── users/
    ├── index.json
    ├── part-0001.json
    ├── part-0002.json
    └── ...
```

This is one of the important differences between a simple single-file JSON database and `file-json-db`.

Large collections can be split across multiple part files.

---

# 5. Collection Options

You can create a collection with configuration options:

```js
const users = db.collection({
  name: 'users',
  autoId: true,
  idField: '_id',
  idType: 'auto',
  indexes: ['username', 'email'],
  pretty: true,
  maxPartSize: 256 * 1024,
  maxRecords: 1000,
  errorLevel: 'debug'
});
```

## Options

| Option | Type | Default | Meaning |
|---|---|---|---|
| `name` | string | required | Collection name |
| `autoId` | boolean | `false` | Automatically generate an ID when missing |
| `idField` | string | `_id` | Field used for document IDs |
| `idType` | string | `auto` | ID generation mode |
| `indexes` | array | `[]` | Fields that should have indexes |
| `pretty` | boolean | `true` | Pretty-print JSON files |
| `maxPartSize` | number | `256 KB` | Maximum part-file size target |
| `maxRecords` | number / null | `null` | Maximum records per part |
| `errorLevel` | string | `debug` | Corrupted-part handling mode |

## `autoId`

Enable automatic IDs:

```js
const users = db.collection({
  name: 'users',
  autoId: true
});
```

If a document does not contain `_id`:

```js
users.insert({
  username: 'alice'
});
```

the database generates an ID.

## `idField`

Change the ID field:

```js
const users = db.collection({
  name: 'users',
  autoId: true,
  idField: 'id'
});
```

## `idType`

Supported ID types in the implementation are:

```text
auto
uuid
objectid
```

Example:

```js
const users = db.collection({
  name: 'users',
  autoId: true,
  idType: 'uuid'
});
```

For an ObjectId-style identifier:

```js
const users = db.collection({
  name: 'users',
  autoId: true,
  idType: 'objectid'
});
```

## `pretty`

Pretty JSON:

```js
pretty: true
```

Compact JSON:

```js
pretty: false
```

Compact JSON can reduce the amount of whitespace written to disk.

## `maxPartSize`

The default maximum part size is currently:

```text
256 KB
```

Example:

```js
maxPartSize: 1024 * 1024
```

This sets a 1 MB part-size target.

## `maxRecords`

You can also limit the number of documents in each part:

```js
maxRecords: 1000
```

A new part is created when the current part reaches either the configured size limit or the configured record limit.

## `errorLevel`

There are two supported modes:

```text
debug
ignore
```

### debug

This is the default.

When a part file cannot be parsed, the database attempts to copy the corrupted part into a `crash/` directory and emits an error.

### ignore

```js
errorLevel: 'ignore'
```

Corrupted parts are skipped without the debug crash-file copy and message.

---

# 6. Inserting Documents

## `insert()`

Insert one document:

```js
const user = users.insert({
  username: 'alice',
  email: 'alice@example.com',
  age: 25
});
```

The inserted document is returned.

## `insertAsync()`

The asynchronous version:

```js
const user = await users.insertAsync({
  username: 'alice',
  email: 'alice@example.com',
  age: 25
});
```

Asynchronous writes use the collection's internal write queue.

This means multiple asynchronous writes are serialized through the collection lock.

## `insertMany()`

Insert many documents:

```js
const users = collection.insertMany([
  {
    username: 'alice',
    age: 25
  },
  {
    username: 'bob',
    age: 30
  }
]);
```

## `insertManyAsync()`

The asynchronous version:

```js
const users = await collection.insertManyAsync([
  {
    username: 'alice',
    age: 25
  },
  {
    username: 'bob',
    age: 30
  }
]);
```

### Large insert example

```js
const documents = [];

for (let i = 0; i < 3500; i++) {
  documents.push({
    username: `user_${i}`,
    email: `user_${i}@example.com`,
    age: 18 + (i % 50)
  });
}

await users.insertManyAsync(documents);
```

---

# 7. Reading Documents

## `find()`

`find()` returns a query builder:

```js
const result = users.find({
  age: 25
});
```

To get the documents:

```js
const result = users.find({
  age: 25
}).toArray();
```

## `findOne()`

Find one matching document:

```js
const user = users.findOne({
  username: 'alice'
});
```

Returns the document or `null`.

## `findAsync()`

```js
const query = await users.findAsync({
  age: 25
});
```

The asynchronous form resolves to the query builder.

## `findOneAsync()`

```js
const user = await users.findOneAsync({
  username: 'alice'
});
```

## Empty query

An empty query matches all documents:

```js
const allUsers = users.find({}).toArray();
```

Count them:

```js
const count = users.find({}).count();
```

---

# 8. Query Operators

The query matcher supports several operators.

## `$eq`

Equal:

```js
users.find({
  age: {
    $eq: 25
  }
}).toArray();
```

## `$ne`

Not equal:

```js
users.find({
  age: {
    $ne: 25
  }
}).toArray();
```

## `$gt`

Greater than:

```js
users.find({
  age: {
    $gt: 25
  }
}).toArray();
```

## `$gte`

Greater than or equal:

```js
users.find({
  age: {
    $gte: 25
  }
}).toArray();
```

## `$lt`

Less than:

```js
users.find({
  age: {
    $lt: 25
  }
}).toArray();
```

## `$lte`

Less than or equal:

```js
users.find({
  age: {
    $lte: 25
  }
}).toArray();
```

## `$in`

Match one of several values:

```js
users.find({
  age: {
    $in: [18, 21, 25]
  }
}).toArray();
```

## `$nin`

Match values that are not in an array:

```js
users.find({
  age: {
    $nin: [18, 21, 25]
  }
}).toArray();
```

## `$exists`

Check whether a field exists:

```js
users.find({
  phone: {
    $exists: true
  }
}).toArray();
```

## `$regex`

Regular-expression matching:

```js
users.find({
  username: {
    $regex: '^admin'
  }
}).toArray();
```

Options can be supplied through `$options`:

```js
users.find({
  username: {
    $regex: '^admin',
    $options: 'i'
  }
}).toArray();
```

## `$type`

Check the JavaScript-style type:

```js
users.find({
  age: {
    $type: 'number'
  }
}).toArray();
```

Supported type values follow the implementation's type detection, including values such as:

```text
string
number
boolean
object
array
null
undefined
```

## `$size`

Match an array by its length:

```js
users.find({
  tags: {
    $size: 3
  }
}).toArray();
```

## `$elemMatch`

Match an element inside an array:

```js
users.find({
  roles: {
    $elemMatch: {
      name: 'admin'
    }
  }
}).toArray();
```

## `$or`

At least one query must match:

```js
users.find({
  $or: [
    { age: 18 },
    { age: 25 }
  ]
}).toArray();
```

## `$and`

All queries must match:

```js
users.find({
  $and: [
    { age: { $gte: 18 } },
    { age: { $lt: 30 } }
  ]
}).toArray();
```

## `$nor`

None of the queries should match:

```js
users.find({
  $nor: [
    { age: 18 },
    { age: 25 }
  ]
}).toArray();
```

## Nested fields

Nested fields can be addressed with dot notation:

```js
users.find({
  'profile.city': 'London'
}).toArray();
```

---

# 9. Query Builder

The query builder supports:

```text
limit()
skip()
sort()
project()
toArray()
first()
count()
```

## `limit()`

```js
const users = db.collection('users');

const result = users.find({})
  .limit(10)
  .toArray();
```

## `skip()`

```js
const result = users.find({})
  .skip(20)
  .toArray();
```

## `sort()`

Ascending:

```js
const result = users.find({})
  .sort({
    age: 1
  })
  .toArray();
```

Descending:

```js
const result = users.find({})
  .sort({
    age: -1
  })
  .toArray();
```

Multiple sort fields are supported:

```js
const result = users.find({})
  .sort({
    age: 1,
    username: 1
  })
  .toArray();
```

## `project()`

Return only selected fields:

```js
const result = users.find({})
  .project({
    username: 1,
    email: 1
  })
  .toArray();
```

## `first()`

Get the first result:

```js
const user = users.find({
  age: 25
}).first();
```

Returns:

```text
document
```

or:

```text
null
```

## `count()`

Count query results:

```js
const count = users.find({
  age: 25
}).count();
```

## Combining operations

```js
const result = users.find({
  age: {
    $gte: 18
  }
})
.sort({
  age: 1
})
.skip(10)
.limit(20)
.project({
  username: 1,
  age: 1
})
.toArray();
```

---

# 10. Updating Documents

## `updateOne()`

Update the first matching document:

```js
const updated = users.updateOne(
  {
    username: 'alice'
  },
  {
    $set: {
      age: 26
    }
  }
);
```

## `updateOneAsync()`

```js
const updated = await users.updateOneAsync(
  {
    username: 'alice'
  },
  {
    $set: {
      age: 26
    }
  }
);
```

## `updateMany()`

Update every matching document:

```js
const updated = users.updateMany(
  {
    age: {
      $lt: 18
    }
  },
  {
    $set: {
      status: 'minor'
    }
  }
);
```

## `updateManyAsync()`

```js
const updated = await users.updateManyAsync(
  {
    age: {
      $lt: 18
    }
  },
  {
    $set: {
      status: 'minor'
    }
  }
);
```

The multiple-update methods return an array of updated documents.

---

# 11. Update Operators

`file-json-db` supports several update operators.

## `$set`

Set a value:

```js
users.updateOne(
  { username: 'alice' },
  {
    $set: {
      age: 26,
      'profile.city': 'London'
    }
  }
);
```

## `$inc`

Increment a number:

```js
users.updateOne(
  { username: 'alice' },
  {
    $inc: {
      loginCount: 1
    }
  }
);
```

This is useful for counters.

## `$push`

Add an item to an array:

```js
users.updateOne(
  { username: 'alice' },
  {
    $push: {
      tags: 'developer'
    }
  }
);
```

## `$pull`

Remove matching values:

```js
users.updateOne(
  { username: 'alice' },
  {
    $pull: {
      tags: 'temporary'
    }
  }
);
```

Objects can also be matched by fields:

```js
users.updateOne(
  { username: 'alice' },
  {
    $pull: {
      roles: {
        id: 2
      }
    }
  }
);
```

## `$unset`

Remove a field:

```js
users.updateOne(
  { username: 'alice' },
  {
    $unset: {
      temporaryToken: true
    }
  }
);
```

## `$addToSet`

Add a value only if it is not already present:

```js
users.updateOne(
  { username: 'alice' },
  {
    $addToSet: {
      tags: 'nodejs'
    }
  }
);
```

## `$pop`

Remove one item from an array.

Remove the last item:

```js
users.updateOne(
  { username: 'alice' },
  {
    $pop: {
      tags: 1
    }
  }
);
```

Remove the first item:

```js
users.updateOne(
  { username: 'alice' },
  {
    $pop: {
      tags: -1
    }
  }
);
```

## `$rename`

Rename a field:

```js
users.updateOne(
  { username: 'alice' },
  {
    $rename: {
      fullname: 'name'
    }
  }
);
```

---

# 12. updateFunc

`updateFunc()` lets you find documents, pass each document to your own function, and save the returned document.

Basic example:

```js
users.updateFunc(
  {
    age: {
      $gte: 18
    }
  },
  (doc) => {
    doc.isAdult = true;
    return doc;
  }
);
```

By default, `updateFunc()` updates multiple matching documents.

## Update only one

```js
users.updateFunc(
  {
    username: 'alice'
  },
  (doc) => {
    doc.loginCount++;
    return doc;
  },
  {
    multi: false
  }
);
```

## Async version

```js
await users.updateFuncAsync(
  {
    username: 'alice'
  },
  (doc) => {
    doc.loginCount++;
    return doc;
  }
);
```

The function receives a copy of the matching document.

If the returned document does not contain the configured ID field, the original ID is preserved.

---

# 13. Deleting Documents

## `deleteOne()`

Delete the first matching document:

```js
const deleted = users.deleteOne({
  username: 'alice'
});
```

## `deleteOneAsync()`

```js
const deleted = await users.deleteOneAsync({
  username: 'alice'
});
```

## `deleteMany()`

Delete all matching documents:

```js
const deleted = users.deleteMany({
  status: 'inactive'
});
```

## `deleteManyAsync()`

```js
const deleted = await users.deleteManyAsync({
  status: 'inactive'
});
```

The multiple-delete methods return an array of deleted documents.

---

# 14. Indexes

Indexes allow the database to maintain a lookup structure for configured fields.

Create indexes when creating the collection:

```js
const users = db.collection({
  name: 'users',
  indexes: [
    'username',
    'email'
  ]
});
```

Now these fields are indexed:

```text
username
email
```

An exact query against an indexed field can use the index fast path.

Example:

```js
const user = users.findOne({
  username: 'alice'
});
```

### Indexes and updates

When an indexed field changes, the database updates the corresponding index entry.

Example:

```js
users.updateOne(
  {
    username: 'alice'
  },
  {
    $set: {
      username: 'alice_new'
    }
  }
);
```

The index is updated for the new value.

### Important

Indexes are configured per collection.

They are not automatically created for every field.

If you frequently search by a field, that field is a candidate for an index.

---

# 15. Index Rebuilding

A collection provides:

```js
users.rebuildIndexes();
```

This fully rescans the existing part files and rebuilds the index.

The database also provides:

```js
users.rebuildId();
```

which rebuilds the index and recalculates the next automatically generated numeric ID.

This is useful when part files have changed, been restored, deleted, or otherwise need to be rescanned.

The current implementation deliberately recalculates index information from the actual part-file contents rather than trusting old index metadata.

---

# 16. Transactions

Transactions let you collect several database operations and commit them together.

Start one:

```js
const transaction = users.startTransaction();
```

Add operations:

```js
transaction.insert({
  username: 'alice',
  age: 25
});

transaction.updateOne(
  {
    username: 'bob'
  },
  {
    $set: {
      active: true
    }
  }
);

transaction.deleteOne({
  username: 'old-user'
});
```

Commit:

```js
await transaction.commit();
```

## Transaction insert

```js
transaction.insert({
  username: 'new-user'
});
```

## Transaction insert many

```js
transaction.insertMany([
  {
    username: 'user1'
  },
  {
    username: 'user2'
  }
]);
```

## Transaction update

```js
transaction.updateOne(
  {
    username: 'alice'
  },
  {
    $inc: {
      loginCount: 1
    }
  }
);
```

## Transaction delete

```js
transaction.deleteMany({
  status: 'temporary'
});
```

## Rollback

Discard queued operations:

```js
await transaction.rollback();
```

Rollback clears the pending transaction operations without committing them.

---

# 17. Aggregation

Collections provide an `aggregate()` method with a MongoDB-style pipeline.

Example:

```js
const result = users.aggregate([
  {
    $match: {
      age: {
        $gte: 18
      }
    }
  },
  {
    $sort: {
      age: 1
    }
  },
  {
    $limit: 10
  }
]);
```

Supported pipeline stages in the implementation include:

```text
$match
$sort
$limit
$skip
$project
$group
$count
```

## `$match`

```js
users.aggregate([
  {
    $match: {
      active: true
    }
  }
]);
```

## `$sort`

```js
users.aggregate([
  {
    $sort: {
      age: -1
    }
  }
]);
```

## `$limit`

```js
users.aggregate([
  {
    $limit: 10
  }
]);
```

## `$skip`

```js
users.aggregate([
  {
    $skip: 20
  }
]);
```

## `$project`

```js
users.aggregate([
  {
    $project: {
      username: 1,
      age: 1
    }
  }
]);
```

## `$count`

```js
const result = users.aggregate([
  {
    $count: 'total'
  }
]);
```

Example result:

```js
[
  {
    total: 3500
  }
]
```

## `$group`

Grouping supports aggregation expressions including:

```text
$sum
$avg
$min
$max
$push
```

Example:

```js
const result = users.aggregate([
  {
    $group: {
      _id: '$age',
      count: {
        $sum: 1
      }
    }
  }
]);
```

---

# 18. Importing Data

Collections provide:

```js
users.import(filePath);
```

The input file must contain JSON.

The imported value can be:

```js
[
  {
    username: 'alice'
  },
  {
    username: 'bob'
  }
]
```

or an object containing data/documents:

```js
{
  "data": [
    {
      "username": "alice"
    }
  ]
}
```

The importer also recognizes:

```text
data
documents
```

as data containers.

## Import asynchronously

```js
await users.importAsync('./users.json');
```

## Clear before importing

```js
users.import('./users.json', {
  clear: true
});
```

The `clear` option removes existing part files before importing the new documents.

---

# 19. Backups

The database can create a complete filesystem backup.

## `backup()`

```js
const backupPath = db.backup('./backups');

console.log(backupPath);
```

The backup is created under the supplied backup root.

## `backupAsync()`

```js
const backupPath = await db.backupAsync('./backups');
```

The backup operation copies the database directory recursively.

Example:

```text
backups/
└── backup-YYYY-MM-DDTHH-MM-SS-...
    ├── users/
    │   ├── index.json
    │   └── part-0001.json
    └── ...
```

The generated backup directory name includes a timestamp.

---

# 20. Events

Both the database and collections use Node.js `EventEmitter`.

You can listen to events with:

```js
users.on('insert', (event) => {
  console.log('Inserted:', event.document);
});
```

## Insert

```js
users.on('insert', (event) => {
  console.log('Inserted document:', event.document);
});
```

## Update

```js
users.on('update', (event) => {
  console.log('Updated:', event.count);
});
```

## Delete

```js
users.on('delete', (event) => {
  console.log('Deleted:', event.count);
});
```

## Save

```js
users.on('save', () => {
  console.log('Collection saved');
});
```

## Index rebuilt

```js
users.on('index-rebuilt', (event) => {
  console.log('Index rebuilt:', event.collection);
});
```

## Import

```js
users.on('import', (event) => {
  console.log('Imported:', event.count);
});
```

## Transaction commit

```js
users.on('transactionCommit', (event) => {
  console.log('Transaction committed:', event.collection);
});
```

## Transaction rollback

```js
users.on('transactionRollback', (event) => {
  console.log('Transaction rolled back:', event.collection);
});
```

## Database events

The database also receives collection events:

```js
db.on('insert', (event) => {
  console.log('Database insert:', event.document);
});
```

This can be useful for application-level logging or monitoring.

---

# 21. Error Handling and Recovery

One of the main goals of `file-json-db` is resilience.

The database handles file operations internally and attempts to avoid bringing down the Node.js process because of a bad part file.

## Corrupted part files

When a part file contains invalid JSON, the database does not simply let `JSON.parse()` crash the application.

With:

```js
errorLevel: 'debug'
```

the database attempts to:

1. Detect the parsing failure.
2. Create a `crash/` directory.
3. Copy the problematic part file into it.
4. Emit an error.
5. Return an empty result for that part.

Example collection:

```text
users/
├── index.json
├── part-0001.json
├── part-0002.json
└── crash/
    └── part-0002-....json
```

With:

```js
errorLevel: 'ignore'
```

the corrupted part is silently skipped.

## Listening for errors

```js
users.on('error', (error) => {
  console.error('Database error:', error.message);
});
```

Or:

```js
db.on('error', (error) => {
  console.error('Database error:', error.message);
});
```

---

# 22. Part Files and Storage

A collection does not have to store everything in one enormous JSON file.

Instead, documents are stored in parts:

```text
users/
├── index.json
├── part-0001.json
├── part-0002.json
├── part-0003.json
└── ...
```

The database tracks part metadata in the index.

Each part keeps information such as:

```text
count
size
```

When inserting a document, the database looks for a part that still satisfies the configured size and record limits.

If no suitable part exists, a new part is created.

---

## Atomic Writes

The database uses temporary files before replacing the destination.

Conceptually:

```text
Write temporary file
       ↓
Try rename
       ↓
Success
       │
       └── failure → retry
```

The implementation retries the rename operation several times.

This reduces the chance of leaving a partially written destination file during a write.

---

## Asynchronous Write Queue

Asynchronous collection writes are protected by an internal lock/queue.

For example:

```js
await Promise.all([
  users.insertAsync({ username: 'a' }),
  users.insertAsync({ username: 'b' }),
  users.insertAsync({ username: 'c' })
]);
```

The operations are placed through the collection's internal queue so that write operations do not modify the same collection state simultaneously.

This is particularly important when an application starts multiple asynchronous writes at once.

---

# 23. Real-World Examples

## Example A – Simple user database

```js
const { JSONDB } = require('file-json-db');

const db = new JSONDB('./data');

const users = db.collection({
  name: 'users',
  autoId: true,
  indexes: ['username', 'email']
});

users.insert({
  username: 'alice',
  email: 'alice@example.com',
  age: 25
});

const user = users.findOne({
  username: 'alice'
});

console.log(user);
```

---

## Example B – Express API database

```js
const express = require('express');
const { JSONDB } = require('file-json-db');

const app = express();

app.use(express.json());

const db = new JSONDB('./data');

const users = db.collection({
  name: 'users',
  autoId: true,
  indexes: ['username', 'email']
});

app.post('/users', async (req, res) => {
  try {
    const user = await users.insertAsync(req.body);

    res.status(201).json(user);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.get('/users/:username', (req, res) => {
  const user = users.findOne({
    username: req.params.username
  });

  if (!user) {
    return res.status(404).json({
      error: 'User not found'
    });
  }

  res.json(user);
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

---

## Example C – Counter

```js
const { JSONDB } = require('file-json-db');

const db = new JSONDB('./data');

const stats = db.collection({
  name: 'stats',
  indexes: ['name']
});

stats.insert({
  name: 'requests',
  count: 0
});

await stats.updateOneAsync(
  {
    name: 'requests'
  },
  {
    $inc: {
      count: 1
    }
  }
);
```

---

## Example D – Pagination

```js
function getUsers(page = 1, limit = 20) {
  const skip = (page - 1) * limit;

  return users.find({})
    .sort({
      _id: 1
    })
    .skip(skip)
    .limit(limit)
    .toArray();
}
```

---

## Example E – Search

```js
function searchUsers(name) {
  return users.find({
    fullname: {
      $regex: name,
      $options: 'i'
    }
  }).toArray();
}
```

---

## Example F – Audit-style collection

```js
const logs = db.collection({
  name: 'logs',
  maxRecords: 5000,
  maxPartSize: 1024 * 1024
});

await logs.insertManyAsync([
  {
    action: 'login',
    userId: 10
  },
  {
    action: 'logout',
    userId: 10
  }
]);
```

The record limit can help keep each part bounded by the configured number of documents.

---

## Example G – Transaction

```js
const transaction = users.startTransaction();

transaction.insert({
  username: 'new-user'
});

transaction.updateOne(
  {
    username: 'alice'
  },
  {
    $set: {
      active: true
    }
  }
);

await transaction.commit();
```

---

## Example H – Aggregation

Calculate the number of users in each age group:

```js
const result = users.aggregate([
  {
    $group: {
      _id: '$age',
      total: {
        $sum: 1
      }
    }
  },
  {
    $sort: {
      total: -1
    }
  }
]);

console.log(result);
```

---

# 24. Important Notes & Best Practices

### 1. Use indexes for repeated exact lookups

If your application frequently searches:

```js
users.findOne({
  username: 'alice'
});
```

consider configuring:

```js
indexes: ['username']
```

---

### 2. Do not index every field automatically

Indexes consume memory and add index-maintenance work when documents are inserted, updated, or deleted.

Choose fields that your application actually searches frequently.

---

### 3. Use async methods for application writes

For normal application code, prefer:

```js
insertAsync()
insertManyAsync()
updateOneAsync()
updateManyAsync()
deleteOneAsync()
deleteManyAsync()
updateFuncAsync()
importAsync()
backupAsync()
```

This keeps the application code asynchronous while using the database's internal write queue.

---

### 4. Use `insertManyAsync()` for bulk loading

If you already have many documents:

```js
await users.insertManyAsync(documents);
```

is more appropriate than manually awaiting thousands of individual inserts.

---

### 5. Use `maxPartSize` and `maxRecords` deliberately

Part files can be controlled by:

```js
maxPartSize
maxRecords
```

For example:

```js
const logs = db.collection({
  name: 'logs',
  maxPartSize: 1024 * 1024,
  maxRecords: 5000
});
```

---

### 6. Use `errorLevel: 'debug'` while developing

The default mode:

```js
errorLevel: 'debug'
```

provides useful information when a part cannot be parsed.

For applications where silent skipping is specifically desired:

```js
errorLevel: 'ignore'
```

can be selected.

---

### 7. Rebuild indexes after manual filesystem changes

If you manually restore, modify, remove, or replace database part files, use:

```js
users.rebuildIndexes();
```

The rebuild scans the actual part files.

---

### 8. Keep backups

For important data:

```js
await db.backupAsync('./backups');
```

A backup is a filesystem copy of the database.

---

### 9. Remember that file access is still involved

Although the database keeps an index in memory, the underlying documents are stored on disk.

The database is therefore useful when you want simple persistent storage without running another database server.

---

### 10. Avoid storing unnecessary huge documents

A JSON document database is convenient, but putting very large binary data directly into JSON documents is generally not a good storage design.

For large files, store the file separately and keep its path or metadata in the database.

---

### 11. Treat benchmark results as measurements

If you benchmark `file-json-db`, test with a consistent:

- dataset size
- Node.js version
- machine
- storage device
- number of operations
- index configuration

This makes results easier to compare.

---

# 25. Quick Reference (Cheat Sheet)

```js
const { JSONDB } = require('file-json-db');

const db = new JSONDB('./data');

const users = db.collection({
  name: 'users',
  autoId: true,
  idType: 'auto',
  indexes: ['username', 'email'],
  pretty: true,
  maxPartSize: 256 * 1024,
  maxRecords: 5000,
  errorLevel: 'debug'
});

// Insert
users.insert({ username: 'alice' });
await users.insertAsync({ username: 'bob' });

users.insertMany([
  { username: 'charlie' },
  { username: 'david' }
]);

await users.insertManyAsync([
  { username: 'eve' },
  { username: 'frank' }
]);

// Find
users.findOne({ username: 'alice' });
await users.findOneAsync({ username: 'bob' });

users.find({
  age: { $gte: 18 }
}).toArray();

// Query builder
users.find({})
  .sort({ age: -1 })
  .skip(10)
  .limit(20)
  .project({
    username: 1,
    age: 1
  })
  .toArray();

users.find({}).first();
users.find({}).count();

// Update
users.updateOne(
  { username: 'alice' },
  {
    $set: {
      age: 26
    }
  }
);

await users.updateOneAsync(
  { username: 'bob' },
  {
    $inc: {
      loginCount: 1
    }
  }
);

users.updateMany(
  { active: false },
  {
    $set: {
      status: 'inactive'
    }
  }
);

await users.updateManyAsync(
  { active: false },
  {
    $set: {
      status: 'inactive'
    }
  }
);

// Custom update function
users.updateFunc(
  { active: true },
  (doc) => {
    doc.updated = true;
    return doc;
  }
);

await users.updateFuncAsync(
  { active: true },
  (doc) => {
    doc.updated = true;
    return doc;
  }
);

// Delete
users.deleteOne({ username: 'alice' });
await users.deleteOneAsync({ username: 'bob' });

users.deleteMany({ active: false });
await users.deleteManyAsync({ active: false });

// Indexes
users.rebuildIndexes();
users.rebuildId();

// Transaction
const transaction = users.startTransaction();

transaction.insert({
  username: 'new-user'
});

transaction.updateOne(
  { username: 'bob' },
  {
    $set: {
      active: true
    }
  }
);

await transaction.commit();

// Aggregation
users.aggregate([
  {
    $match: {
      active: true
    }
  },
  {
    $count: 'total'
  }
]);

// Import
users.import('./users.json');
await users.importAsync('./users.json');

// Backup
db.backup('./backups');
await db.backupAsync('./backups');

// Database utilities
db.listCollections();
db.dropCollection('users');
db.unloadCollection('users');
```

---

# 26. Final Words

`file-json-db` is designed around a simple idea:

**Keep JSON storage simple while adding the database features needed for real Node.js applications.**

It provides:

- Persistent JSON documents
- Collections represented by directories
- Chunked/part-file storage
- In-memory indexes
- Query operators
- Query builders
- Updates
- Custom update functions
- Deletes
- Transactions
- Aggregation
- Import
- Backups
- Events
- Atomic writes
- Recovery from invalid part files
- Configurable part size and record limits
- Zero external runtime dependencies

The project is especially useful when you want an embedded database that can live directly inside a Node.js application without requiring a separate database server.

The current package release represented by these project files is **1.2.0**.

Happy building with `file-json-db`!
