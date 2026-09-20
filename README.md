# file-json-db

>A resilient, zero-dependency, MongoDB-style JSON document database for Node.js.

`file-json-db` stores collections as folders, splits documents across multiple JSON part files, keeps a smart index in memory/on disk, supports MongoDB-style queries and updates, and provides utilities such as backups, aggregation, import/export, transactions, events, and automatic index rebuilding.

## Features

- **Zero runtime dependencies**
- **Node.js >= 14**
- MongoDB-style document/collection API
- Collections stored as folders
- Chunked `part-XXXX.json` data files
- Configurable maximum part-file size
- Persistent `index.json`
- Automatic index rebuilding when the index is invalid or stale
- Atomic writes through temporary files
- In-memory query/index processing
- Secondary indexes for selected fields
- Automatic ID generation:
  - numeric auto IDs
  - UUID
  - ObjectId-like hexadecimal IDs
- Nested field access such as `user.profile.name`
- Query operators:
  - `$eq`
  - `$ne`
  - `$gt`
  - `$gte`
  - `$lt`
  - `$lte`
  - `$in`
  - `$nin`
  - `$exists`
  - `$regex`
  - `$type`
  - `$size`
  - `$elemMatch`
  - `$or`
  - `$and`
  - `$nor`
- Query builder:
  - `.limit()`
  - `.skip()`
  - `.sort()`
  - `.project()`
  - `.toArray()`
  - `.first()`
  - `.count()`
- CRUD operations
- Synchronous and Promise-based write helpers
- Update operators:
  - `$set`
  - `$inc`
  - `$push`
  - `$pull`
  - `$unset`
- Aggregation pipeline:
  - `$match`
  - `$sort`
  - `$limit`
  - `$skip`
  - `$project`
  - `$group`
  - `$count`
- Group accumulators:
  - `$sum`
  - `$avg`
  - `$min`
  - `$max`
  - `$push`
- Import from JSON files
- Database backup
- Collection unload/drop
- Events through Node.js `EventEmitter`
- Basic transaction operation queue
- Async write locking/serialization

>The module is a file-based, embedded, chunked, self-healing JSON/NoSQL database with transactions and aggregation.

---

## Installation

### From npm

```bash
npm install file-json-db
```

### Local project


This modules has no runtime dependencies.

`db.js` as the main entry point and requires Node.js `>=14.0.0`.

---

# Quick Start

```js
const { JSONDB } = require('json-db');

const db = new JSONDB('./database');

const users = db.collection('users');

users.insert({
  name: 'John',
  age: 22,
  email: 'john@example.com'
});

console.log(users.find({ age: 22 }).toArray());
```

A simple database directory will look approximately like this:

```text
database/
└── users/
    ├── index.json
    └── part-0001.json
```

The source implementation represents a collection as a directory and stores its metadata in `index.json`. 

---

# Architecture

The basic storage model is:

```text
JSONDB
│
├── users/
│   ├── index.json
│   ├── part-0001.json
│   ├── part-0002.json
│   └── ...
│
├── products/
│   ├── index.json
│   ├── part-0001.json
│   └── ...
│
└── orders/
    ├── index.json
    └── part-0001.json
```

Conceptually:

```text
Database
   │
   ├── Collection
   │      │
   │      ├── index.json
   │      ├── part-0001.json
   │      ├── part-0002.json
   │      └── part-0003.json
   │
   └── Collection
          │
          ├── index.json
          └── part-0001.json
```

The database creates the root directory if necessary, while each collection creates its own directory when initialized.

---

# 1. Creating a Database

```js
const { JSONDB } = require('file-json-db');

const db = new JSONDB('./database');
```

You can choose another directory:

```js
const db = new JSONDB('./data/my-app-db');
```

For an application-specific location:

```js
const path = require('path');
const { JSONDB } = require('file-json-db');

const databasePath = path.join(process.cwd(), 'data');

const db = new JSONDB(databasePath);
```

---

# 2. Creating Collections

The simplest form:

```js
const users = db.collection('users');
```

You can also use `createCollection()`:

```js
const users = db.createCollection('users');
```

Collections can receive configuration:

```js
const users = db.collection({
  name: 'users',
  autoId: true,
  idField: '_id',
  idType: 'auto',
  indexes: ['email', 'username'],
  pretty: true,
  maxPartSize: 128 * 1024
});
```

## Collection options

| Option | Meaning |
|---|---|
| `name` | Collection name |
| `autoId` | Automatically generate an ID when the configured ID field is missing |
| `idField` | Field used for the document ID |
| `idType` | `auto`, `uuid`, or `objectid` |
| `indexes` | Fields to index |
| `pretty` | Pretty-print JSON files |
| `maxPartSize` | Maximum target size used when selecting a part |

