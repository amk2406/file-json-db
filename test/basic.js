'use strict';

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const readline = require('readline');

const { JSONDB } = require('../db');

// ============================================================
// CONFIGURATION
// ============================================================

const DOCUMENT_COUNT = 3500;

const RACE_INSERT_COUNT = 500;
const RACE_COUNTER_COUNT = 500;

const DB_PATH = path.join(__dirname, 'benchmark-db');

const COLLECTION_NAME = 'users';

// ============================================================
// COLORS
// ============================================================

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';

const COLORS = {
    setup: '\x1b[36m',
    database: '\x1b[35m',
    collection: '\x1b[34m',
    index: '\x1b[33m',
    data: '\x1b[32m',
    insert: '\x1b[92m',
    query: '\x1b[96m',
    update: '\x1b[95m',
    race: '\x1b[91m',
    delete: '\x1b[31m',
    verify: '\x1b[94m',
    backup: '\x1b[90m',
    transaction: '\x1b[93m',
    summary: '\x1b[37m',
    error: '\x1b[31m'
};

// ============================================================
// LOGGING
// ============================================================

function log(type, message, color = COLORS.setup) {
    console.log(
        `${color}[${type}]${RESET} ${message}`
    );
}

function line() {
    console.log(
        `${DIM}────────────────────────────────────────────────────────────${RESET}`
    );
}

function section(title) {
    console.log('');
    line();

    console.log(
        `${BOLD}${title}${RESET}`
    );

    line();
}

function result(label, value) {
    console.log(
        `  ${label.padEnd(28)} : ${value}`
    );
}

// ============================================================
// TIMING
// ============================================================

async function measure(label, fn) {
    const start = performance.now();

    log('TIMER', `${label} started...`, COLORS.setup);

    try {
        const value = await fn();

        const duration = performance.now() - start;

        log(
            'TIMER',
            `${label} completed in ${duration.toFixed(3)} ms`,
            COLORS.data
        );

        return {
            value,
            duration
        };

    } catch (error) {

        const duration = performance.now() - start;

        log(
            'ERROR',
            `${label} failed after ${duration.toFixed(3)} ms`,
            COLORS.error
        );

        throw error;
    }
}

// ============================================================
// DATABASE SETUP
// ============================================================

function configureDatabase() {

    log(
        'SETUP',
        'Starting file-json-db benchmark...',
        COLORS.setup
    );

    log(
        'DATABASE',
        `Database path: ${DB_PATH}`,
        COLORS.database
    );

    log(
        'DATABASE',
        'Creating JSONDB instance...',
        COLORS.database
    );

    const db = new JSONDB(DB_PATH);

    log(
        'DATABASE',
        'JSONDB instance created',
        COLORS.database
    );

    // --------------------------------------------------------
    // DATABASE EVENTS
    // --------------------------------------------------------

    log(
        'DATABASE',
        'Registering database error listener...',
        COLORS.database
    );

    db.on('error', error => {

        log(
            'DB ERROR',
            error.message,
            COLORS.error
        );

    });

    // --------------------------------------------------------
    // COLLECTION
    // --------------------------------------------------------

    log(
        'COLLECTION',
        `Creating "${COLLECTION_NAME}" collection...`,
        COLORS.collection
    );

    log(
        'COLLECTION',
        'Configuring automatic IDs...',
        COLORS.collection
    );

    log(
        'INDEX',
        'Configuring username index...',
        COLORS.index
    );

    log(
        'INDEX',
        'Configuring email index...',
        COLORS.index
    );

    const users = db.collection({
        name: COLLECTION_NAME,

        autoId: true,

        idField: '_id',

        idType: 'auto',

        indexes: [
            'username',
            'email'
        ],

        pretty: false
    });

    log(
        'COLLECTION',
        'Collection configuration complete',
        COLORS.collection
    );

    // --------------------------------------------------------
    // COLLECTION EVENTS
    // --------------------------------------------------------

    log(
        'COLLECTION',
        'Registering collection events...',
        COLORS.collection
    );

    users.on('insert', event => {

        if (event?.document?.benchmarkEventLog) {

            log(
                'EVENT',
                `Insert event received for ${event.document.username}`,
                COLORS.insert
            );

        }

    });

    users.on('update', event => {

        log(
            'EVENT',
            `Update event received (${event.count ?? 'unknown'} document(s))`,
            COLORS.update
        );

    });

    users.on('delete', event => {

        log(
            'EVENT',
            `Delete event received (${event.count ?? 'unknown'} document(s))`,
            COLORS.delete
        );

    });

    users.on('save', event => {

        log(
            'EVENT',
            `Collection save event received`,
            COLORS.database
        );

    });

    users.on('error', error => {

        log(
            'COLLECTION ERROR',
            error.message,
            COLORS.error
        );

    });

    return {
        db,
        users
    };
}

