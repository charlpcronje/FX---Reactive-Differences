# fx-orm

Zero-latency database/ORM with CSS-style queries, reactive autosave, and lazy hydration. The entire API surface is synchronous -- async I/O is handled internally via `FXSuspend` and Worker + SharedArrayBuffer on the client.

## Quick start

```ts
import ormPlugin from './plugins/fx-orm';

const $db = ormPlugin(fx, {
  defaultConnectionString: 'mock://',
  autosaveDebounceMs: 600,
  connectionStream: {
    baseUrl: 'http://localhost:3000/api/db',
  }
});

// $db is also available globally
```

## Connecting

```ts
$db.connect('mock://');                          // built-in mock adapter
$db.connect('indexeddb://mydb');                  // browser IndexedDB
$db.connect('postgres://user:pass@host/db');     // server-side (Deno)
```

## Querying with CSS-style selectors

The query language uses CSS-like syntax:

```ts
// By ID
$db.users.select('#42');           // user with id = 42

// By class (status)
$db.users.select('.active');       // users with status = "active"

// Attribute selectors
$db.users.select('[age>25]');      // age > 25
$db.users.select('[name^=Al]');    // name starts with "Al"
$db.users.select('[name*=ice]');   // name contains "ice"
$db.users.select('[role~=admin]'); // role IN (...)

// Pseudo-selectors
$db.users.select(':first');        // first record
$db.users.select(':last');         // last record
$db.users.select(':limit(10)');    // limit to 10
$db.users.select(':offset(20)');   // skip 20
$db.users.select(':orderBy(name,asc)');
$db.users.select(':includes(posts,comments)');

// Combine them
$db.users.select('[age>18].active:orderBy(name):limit(10)');
```

## Table interface

```ts
const users = $db.users;           // or $db.table('users')

// Convenience methods
users.all();                       // all records
users.first();                     // first record
users.find('[age>30]');            // filtered
users.where('age>30');             // same as find
users.create({ name: 'Bob', age: 25 }); // insert, returns id
users[42];                         // record by id
```

## Virtual results and lazy hydration

Queries return a `VirtualResult` -- initially just a list of IDs. Data is fetched on demand when you access fields:

```ts
const result = $db.users.select('[age>18]:limit(5)');

result.length;        // 5 (known immediately)
result.first().name;  // triggers lazy load of row data
result[2].email;      // triggers load for row 2

// Iteration
for (const user of result) {
  console.log(user.name); // each row loads on access
}
```

### Smart batch loading

When you access one unloaded row, the ORM batches all pending unloaded rows into a single bulk fetch (N+1 prevention).

## Reactive autosave

Mutating a row's fields triggers a debounced sync back to the database:

```ts
const user = $db.users[42];
user.name = 'Alice';           // schedules autosave after 600ms
user.email = 'alice@new.com';  // resets the debounce timer
```

FX node watchers also trigger autosave when external code modifies the backing FX node.

## Fuzzy table matching

Table names are fuzzy-matched, so `$db.user`, `$db.users`, and `$db.Users` all resolve to the `users` table.

## Adapters

| Adapter | Environment | Description |
|---------|-------------|-------------|
| `MockAdapter` | Any | In-memory store with pre-seeded data, for testing |
| `IndexedDBSyncAdapter` | Browser | Browser-native IndexedDB |
| Server adapters | Deno | Postgres, MySQL, SQLite (via connection string) |

## Configuration

```ts
ormPlugin(fx, {
  type: 'mock',
  global: '$db',
  defaultConnectionString: 'mock://',
  autosaveDebounceMs: 600,
  connectionStream: {
    baseUrl: 'http://localhost:3000/api/db',
    headers: { Authorization: 'Bearer ...' },
    routes: {
      plan: '/plan',
      row: '/row',
      rowBulk: '/row-bulk',
      update: '/update',
      insert: '/insert'
    }
  }
});
```

## How sync works

- **Server (Deno):** Queries execute directly against the local adapter (synchronous or FXSuspend).
- **Client (browser):** Queries are sent to the `connectionStream` endpoint via `SyncRPC`, which uses a Web Worker + SharedArrayBuffer + Atomics to provide a synchronous call surface. On the UI thread, if blocking would cause a hang, `FXSuspend` is thrown instead.