The default maximum part size is `128 KB`.

---

# 3. Automatic IDs

Enable IDs with:

```js
const users = db.collection({
  name: 'users',
  autoId: true
});

const user = users.insert({
  name: 'Alice'
});

console.log(user._id);
```

The default `idField` is `_id` and the default `idType` is `auto`.

## Numeric IDs

```js
const users = db.collection({
  name: 'users',
  autoId: true,
  idType: 'auto'
});
```

IDs are generated from the collection's `nextId` counter.

## UUID IDs

```js
const users = db.collection({
  name: 'users',
  autoId: true,
  idType: 'uuid'
});
```

Example:

```text
550e8400-e29b-41d4-a716-446655440000
```

## ObjectId-like IDs

```js
const users = db.collection({
  name: 'users',
  autoId: true,
  idType: 'objectid'
});
```

The implementation creates a hexadecimal value containing a timestamp component and random bytes.

---

# 4. Insert Documents

## Insert one document

```js
const user = users.insert({
  name: 'Alice',
  age: 20,
  email: 'alice@example.com'
});

console.log(user);
```

The inserted document is returned.

## Nested documents

```js
users.insert({
  name: 'David',
  profile: {
    country: 'Nigeria',
    city: 'Abuja'
  }
});
```

Nested properties can later be queried with dot notation.

## Insert many

```js
const inserted = users.insertMany([
  {
    name: 'Alice',
    age: 20
  },
  {
    name: 'Bob',
    age: 25
  },
  {
    name: 'Charlie',
    age: 30
  }
]);

console.log(inserted);
```

---

# 5. Finding Documents

## Find everything

```js
const result = users.find().toArray();

console.log(result);
```

## Find by equality

```js
const result = users
  .find({ name: 'Alice' })
  .toArray();
```

## Find one

```js
const user = users.findOne({
  email: 'alice@example.com'
});

console.log(user);
```

If nothing matches, `findOne()` returns `null`.

---

# 6. Nested Queries

Because the database supports nested field paths:

```js
users.insert({
  name: 'John',
  profile: {
    age: 25,
    address: {
      city: 'Abuja'
    }
  }
});
```

You can query:

```js
const usersInAbuja = users.find({
  'profile.address.city': 'Abuja'
}).toArray();
```

The nested path is resolved by walking each property separated by `.`.

---

# 7. Query Operators

## `$eq`

```js
users.find({
  age: { $eq: 20 }
}).toArray();
```

## `$ne`

```js
users.find({
  status: { $ne: 'banned' }
}).toArray();
```

## `$gt`

```js
users.find({
  age: { $gt: 18 }
}).toArray();
```

## `$gte`

```js
users.find({
  age: { $gte: 18 }
}).toArray();
```

## `$lt`

```js
users.find({
  age: { $lt: 30 }
}).toArray();
```

## `$lte`

```js
users.find({
  age: { $lte: 30 }
}).toArray();
```

## `$in`

```js
users.find({
  role: {
    $in: ['admin', 'moderator']
  }
}).toArray();
```

## `$nin`

```js
users.find({
  role: {
    $nin: ['banned', 'suspended']
  }
}).toArray();
```

## `$exists`

```js
users.find({
  phone: {
    $exists: true
  }
}).toArray();
```

Find documents where a field does not exist:

```js
users.find({
  phone: {
    $exists: false
  }
}).toArray();
```

## `$regex`

```js
users.find({
  name: {
    $regex: '^A'
  }
}).toArray();
```

Case-insensitive regex:

```js
users.find({
  name: {
    $regex: 'alice',
    $options: 'i'
  }
}).toArray();
```

The matcher supports regular expressions using either an existing `RegExp` object or a pattern passed to `RegExp`.

## `$type`

```js
users.find({
  age: {
    $type: 'number'
  }
}).toArray();
```

Supported type values are based on JavaScript's detected value type, with special handling for `null` and arrays.

## `$size`

```js
users.find({
  tags: {
    $size: 3
  }
}).toArray();
```

## `$elemMatch`

For arrays:

```js
users.insert({
  name: 'John',
  skills: [
    { name: 'JavaScript', level: 5 },
    { name: 'Node.js', level: 4 }
  ]
});
```

Then:

```js
const result = users.find({
  skills: {
    $elemMatch: {
      name: 'Node.js',
      level: { $gte: 4 }
    }
  }
}).toArray();
```

---

# 8. Logical Queries

## `$or`

```js
const result = users.find({
  $or: [
    { age: { $lt: 18 } },
    { role: 'admin' }
  ]
}).toArray();
```

## `$and`