// ============================================================
// USER DATA
// ============================================================

const firstNames = [
    'John',
    'Michael',
    'David',
    'Daniel',
    'James',
    'Robert',
    'William',
    'Joseph',
    'Samuel',
    'Benjamin'
];

const lastNames = [
    'Smith',
    'Johnson',
    'Brown',
    'Williams',
    'Jones',
    'Miller',
    'Davis',
    'Wilson',
    'Taylor',
    'Anderson'
];

function createUser(index, prefix = 'benchmark') {

    const first =
        firstNames[index % firstNames.length];

    const last =
        lastNames[index % lastNames.length];

    return {

        username:
            `${prefix}_user_${index}`,

        fullname:
            `${first} ${last} ${index}`,

        email:
            `${prefix}${index}@example.test`,

        // Synthetic benchmark password.
        password:
            `BenchmarkPassword_${index}_123!`,

        age:
            18 + (index % 50),

        phone:
            `080${String(index).padStart(8, '0')}`,

        benchmark: true,

        benchmarkId: index,

        createdAt:
            new Date().toISOString()
    };
}

// ============================================================
// GENERATE DOCUMENTS
// ============================================================

async function generateDocuments() {

    section('DATA GENERATION');

    log(
        'DATA',
        `Preparing ${DOCUMENT_COUNT.toLocaleString()} user documents...`,
        COLORS.data
    );

    const start = performance.now();

    const documents = new Array(DOCUMENT_COUNT);

    const progressInterval = 500;

    for (let i = 0; i < DOCUMENT_COUNT; i++) {

        documents[i] = createUser(i);

        if (
            (i + 1) % progressInterval === 0 ||
            i === DOCUMENT_COUNT - 1
        ) {

            log(
                'DATA',
                `Generated ${i + 1}/${DOCUMENT_COUNT}`,
                COLORS.data
            );

        }
    }

    const duration =
        performance.now() - start;

    log(
        'DATA',
        `Document generation completed in ${duration.toFixed(3)} ms`,
        COLORS.data
    );

    return documents;
}

// ============================================================
// BULK INSERT
// ============================================================

async function bulkInsert(users, documents) {

    section('BULK INSERT');

    log(
        'INSERT',
        `Preparing to insert ${documents.length.toLocaleString()} documents...`,
        COLORS.insert
    );

    const start = performance.now();

    log(
        'INSERT',
        'Calling insertManyAsync()...',
        COLORS.insert
    );

    const inserted =
        await users.insertManyAsync(documents);

    const duration =
        performance.now() - start;

    const count =
        Array.isArray(inserted)
            ? inserted.length
            : documents.length;

    const rate =
        count / (duration / 1000);

    log(
        'INSERT',
        'Bulk insertion completed',
        COLORS.insert
    );

    result(
        'Documents',
        count.toLocaleString()
    );

    result(
        'Duration',
        `${duration.toFixed(3)} ms`
    );

    result(
        'Insert rate',
        `${rate.toFixed(2)} documents/sec`
    );

    return {
        count,
        duration,
        rate
    };
}

// ============================================================
// SEQUENTIAL INSERT TEST
// ============================================================

async function sequentialInsertTest(users) {

    section('SEQUENTIAL INSERT TEST');

    const count = 100;

    log(
        'INSERT',
        `Testing ${count} individual insertAsync() calls...`,
        COLORS.insert
    );

    const start = performance.now();

    for (let i = 0; i < count; i++) {

        await users.insertAsync(
            createUser(
                i,
                'sequential'
            )
        );

        if (
            (i + 1) % 25 === 0 ||
            i === count - 1
        ) {

            log(
                'INSERT',
                `Sequential progress: ${i + 1}/${count}`,
                COLORS.insert
            );

        }
    }

    const duration =
        performance.now() - start;

    result(
        'Documents',
        count
    );

    result(
        'Duration',
        `${duration.toFixed(3)} ms`
    );

    result(
        'Average/document',
        `${(duration / count).toFixed(3)} ms`
    );

    result(
        'Rate',
        `${(count / (duration / 1000)).toFixed(2)} docs/sec`
    );

    return {
        count,
        duration
    };
}

// ============================================================
// CONCURRENT INSERT / RACE TEST
// ============================================================

async function concurrentInsertRace(users) {

    section('CONCURRENT WRITE / RACE TEST');

    log(
        'RACE',
        `Preparing ${RACE_INSERT_COUNT} concurrent insert operations...`,
        COLORS.race
    );

    const operations = [];

    const start = performance.now();

    for (let i = 0; i < RACE_INSERT_COUNT; i++) {

        operations.push(
            users.insertAsync(
                createUser(
                    i,
                    'race'
                )
            )
        );
    }

    log(
        'RACE',
        'All write promises created',
        COLORS.race
    );

    log(
        'RACE',
        'Waiting for Promise.all()...',
        COLORS.race
    );

    const results =
        await Promise.all(operations);

    const duration =
        performance.now() - start;

    log(
        'RACE',
        'All concurrent writes completed',
        COLORS.race
    );

    const inserted =
        results.length;

    result(
        'Requested',
        RACE_INSERT_COUNT
    );

    result(
        'Completed',
        inserted
    );

    result(
        'Missing',
        RACE_INSERT_COUNT - inserted
    );

    result(
        'Duration',
        `${duration.toFixed(3)} ms`
    );

    result(
        'Rate',
        `${(inserted / (duration / 1000)).toFixed(2)} docs/sec`
    );

    return {
        inserted,
        duration
    };
}

// ============================================================
// COUNT
// ============================================================

async function countDocuments(users) {

    section('COUNT TEST');

    const start = performance.now();

    log(
        'QUERY',
        'Counting all documents...',
        COLORS.query
    );

    const count =
        users.find({}).count();

    const duration =
        performance.now() - start;

    log(
        'QUERY',
        'Count completed',
        COLORS.query
    );

    result(
        'Documents',
        count
    );

    result(
        'Duration',
        `${duration.toFixed(3)} ms`
    );

    return {
        count,
        duration
    };
}

// ============================================================
// INDEXED LOOKUP
// ============================================================

async function indexedLookup(users) {

    section('INDEXED LOOKUP TEST');

    const username =
        `benchmark_user_${Math.floor(
            DOCUMENT_COUNT / 2
        )}`;

    log(
        'QUERY',
        'Starting indexed lookup...',
        COLORS.query
    );

    log(
        'QUERY',
        'Field: username',
        COLORS.query
    );

    log(
        'QUERY',
        'Index: YES',
        COLORS.index
    );

    log(
        'QUERY',
        `Searching for: ${username}`,
        COLORS.query
    );

    const start = performance.now();

    const document =
        users.findOne({
            username
        });

    const duration =
        performance.now() - start;

    log(
        'QUERY',
        document
            ? 'Document found'
            : 'Document NOT found',
        COLORS.query
    );

    result(
        'Duration',
        `${duration.toFixed(3)} ms`
    );

    return {
        document,
        duration
    };
}

// ============================================================
// NON-INDEXED LOOKUP
// ============================================================