```js
const result = users.find({
  $and: [
    { age: { $gte: 18 } },
    { active: true }
  ]
}).toArray();
```

## `$nor`

```js
const result = users.find({
  $nor: [
    { role: 'banned' },
    { role: 'suspended' }
  ]
}).toArray();
```

These logical operators are implemented directly by the query matcher.

---

# 9. Query Builder

The query API returns a `QueryBuilder`.

```js
const query = users.find({
  active: true
});
```

You can chain operations.

## Limit

```js
const result = users
  .find({ active: true })
  .limit(10)
  .toArray();
```

## Skip

```js
const result = users
  .find({})
  .skip(20)
  .limit(10)
  .toArray();
```

This is useful for pagination.

```js
function getPage(collection, page, pageSize) {
  return collection
    .find({})
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .toArray();
}

console.log(getPage(users, 1, 20));
console.log(getPage(users, 2, 20));
```

## First

```js
const user = users
  .find({ active: true })
  .first();
```

## Count

```js
const count = users
  .find({ active: true })
  .count();

console.log(count);
```

---

# 10. Sorting

Ascending:

```js
const result = users
  .find({})
  .sort({ age: 1 })
  .toArray();
```

Descending:

```js
const result = users
  .find({})
  .sort({ age: -1 })
  .toArray();
```

Multiple sort fields:

```js
const result = users
  .find({})
  .sort({
    role: 1,
    age: -1
  })
  .toArray();
```

String directions are also recognized by the query sorting implementation:

```js
users.find({}).sort({
  age: 'desc'
}).toArray();
```

---

# 11. Projection

Projection lets you return selected fields.

```js
const result = users
  .find({ active: true })
  .project({
    name: 1,
    email: 1
  })
  .toArray();
```

For nested fields:

```js
const result = users
  .find({})
  .project({
    name: 1,
    'profile.city': 1
  })
  .toArray();
```

The current implementation constructs a new object containing the truthy projection fields.

---

# 12. Indexes

Indexes can be configured when creating a collection:

```js
const users = db.collection({
  name: 'users',
  autoId: true,
  indexes: [
    'email',
    'username'
  ]
});
```

Now:

```js
users.find({
  email: 'alice@example.com'
}).toArray();
```

can use the collection's secondary index fast path when the query is an exact, non-object match on an indexed field.

The index stores information linking a field value to a document ID and part file.

## Why indexes matter

Without an index, the database may need to scan:

```text
part-0001.json
part-0002.json
part-0003.json
part-0004.json
...
```

With an applicable index, it can first locate:

```text
email
  ↓
alice@example.com
  ↓
document ID + part
  ↓
part-0003.json
```

Complex queries and non-indexed fields use a full scan.

---

# 13. Updating Documents

## `$set`

```js
const updated = users.updateOne(
  { email: 'alice@example.com' },
  {
    $set: {
      active: true,
      age: 21
    }
  }
);

console.log(updated);
```

Nested `$set`:

```js
users.updateOne(
  { email: 'alice@example.com' },
  {
    $set: {
      'profile.city': 'Abuja'
    }
  }
);
```

## `$inc`

```js
users.updateOne(
  { name: 'Alice' },
  {
    $inc: {
      points: 10
    }
  }
);
```

If the current value is missing/falsy, the implementation starts from `0`.

## `$push`

```js
users.updateOne(
  { name: 'Alice' },
  {
    $push: {
      tags: 'javascript'
    }
  }
);
```

If the target field is not already an array, the implementation creates an array first.

## `$pull`

```js
users.updateOne(
  { name: 'Alice' },
  {
    $pull: {
      tags: 'javascript'
    }
  }
);
```

## `$unset`

```js
users.updateOne(
  { name: 'Alice' },
  {
    $unset: {
      temporaryToken: true
    }
  }
);
```

---

# 14. `updateOne()` vs `updateMany()`

Update one document:

```js
const updated = users.updateOne(
  { role: 'user' },
  {
    $set: {
      active: true
    }
  }
);
```

Update every matching document:

```js
const updated = users.updateMany(
  { role: 'user' },
  {
    $set: {
      active: true
    }
  }
);
```

`updateOne()` returns the updated document or `null`.

`updateMany()` returns an array of updated documents.

---

# 15. Deleting Documents

## Delete one

```js
const deleted = users.deleteOne({
  email: 'alice@example.com'
});

console.log(deleted);
```

## Delete many

```js
const deleted = users.deleteMany({
  active: false
});

console.log(deleted);
```

When indexed fields are removed from documents, the corresponding index entries are also removed.

---

# 16. Async Operations

Write operations have Promise-based variants.

## Insert