async function nonIndexedLookup(users) {

    section('NON-INDEXED LOOKUP TEST');

    const index =
        Math.floor(DOCUMENT_COUNT / 2);

    const first =
        firstNames[index % firstNames.length];

    const last =
        lastNames[index % lastNames.length];

    const fullname =
        `${first} ${last} ${index}`;

    log(
        'QUERY',
        'Starting non-indexed lookup...',
        COLORS.query
    );

    log(
        'QUERY',
        'Field: fullname',
        COLORS.query
    );

    log(
        'QUERY',
        'Index: NO',
        COLORS.index
    );

    log(
        'QUERY',
        `Searching for: ${fullname}`,
        COLORS.query
    );

    const start = performance.now();

    const document =
        users.findOne({
            fullname
        });

    const duration =
        performance.now() - start;

    log(
        'QUERY',
        document
            ? 'Document found'
            : 'Document NOT found',
        COLORS.query
    );

    result(
        'Duration',
        `${duration.toFixed(3)} ms`
    );

    return {
        document,
        duration
    };
}

// ============================================================
// EMAIL INDEX LOOKUP
// ============================================================

async function emailLookup(users) {

    section('EMAIL INDEX LOOKUP');

    const index =
        Math.floor(DOCUMENT_COUNT / 2);

    const email =
        `benchmark${index}@example.test`;

    log(
        'QUERY',
        `Searching indexed email: ${email}`,
        COLORS.query
    );

    const start = performance.now();

    const document =
        users.findOne({
            email
        });

    const duration =
        performance.now() - start;

    log(
        'QUERY',
        document
            ? 'Email lookup successful'
            : 'Email lookup failed',
        COLORS.query
    );

    result(
        'Duration',
        `${duration.toFixed(3)} ms`
    );

    return {
        document,
        duration
    };
}

// ============================================================
// QUERY BUILDER TEST
// ============================================================

async function queryBuilderTest(users) {

    section('QUERY BUILDER TEST');

    log(
        'QUERY',
        'Testing sort()...',
        COLORS.query
    );

    let start = performance.now();

    const sorted =
        users
            .find({})
            .sort({
                age: -1
            })
            .toArray();

    let duration =
        performance.now() - start;

    result(
        'sort()',
        `${duration.toFixed(3)} ms`
    );

    log(
        'QUERY',
        'Testing limit()...',
        COLORS.query
    );

    start = performance.now();

    const limited =
        users
            .find({})
            .limit(10)
            .toArray();

    duration =
        performance.now() - start;

    result(
        'limit(10)',
        `${duration.toFixed(3)} ms`
    );

    log(
        'QUERY',
        'Testing skip()...',
        COLORS.query
    );

    start = performance.now();

    const skipped =
        users
            .find({})
            .skip(100)
            .limit(10)
            .toArray();

    duration =
        performance.now() - start;

    result(
        'skip(100)',
        `${duration.toFixed(3)} ms`
    );

    log(
        'QUERY',
        'Testing project()...',
        COLORS.query
    );

    start = performance.now();

    const projected =
        users
            .find({})
            .limit(10)
            .project({
                username: 1,
                email: 1,
                age: 1
            })
            .toArray();

    duration =
        performance.now() - start;

    result(
        'project()',
        `${duration.toFixed(3)} ms`
    );

    log(
        'QUERY',
        'Testing first()...',
        COLORS.query
    );

    start = performance.now();

    const first =
        users
            .find({})
            .first();

    duration =
        performance.now() - start;

    result(
        'first()',
        `${duration.toFixed(3)} ms`
    );

    return {
        sorted,
        limited,
        skipped,
        projected,
        first
    };
}

// ============================================================
// QUERY OPERATORS
// ============================================================

async function queryOperatorTest(users) {

    section('QUERY OPERATOR TESTS');

    const tests = [

        {
            name: '$gt',
            query: {
                age: {
                    $gt: 40
                }
            }
        },

        {
            name: '$gte',
            query: {
                age: {
                    $gte: 40
                }
            }
        },

        {
            name: '$lt',
            query: {
                age: {
                    $lt: 25
                }
            }
        },

        {
            name: '$lte',
            query: {
                age: {
                    $lte: 25
                }
            }
        },

        {
            name: '$in',
            query: {
                age: {
                    $in: [20, 25, 30]
                }
            }
        },

        {
            name: '$exists',
            query: {
                phone: {
                    $exists: true
                }
            }
        },

        {
            name: '$regex',
            query: {
                email: {
                    $regex: '@example\\.test$'
                }
            }
        },

        {
            name: '$or',
            query: {
                $or: [
                    {
                        age: 20
                    },
                    {
                        age: 30
                    }
                ]
            }
        }
    ];

    for (const test of tests) {

        log(
            'QUERY',
            `Testing ${test.name}...`,
            COLORS.query
        );

        const start =
            performance.now();

        const resultSet =
            users
                .find(test.query)
                .toArray();

        const duration =
            performance.now() - start;

        result(
            test.name,
            `${resultSet.length} results / ${duration.toFixed(3)} ms`
        );
    }
}

// ============================================================
// UPDATE TEST
// ============================================================

async function updateTest(users) {

    section('UPDATE TEST');

    const username =
        'benchmark_user_1750';

    log(
        'UPDATE',
        `Finding ${username}...`,
        COLORS.update
    );

    const start =
        performance.now();

    const updated =
        await users.updateOneAsync(
            {
                username
            },
            {
                $set: {
                    age: 30,
                    phone: '08099999999',
                    benchmarkUpdated: true
                },

                $inc: {
                    updateCount: 1
                }
            }
        );

    const duration =
        performance.now() - start;

    log(
        'UPDATE',
        updated
            ? 'Update successful'
            : 'Update failed',
        COLORS.update
    );

    result(
        'Duration',
        `${duration.toFixed(3)} ms`
    );

    return {
        updated,
        duration
    };
}

// ============================================================
// CONCURRENT $INC RACE TEST
// ============================================================

async function counterRaceTest(users) {

    section('CONCURRENT UPDATE / COUNTER RACE');

    const username =
        'race_counter_user';

    log(
        'RACE',
        'Creating race-counter document...',
        COLORS.race
    );

    await users.insertAsync({
        username,

        fullname: 'Race Counter User',

        email: 'race-counter@example.test',

        password: 'benchmark-only',

        age: 25,

        phone: '08000000000',

        benchmark: true,

        counter: 0
    });

    log(
        'RACE',
        `Launching ${RACE_COUNTER_COUNT} concurrent $inc operations...`,
        COLORS.race
    );

    const start =
        performance.now();

    const operations = [];

    for (
        let i = 0;
        i < RACE_COUNTER_COUNT;
        i++
    ) {

        operations.push(
            users.updateOneAsync(
                {
                    username
                },
                {
                    $inc: {
                        counter: 1
                    }
                }
            )
        );

    }

    log(
        'RACE',
        'All counter operations created',
        COLORS.race
    );

    await Promise.all(operations);

    const duration =
        performance.now() - start;

    const finalDocument =
        users.findOne({
            username
        });

    const expected =
        RACE_COUNTER_COUNT;

    const actual =
        finalDocument?.counter ?? null;

    const raceDetected =
        actual !== expected;

    result(
        'Expected counter',
        expected
    );

    result(
        'Actual counter',
        actual
    );

    result(
        'Duration',
        `${duration.toFixed(3)} ms`
    );

    result(
        'Race condition',
        raceDetected
            ? 'YES'
            : 'NO'
    );

    if (raceDetected) {

        log(
            'RACE',
            'WARNING: Expected and actual counters differ!',
            COLORS.error
        );

    } else {

        log(
            'RACE',
            'Counter result is correct',
            COLORS.race
        );

    }

    return {
        expected,
        actual,
        duration,
        raceDetected
    };
}

// ============================================================
// UPDATE MANY
// ============================================================

async function updateManyTest(users) {

    section('UPDATE MANY TEST');

    log(
        'UPDATE',
        'Updating benchmark users where age >= 40...',
        COLORS.update
    );

    const start =
        performance.now();

    const updated =
        await users.updateManyAsync(
            {
                age: {
                    $gte: 40
                }
            },
            {
                $set: {
                    ageGroup: '40-plus'
                }
            }
        );

    const duration =
        performance.now() - start;

    const count =
        Array.isArray(updated)
            ? updated.length
            : 0;

    result(
        'Updated documents',
        count
    );

    result(
        'Duration',
        `${duration.toFixed(3)} ms`
    );

    return {
        count,
        duration
    };
}