```js
const user = await users.insertAsync({
  name: 'Alice',
  age: 20
});
```

## Insert many

```js
const inserted = await users.insertManyAsync([
  { name: 'Alice' },
  { name: 'Bob' }
]);
```

## Update

```js
const updated = await users.updateOneAsync(
  { name: 'Alice' },
  {
    $inc: {
      points: 5
    }
  }
);
```

## Delete

```js
const deleted = await users.deleteOneAsync({
  name: 'Alice'
});
```

The async write methods use an internal queue/lock so concurrent write calls on the same collection are serialized.

---

# 17. Events

Both the database and collections extend Node.js `EventEmitter`.

```js
users.on('insert', event => {
  console.log('Inserted:', event.document);
});
```

Listen for updates:

```js
users.on('update', event => {
  console.log('Updated documents:', event.count);
});
```

Listen for deletes:

```js
users.on('delete', event => {
  console.log('Deleted documents:', event.count);
});
```

Listen for saves:

```js
users.on('save', event => {
  console.log('Collection saved:', event.collection);
});
```

Listen for imports:

```js
users.on('import', event => {
  console.log('Imported:', event.count);
});
```

Listen for transactions:

```js
users.on('transactionCommit', event => {
  console.log('Transaction committed:', event.collection);
});

users.on('transactionRollback', event => {
  console.log('Transaction rolled back:', event.collection);
});
```

Database-level events are also emitted for many collection operations.

---

# 18. Error Handling

The database and collections emit an `error` event when internal operations fail.

```js
db.on('error', err => {
  console.error('Database error:', err);
});

users.on('error', err => {
  console.error('Collection error:', err);
});
```

It is a good idea to install error handlers in long-running applications:

```js
const db = new JSONDB('./database');

db.on('error', error => {
  console.error('[DB ERROR]', error);
});
```

---

# 19. Automatic Recovery and Index Rebuilding

Each collection has an `index.json`.

When the index exists, it is loaded when the collection starts.

If the index cannot be parsed or is otherwise invalid, the implementation creates a fresh index and rebuilds it from the available part files.

You can manually rebuild:

```js
users.rebuildIndexes();
```

You can also rebuild the numeric ID state:

```js
const nextId = users.rebuildId();

console.log('Next ID:', nextId);
```

The rebuild process scans part files, reconstructs part metadata, secondary indexes, and the next numeric ID.

---

# 20. Part Files

The database splits data into part files.

Example:

```text
users/
├── index.json
├── part-0001.json
├── part-0002.json
├── part-0003.json
└── part-0004.json
```

The default maximum part size is:

```js
128 * 1024
```

or:

```text
128 KB
```

You can customize it:

```js
const users = db.collection({
  name: 'users',
  maxPartSize: 1024 * 1024
});
```

This sets the target part size to approximately 1 MB.

---

# 21. Atomic Writes

The implementation writes data to a temporary file before replacing the target file.

Conceptually:

```text
part-0001.json
       ↑
       │
part-0001.json.tmp
       │
       └── rename
```

Example internal behavior:

```js
const tmp = filePath + '.tmp';

fs.writeFileSync(tmp, content, 'utf8');
fs.renameSync(tmp, filePath);
```

The asynchronous version follows the same approach with Promise-based filesystem operations.

This reduces the chance of leaving a partially written JSON file if a write is interrupted.

---

# 22. Aggregation

`aggregate()` accepts a pipeline.

Basic example:

```js
const result = users.aggregate([
  {
    $match: {
      active: true
    }
  },
  {
    $sort: {
      age: -1
    }
  },
  {
    $limit: 10
  }
]);
```

---

## `$match`

```js
const result = users.aggregate([
  {
    $match: {
      age: {
        $gte: 18
      }
    }
  }
]);
```

---

## `$sort`

```js
const result = users.aggregate([
  {
    $sort: {
      age: -1
    }
  }
]);
```

---

## `$limit`

```js
const result = users.aggregate([
  {
    $limit: 5
  }
]);
```

---

## `$skip`

```js
const result = users.aggregate([
  {
    $skip: 10
  }
]);
```

---

## `$project`

```js
const result = users.aggregate([
  {
    $project: {
      name: 1,
      age: 1
    }
  }
]);
```

---

# 23. Aggregation `$group`

Suppose the collection contains:

```js
[
  { name: 'A', department: 'IT', salary: 1000 },
  { name: 'B', department: 'IT', salary: 1500 },
  { name: 'C', department: 'HR', salary: 1200 }
]
```

Group by department:

```js
const result = users.aggregate([
  {
    $group: {
      _id: '$department',
      totalSalary: {
        $sum: '$salary'
      }
    }
  }
]);
```

Conceptually:

```text
IT → 2500
HR → 1200
```

---

# 24. `$sum`

Count documents per group:

```js
const result = users.aggregate([
  {
    $group: {
      _id: '$department',
      total: {
        $sum: 1
      }
    }
  }
]);
```

Sum a field:

```js
const result = users.aggregate([
  {
    $group: {
      _id: '$department',
      totalSalary: {
        $sum: '$salary'
      }
    }
  }
]);
```

---

# 25. `$avg`

```js
const result = users.aggregate([
  {
    $group: {
      _id: '$department',
      averageSalary: {
        $avg: '$salary'
      }
    }
  }
]);
```

The implementation calculates averages using an internal running sum and count.

---

# 26. `$min` and `$max`

```js
const result = users.aggregate([
  {
    $group: {
      _id: '$department',
      lowestSalary: {
        $min: '$salary'
      },
      highestSalary: {
        $max: '$salary'
      }
    }
  }
]);
```

---

# 27. `$push`

Collect values into arrays:

```js
const result = users.aggregate([
  {
    $group: {
      _id: '$department',
      employees: {
        $push: '$name'
      }
    }
  }
]);
```

Possible result:

```js
[
  {
    _id: 'IT',
    employees: ['A', 'B']
  },
  {
    _id: 'HR',
    employees: ['C']
  }
]
```

---

# 28. `$count`

```js
const result = users.aggregate([
  {
    $count: 'totalUsers'
  }
]);

console.log(result);
```

Example:

```js
[
  {
    totalUsers: 42
  }
]
```

---

# 29. Complete Aggregation Example

```js
const result = users.aggregate([
  {
    $match: {
      active: true
    }
  },
  {
    $group: {
      _id: '$department',
      employees: {
        $sum: 1
      },
      averageAge: {
        $avg: '$age'
      },
      oldest: {
        $max: '$age'
      },
      youngest: {
        $min: '$age'
      }
    }
  },
  {
    $sort: {
      employees: -1
    }
  }
]);

console.log(result);
```

This combines filtering, grouping, aggregation, and sorting.

---

# 30. Transactions

Create a transaction:

```js
const transaction = users.startTransaction();
```

Queue operations:

```js
transaction.insert({
  name: 'Alice',
  balance: 100
});

transaction.updateOne(
  { name: 'Bob' },
  {
    $inc: {
      balance: -50
    }
  }
);
```

Commit:

```js
await transaction.commit();
```

Rollback the queued operations before commit:

```js
await transaction.rollback();
```

---

## Transaction example

```js
async function createUser() {
  const transaction = users.startTransaction();

  transaction.insert({
    name: 'Alice',
    balance: 100
  });

  transaction.insert({
    name: 'Bob',
    balance: 200
  });

  const success = await transaction.commit();

  if (success) {
    console.log('Transaction committed');
  }
}
```

### Important transaction behavior

The current implementation queues operations and executes them sequentially during `commit()`.

`rollback()` clears operations that have not been committed.

The current implementation does **not** implement a full snapshot-based rollback of already-written files if an operation fails halfway through commit. Therefore, applications requiring strict database-style atomic transactions should not assume that `commit()` provides full crash-safe all-or-nothing semantics. This follows directly from the current `Transaction.commit()` implementation, which executes the queued collection operations one by one.

---

# 31. Importing JSON

Suppose `users.json` contains:

```json
[
  {
    "name": "Alice",
    "age": 20
  },
  {
    "name": "Bob",
    "age": 25
  }
]
```

Import it:

```js
const success = users.import('./users.json');

console.log(success);
```

The importer accepts either a JSON array or an object containing `data` or `documents`.

For example:

```json
{
  "data": [
    {
      "name": "Alice"
    }
  ]
}
```

or:

```json
{
  "documents": [
    {
      "name": "Alice"
    }
  ]
}
```

---

# 32. Clear Before Import

```js
users.import('./users.json', {
  clear: true
});
```

This removes existing part files, recreates the index, and then inserts the imported documents.

---

# 33. Async Import

```js
const success = await users.importAsync(
  './users.json',
  {
    clear: true
  }
);
```

---

# 34. Backups

Create a backup:

```js
const backupPath = db.backup('./backups');

console.log('Backup:', backupPath);
```

A timestamped directory is created.

Example:

```text
backups/
└── backup-2026-09-20T12-30-00-000Z/
    ├── users/
    │   ├── index.json
    │   └── part-0001.json
    └── products/
        ├── index.json
        └── part-0001.json
```

The backup implementation recursively copies the database directory into a timestamped backup directory.

---

# 35. Async Backup

```js
const backupPath = await db.backupAsync('./backups');

console.log(backupPath);
```