// ============================================================
// TRANSACTION TEST
// ============================================================

async function transactionTest(users) {

    section('TRANSACTION TEST');

    log(
        'TRANSACTION',
        'Creating transaction...',
        COLORS.transaction
    );

    const transaction =
        users.startTransaction();

    log(
        'TRANSACTION',
        'Queueing insert operation...',
        COLORS.transaction
    );

    transaction.insert({
        username: 'transaction_test_user',

        fullname: 'Transaction Test User',

        email: 'transaction@example.test',

        password: 'benchmark-only',

        age: 25,

        phone: '08011111111',

        benchmark: true
    });

    log(
        'TRANSACTION',
        'Queueing second insert operation...',
        COLORS.transaction
    );

    transaction.insert({
        username: 'transaction_test_user_2',

        fullname: 'Transaction Test User 2',

        email: 'transaction2@example.test',

        password: 'benchmark-only',

        age: 26,

        phone: '08022222222',

        benchmark: true
    });

    const start =
        performance.now();

    log(
        'TRANSACTION',
        'Committing transaction...',
        COLORS.transaction
    );

    const success =
        await transaction.commit();

    const duration =
        performance.now() - start;

    result(
        'Committed',
        success
    );

    result(
        'Duration',
        `${duration.toFixed(3)} ms`
    );

    return {
        success,
        duration
    };
}

// ============================================================
// INDEX REBUILD
// ============================================================

async function rebuildIndexTest(users) {

    section('INDEX REBUILD TEST');

    log(
        'INDEX',
        'Rebuilding collection indexes...',
        COLORS.index
    );

    const start =
        performance.now();

    const resultValue =
        users.rebuildIndexes();

    const duration =
        performance.now() - start;

    log(
        'INDEX',
        'Index rebuild completed',
        COLORS.index
    );

    result(
        'Result',
        resultValue
    );

    result(
        'Duration',
        `${duration.toFixed(3)} ms`
    );

    return {
        duration
    };
}

// ============================================================
// BACKUP TEST
// ============================================================

async function backupTest(db) {

    section('BACKUP TEST');

    const backupDirectory =
        path.join(
            __dirname,
            'benchmark-backups'
        );

    fs.mkdirSync(
        backupDirectory,
        {
            recursive: true
        }
    );

    log(
        'BACKUP',
        'Starting database backup...',
        COLORS.backup
    );

    const start =
        performance.now();

    const backupPath =
        await db.backupAsync(
            backupDirectory
        );

    const duration =
        performance.now() - start;

    log(
        'BACKUP',
        'Backup completed',
        COLORS.backup
    );

    result(
        'Backup path',
        backupPath
    );

    result(
        'Duration',
        `${duration.toFixed(3)} ms`
    );

    return {
        backupPath,
        duration
    };
}

// ============================================================
// VERIFICATION
// ============================================================

async function verificationTest(users) {

    section('FINAL DATA VERIFICATION');

    log(
        'VERIFY',
        'Counting benchmark documents...',
        COLORS.verify
    );

    const count =
        users
            .find({
                benchmark: true
            })
            .count();

    result(
        'Benchmark documents',
        count
    );

    log(
        'VERIFY',
        'Checking for missing benchmark IDs...',
        COLORS.verify
    );

    let missing = 0;

    for (
        let i = 0;
        i < DOCUMENT_COUNT;
        i++
    ) {

        const user =
            users.findOne({
                username:
                    `benchmark_user_${i}`
            });

        if (!user) {
            missing++;
        }
    }

    result(
        'Missing original documents',
        missing
    );

    log(
        'VERIFY',
        'Checking duplicate usernames...',
        COLORS.verify
    );

    const all =
        users
            .find({
                benchmark: true
            })
            .toArray();

    const usernames =
        new Set();

    let duplicates = 0;

    for (const user of all) {

        if (usernames.has(user.username)) {
            duplicates++;
        }

        usernames.add(user.username);
    }

    result(
        'Duplicate usernames',
        duplicates
    );

    return {
        count,
        missing,
        duplicates
    };
}