The current async backup method delegates to the existing backup implementation.

---

# 36. Listing Collections

```js
const collections = db.listCollections();

console.log(collections);
```

Example:

```js
[
  'users',
  'products',
  'orders'
]
```

---

# 37. Dropping a Collection

```js
const success = db.dropCollection('users');

console.log(success);
```

This removes the collection directory recursively and removes the collection from the in-memory database registry.

---

# 38. Unloading a Collection

Unload without deleting its files:

```js
const success = db.unloadCollection('users');

console.log(success);
```

The collection object is removed from memory, but its stored files remain on disk.

If you later call:

```js
const users = db.collection('users');
```

the collection can be loaded again.

---

# 39. Building a User Database

A complete example:

```js
const { JSONDB } = require('file-json-db');

const db = new JSONDB('./database');

const users = db.collection({
  name: 'users',
  autoId: true,
  idType: 'uuid',
  indexes: [
    'email',
    'username'
  ]
});

users.insertMany([
  {
    username: 'alice',
    email: 'alice@example.com',
    age: 20,
    role: 'user',
    active: true
  },
  {
    username: 'bob',
    email: 'bob@example.com',
    age: 25,
    role: 'admin',
    active: true
  }
]);

const admin = users.findOne({
  role: 'admin'
});

console.log(admin);
```

---

# 40. Pagination API Example

This is useful for REST APIs.

```js
function paginate(collection, page = 1, limit = 20) {
  const skip = (page - 1) * limit;

  return collection
    .find({})
    .skip(skip)
    .limit(limit)
    .toArray();
}
```

Express example:

```js
app.get('/users', (req, res) => {
  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;

  const users = db
    .collection('users')
    .find({})
    .skip((page - 1) * limit)
    .limit(limit)
    .toArray();

  res.json(users);
});
```

---

# 41. Simple Authentication Database

For application accounts:

```js
const accounts = db.collection({
  name: 'accounts',
  autoId: true,
  idType: 'uuid',
  indexes: ['email']
});
```

Insert:

```js
accounts.insert({
  email: 'user@example.com',
  passwordHash: '...',
  createdAt: Date.now(),
  active: true
});
```

Find:

```js
const account = accounts.findOne({
  email: 'user@example.com'
});
```

> Store password hashes rather than plaintext passwords. `file-json-db` is a storage layer; password hashing should be handled separately by an appropriate cryptographic library.

---

# 42. File Metadata Database

A file manager can store metadata:

```js
const files = db.collection({
  name: 'files',
  autoId: true,
  indexes: [
    'name',
    'mime',
    'ownerId'
  ]
});
```

Insert:

```js
files.insert({
  name: 'photo.jpg',
  mime: 'image/jpeg',
  size: 2400000,
  ownerId: 'user-123',
  path: '/uploads/photo.jpg',
  createdAt: Date.now()
});
```

Find images:

```js
const images = files.find({
  mime: {
    $regex: '^image/'
  }
}).toArray();
```

Find a user's files:

```js
const userFiles = files.find({
  ownerId: 'user-123'
}).toArray();
```

---

# 43. Product Database

```js
const products = db.collection({
  name: 'products',
  autoId: true,
  indexes: [
    'sku',
    'category'
  ]
});
```

Insert:

```js
products.insertMany([
  {
    sku: 'PHONE-001',
    name: 'Example Phone',
    category: 'phones',
    price: 500,
    stock: 20
  },
  {
    sku: 'LAPTOP-001',
    name: 'Example Laptop',
    category: 'computers',
    price: 1200,
    stock: 8
  }
]);
```

Find affordable products:

```js
const productsUnder1000 = products.find({
  price: {
    $lt: 1000
  }
}).toArray();
```

Update stock:

```js
products.updateOne(
  {
    sku: 'PHONE-001'
  },
  {
    $inc: {
      stock: -1
    }
  }
);
```

---

# 44. Xender-Lite-Style Local Application Example

`file-json-db` can also work well as a local application data store.

For example:

```js
const db = new JSONDB('./data');

const transfers = db.collection({
  name: 'transfers',
  autoId: true,
  indexes: [
    'deviceId',
    'status'
  ]
});
```

Store transfer history:

```js
transfers.insert({
  deviceId: 'device-001',
  fileName: 'video.mp4',
  size: 10485760,
  status: 'completed',
  createdAt: Date.now()
});
```

Find completed transfers:

```js
const completed = transfers.find({
  status: 'completed'
}).toArray();
```

Find transfers from one device:

```js
const deviceTransfers = transfers.find({
  deviceId: 'device-001'
}).toArray();
```

Count completed transfers:

```js
const total = transfers
  .find({
    status: 'completed'
  })
  .count();
```

---

# 45. Event-Driven Application Example

```js
const db = new JSONDB('./database');

const messages = db.collection({
  name: 'messages',
  autoId: true
});

messages.on('insert', ({ document }) => {
  console.log('New message:', document);
});

messages.on('delete', ({ count }) => {
  console.log('Deleted messages:', count);
});

messages.insert({
  from: 'alice',
  text: 'Hello'
});
```

This can be useful when connecting the database to:

- WebSocket servers
- Socket.IO
- Express
- local desktop applications
- file transfer systems
- notification systems

---

# 46. Combining Queries With Sorting and Pagination

```js
const result = users
  .find({
    active: true,
    age: {
      $gte: 18
    }
  })
  .sort({
    createdAt: -1
  })
  .skip(20)
  .limit(10)
  .project({
    name: 1,
    email: 1,
    createdAt: 1
  })
  .toArray();
```

This creates a useful pipeline:

```text
Filter
  ↓
Sort
  ↓
Skip
  ↓
Limit
  ↓
Project
  ↓
Array
```

---

# 47. Full Application Example

```js
const { JSONDB } = require('file-json-db');

const db = new JSONDB('./database');

db.on('error', error => {
  console.error('[DATABASE ERROR]', error);
});

const users = db.collection({
  name: 'users',
  autoId: true,
  idType: 'uuid',
  indexes: [
    'email',
    'role'
  ],
  pretty: true,
  maxPartSize: 128 * 1024
});

users.on('insert', ({ document }) => {
  console.log('Inserted:', document._id);
});

users.on('update', ({ count }) => {
  console.log('Updated:', count);
});

users.on('delete', ({ count }) => {
  console.log('Deleted:', count);
});

async function main() {
  await users.insertAsync({
    name: 'Alice',
    email: 'alice@example.com',
    role: 'admin',
    points: 10,
    profile: {
      city: 'Abuja'
    }
  });

  await users.updateOneAsync(
    {
      email: 'alice@example.com'
    },
    {
      $inc: {
        points: 5
      },
      $set: {
        'profile.country': 'Nigeria'
      }
    }
  );

  const result = users
    .find({
      role: 'admin'
    })
    .sort({
      points: -1
    })
    .limit(10)
    .project({
      name: 1,
      points: 1,
      'profile.city': 1
    })
    .toArray();

  console.log(result);
}

main().catch(console.error);
```

---

# 48. API Reference

## `JSONDB`

### Constructor

```js
new JSONDB(dbPath)
```

Default:

```js
new JSONDB('./database')
```

### Methods

```js
db.collection(name)
db.collection(options)

db.createCollection(name)
db.createCollection(options)

db.listCollections()

db.dropCollection(name)

db.unloadCollection(name)

db.backup(backupRoot)

await db.backupAsync(backupRoot)
```

---

# 49. `Collection`

## Creation

```js
db.collection('users');
```

or:

```js
db.collection({
  name: 'users',
  autoId: true,
  idField: '_id',
  idType: 'uuid',
  indexes: ['email']
});
```

## CRUD

```js
collection.insert(document)

await collection.insertAsync(document)

collection.insertMany(documents)

await collection.insertManyAsync(documents)

collection.find(query)

collection.findOne(query)

collection.updateOne(filter, update)

collection.updateMany(filter, update)

await collection.updateOneAsync(filter, update)

await collection.updateManyAsync(filter, update)

collection.deleteOne(filter)

collection.deleteMany(filter)

await collection.deleteOneAsync(filter)

await collection.deleteManyAsync(filter)
```

## Maintenance

```js
collection.rebuildIndexes()

collection.rebuildId()

collection.import(filePath, options)

await collection.importAsync(filePath, options)

collection.startTransaction()

collection.aggregate(pipeline)
```

---

# 50. `QueryBuilder`

```js
collection.find(query)
```

returns a query builder.

Available methods:

```js
query.limit(number)

query.skip(number)

query.sort(object)

query.project(object)

query.toArray()

query.first()

query.count()
```

Example:

```js
const result = users
  .find({
    active: true
  })
  .sort({
    age: -1
  })
  .skip(10)
  .limit(10)
  .project({
    name: 1,
    age: 1
  })
  .toArray();
```

---

# 51. `Transaction`

```js
const tx = collection.startTransaction();
```

Methods:

```js
tx.insert(document)

await tx.insertAsync(document)

tx.insertMany(documents)

await tx.insertManyAsync(documents)

tx.updateOne(filter, update)

await tx.updateOneAsync(filter, update)

tx.updateMany(filter, update)

await tx.updateManyAsync(filter, update)

tx.deleteOne(filter)

await tx.deleteOneAsync(filter)

tx.deleteMany(filter)

await tx.deleteManyAsync(filter)

await tx.commit()

await tx.rollback()
```