// ============================================================
// CLEANUP QUESTION
// ============================================================

function ask(question) {

    const rl =
        readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

    return new Promise(resolve => {

        rl.question(
            question,
            answer => {

                rl.close();

                resolve(
                    answer
                        .trim()
                        .toLowerCase()
                );

            }
        );

    });
}

// ============================================================
// CLEANUP
// ============================================================

async function cleanup(users) {

    section('CLEANUP');

    log(
        'CLEANUP',
        'Benchmark has finished.',
        COLORS.delete
    );

    const benchmarkCount =
        users
            .find({
                benchmark: true
            })
            .count();

    log(
        'CLEANUP',
        `There are ${benchmarkCount.toLocaleString()} benchmark documents.`,
        COLORS.delete
    );

    const answer =
        await ask(
            '\nDelete all benchmark documents? (yes/no): '
        );

    if (
        answer !== 'yes' &&
        answer !== 'y'
    ) {

        log(
            'CLEANUP',
            'Cleanup skipped. Benchmark data was kept.',
            COLORS.delete
        );

        return;
    }

    log(
        'DELETE',
        'Starting benchmark document deletion...',
        COLORS.delete
    );

    const start =
        performance.now();

    const deleted =
        await users.deleteManyAsync({
            benchmark: true
        });

    const duration =
        performance.now() - start;

    const deletedCount =
        Array.isArray(deleted)
            ? deleted.length
            : Number(deleted) || 0;

    log(
        'DELETE',
        'Benchmark deletion completed',
        COLORS.delete
    );

    result(
        'Deleted',
        deletedCount
    );

    result(
        'Duration',
        `${duration.toFixed(3)} ms`
    );

    log(
        'VERIFY',
        'Verifying cleanup...',
        COLORS.verify
    );

    const remaining =
        users
            .find({
                benchmark: true
            })
            .count();

    result(
        'Remaining',
        remaining
    );

    if (remaining === 0) {

        log(
            'VERIFY',
            'Cleanup successful. No benchmark documents remain.',
            COLORS.verify
        );

    } else {

        log(
            'VERIFY',
            `WARNING: ${remaining} benchmark documents remain.`,
            COLORS.error
        );

    }
}

// ============================================================
// MAIN
// ============================================================