---

# 52. Exported Classes

The package exports:

```js
const {
  JSONDB,
  Collection,
  QueryBuilder,
  Transaction
} = require('file-json-db');
```

The package entry point exports these four classes.

---

# 53. Recommended Project Structure

A project using the database might look like:

```text
my-app/
├── database/
│   ├── users/
│   │   ├── index.json
│   │   └── part-0001.json
│   ├── products/
│   │   ├── index.json
│   │   └── part-0001.json
│   └── orders/
│       ├── index.json
│       └── part-0001.json
│
├── backups/
│
├── src/
│   ├── db.js
│   ├── users.js
│   ├── products.js
│   └── orders.js
│
├── index.js
└── package.json
```

Example `src/db.js`:

```js
const { JSONDB } = require('file-json-db');

const db = new JSONDB('./database');

db.on('error', error => {
  console.error('[DB]', error);
});

module.exports = db;
```

Then:

```js
const db = require('./db');

const users = db.collection({
  name: 'users',
  autoId: true,
  indexes: ['email']
});

module.exports = users;
```

---

# 54. Database Lifecycle

A typical application lifecycle is:

```text
Application starts
       ↓
Create JSONDB
       ↓
Open/create collection
       ↓
Load index.json
       ↓
If index is invalid → rebuild
       ↓
Application performs CRUD
       ↓
Part files are updated
       ↓
Index is updated
       ↓
Events are emitted
       ↓
Application exits
```

This design allows the database to recover its index from the actual part files when necessary.

---

# 55. When to Use file-json-db

This project is particularly suitable for:

- local Node.js applications
- desktop applications
- prototypes
- small-to-medium embedded databases
- configuration/data stores
- local APIs
- development tools
- file-transfer applications
- offline applications
- applications where keeping data in readable JSON is useful

It is **not** intended to replace a production server database for every workload.

For workloads involving:

- many concurrent processes
- very large datasets
- heavy concurrent writes
- distributed servers
- advanced query planning
- replication
- network database access

a dedicated database system may be more appropriate.

---

# 56. Important Implementation Notes

## JSON is still the storage format

Although the API resembles MongoDB, this is a JSON file database.

Documents ultimately live inside JSON part files.

## Queries are in-memory operations

The database loads part files and evaluates documents using JavaScript.

Complex queries can therefore require scanning many documents.

## Indexes are selective

Configured secondary indexes can accelerate certain simple exact-match queries, but they do not turn every query into an indexed query.

For example:

```js
users.find({
  email: 'alice@example.com'
});
```

can use an index configured for `email`.

But:

```js
users.find({
  age: {
    $gt: 18
  }
});
```

does not receive the same indexed fast path simply because `age` happens to be configured as an index.

## Part size is a storage-management mechanism

`maxPartSize` controls which part file is selected for new inserts based on the recorded file size. It is not a complete page-management or compaction system.

---

# 57. Development

The package declares these scripts:

```bash
npm test
```

and:

```bash
npm run example
```

The corresponding `package.json` entries are:

```json
{
  "scripts": {
    "test": "node test/basic.js",
    "example": "node examples/basic.js"
  }
}
```

---

# 58. License

```text
MIT
```

feel free to use it as you want

---

# 59. Summary

`file-json-db` provides a MongoDB-inspired programming model while keeping the actual storage simple and local:

```text
MongoDB-style API
        │
        ▼
    JSONDB
        │
        ▼
 Collections
        │
        ▼
 Chunked JSON files
        │
        ├── index.json
        ├── part-0001.json
        ├── part-0002.json
        └── ...
```

The core idea is:

> **Use a familiar document-database API while keeping the database embedded, readable, file-based, dependency-free, and capable of recovering its indexes from stored data.**

---

## Minimal Example

If you only remember one example, start here:

```js
const { JSONDB } = require('file-json-db');

const db = new JSONDB('./database');

const users = db.collection({
  name: 'users',
  autoId: true,
  indexes: ['email']
});

users.insert({
  name: 'Alice',
  email: 'alice@example.com',
  age: 20
});

const user = users.findOne({
  email: 'alice@example.com'
});

console.log(user);

users.updateOne(
  {
    email: 'alice@example.com'
  },
  {
    $inc: {
      age: 1
    }
  }
);

users.deleteOne({
  email: 'alice@example.com'
});
```

That is the basic `file-json-db` workflow:

```text
Create DB
   ↓
Create Collection
   ↓
Insert
   ↓
Find
   ↓
Update
   ↓
Delete
```