async function main() {

    console.clear();

    console.log(
        `${BOLD}${COLORS.summary}` +
        `
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║          FILE-JSON-DB PERFORMANCE TEST                  ║
║                                                          ║
║              ${DOCUMENT_COUNT} DOCUMENT BENCHMARK                ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
` +
        RESET
    );

    const totalStart =
        performance.now();

    try {

        // ----------------------------------------------------
        // SETUP
        // ----------------------------------------------------

        const {
            db,
            users
        } = configureDatabase();

        // ----------------------------------------------------
        // GENERATION
        // ----------------------------------------------------

        const documents =
            await generateDocuments();

        // ----------------------------------------------------
        // BULK INSERT
        // ----------------------------------------------------

        const bulk =
            await bulkInsert(
                users,
                documents
            );

        // ----------------------------------------------------
        // SEQUENTIAL INSERT
        // ----------------------------------------------------

        const sequential =
            await sequentialInsertTest(
                users
            );

        // ----------------------------------------------------
        // CONCURRENT INSERT
        // ----------------------------------------------------

        const raceInsert =
            await concurrentInsertRace(
                users
            );

        // ----------------------------------------------------
        // COUNT
        // ----------------------------------------------------

        const count =
            await countDocuments(
                users
            );

        // ----------------------------------------------------
        // INDEXED LOOKUP
        // ----------------------------------------------------

        const indexed =
            await indexedLookup(
                users
            );

        // ----------------------------------------------------
        // NON INDEXED LOOKUP
        // ----------------------------------------------------

        const nonIndexed =
            await nonIndexedLookup(
                users
            );

        // ----------------------------------------------------
        // EMAIL INDEX
        // ----------------------------------------------------

        const email =
            await emailLookup(
                users
            );

        // ----------------------------------------------------
        // QUERY BUILDER
        // ----------------------------------------------------

        await queryBuilderTest(
            users
        );

        // ----------------------------------------------------
        // QUERY OPERATORS
        // ----------------------------------------------------

        await queryOperatorTest(
            users
        );

        // ----------------------------------------------------
        // UPDATE ONE
        // ----------------------------------------------------

        const update =
            await updateTest(
                users
            );

        // ----------------------------------------------------
        // UPDATE MANY
        // ----------------------------------------------------

        const updateMany =
            await updateManyTest(
                users
            );

        // ----------------------------------------------------
        // COUNTER RACE
        // ----------------------------------------------------

        const counterRace =
            await counterRaceTest(
                users
            );

        // ----------------------------------------------------
        // TRANSACTION
        // ----------------------------------------------------

        const transaction =
            await transactionTest(
                users
            );

        // ----------------------------------------------------
        // INDEX REBUILD
        // ----------------------------------------------------

        const rebuild =
            await rebuildIndexTest(
                users
            );

        // ----------------------------------------------------
        // BACKUP
        // ----------------------------------------------------

        const backup =
            await backupTest(
                db
            );

        // ----------------------------------------------------
        // VERIFICATION
        // ----------------------------------------------------

        const verification =
            await verificationTest(
                users
            );

        // ----------------------------------------------------
        // SUMMARY
        // ----------------------------------------------------

        const totalDuration =
            performance.now() -
            totalStart;

        section('PERFORMANCE SUMMARY');

        result(
            'Documents generated',
            DOCUMENT_COUNT
        );

        result(
            'Bulk insert',
            `${bulk.duration.toFixed(3)} ms`
        );

        result(
            'Bulk insert rate',
            `${bulk.rate.toFixed(2)} docs/sec`
        );

        result(
            'Sequential inserts',
            `${sequential.duration.toFixed(3)} ms`
        );

        result(
            'Concurrent inserts',
            `${raceInsert.duration.toFixed(3)} ms`
        );

        result(
            'Total document count',
            count.count
        );

        result(
            'Indexed username find',
            `${indexed.duration.toFixed(3)} ms`
        );

        result(
            'Non-indexed fullname find',
            `${nonIndexed.duration.toFixed(3)} ms`
        );

        result(
            'Indexed email find',
            `${email.duration.toFixed(3)} ms`
        );

        if (indexed.duration > 0) {

            result(
                'Non-indexed / indexed ratio',
                `${(
                    nonIndexed.duration /
                    indexed.duration
                ).toFixed(2)}x`
            );

        }

        result(
            'Update one',
            `${update.duration.toFixed(3)} ms`
        );

        result(
            'Update many',
            `${updateMany.duration.toFixed(3)} ms`
        );

        result(
            'Concurrent counter test',
            `${counterRace.duration.toFixed(3)} ms`
        );

        result(
            'Expected counter',
            counterRace.expected
        );

        result(
            'Actual counter',
            counterRace.actual
        );

        result(
            'Race condition',
            counterRace.raceDetected
                ? 'YES'
                : 'NO'
        );

        result(
            'Transaction',
            `${transaction.duration.toFixed(3)} ms`
        );

        result(
            'Index rebuild',
            `${rebuild.duration.toFixed(3)} ms`
        );

        result(
            'Backup',
            `${backup.duration.toFixed(3)} ms`
        );

        result(
            'Missing documents',
            verification.missing
        );

        result(
            'Duplicate usernames',
            verification.duplicates
        );

        result(
            'TOTAL BENCHMARK TIME',
            `${totalDuration.toFixed(3)} ms`
        );

        // ----------------------------------------------------
        // CLEANUP
        // ----------------------------------------------------

        await cleanup(users);

        section('TEST COMPLETE');

        log(
            'DONE',
            'file-json-db benchmark completed successfully.',
            COLORS.summary
        );

    } catch (error) {

        section('BENCHMARK ERROR');

        log(
            'ERROR',
            error.message,
            COLORS.error
        );

        console.error(error);

        process.exitCode = 1;
    }
}

// ============================================================
// START
// ============================================================

main();
