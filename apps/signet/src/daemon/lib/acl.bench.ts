// Throughput benchmark for the per-request authorization (ACL) decision.
//
// Every inbound request passes through checkRequestPermission. Even on the "cached"
// path (KeyUser trust/suspension state served from the in-memory ACL cache) it still
// performs one indexed SigningCondition lookup; on a cold path it also does a KeyUser
// lookup + an explicit-deny lookup. This benchmark measures the cost of those indexed
// SQLite lookups so the authorization floor can be placed next to the inbound-crypto
// floor (~1.16 ms / ~860 req/s cached — see inbound-crypto.bench.ts).
//
// What this measures: the raw SQLite engine cost of the gate's queries against an
// in-memory database carrying the same indexes the Prisma schema defines (the unique
// (keyName,userPubkey) on KeyUser and (keyUserId) on SigningCondition).
//
// What it does NOT capture: Prisma's per-query overhead (query building/serialization,
// typically tens of microseconds) and disk/WAL latency (daemon reads are served from
// the SQLite page cache, close to in-memory speed). So treat the absolute numbers as an
// optimistic floor — the point is the order-of-magnitude comparison against the crypto
// path, which dominates per-request cost.

import { bench, describe } from 'vitest'
import Database from 'better-sqlite3'

const db = new Database(':memory:')

db.exec(`
  CREATE TABLE KeyUser (
    id INTEGER PRIMARY KEY,
    keyName TEXT NOT NULL,
    userPubkey TEXT NOT NULL,
    revokedAt TEXT,
    suspendedAt TEXT,
    suspendUntil TEXT,
    trustLevel TEXT NOT NULL
  );
  CREATE UNIQUE INDEX ux_keyuser ON KeyUser(keyName, userPubkey);
  CREATE TABLE SigningCondition (
    id INTEGER PRIMARY KEY,
    keyUserId INTEGER,
    method TEXT,
    kind TEXT,
    allowed INTEGER
  );
  CREATE INDEX ix_cond ON SigningCondition(keyUserId);
`)

const KEY = 'bench-key'
const PUB = 'bench-pub'
db.prepare(`INSERT INTO KeyUser (id, keyName, userPubkey, trustLevel) VALUES (1, ?, ?, 'full')`).run(KEY, PUB)
db.prepare(`INSERT INTO SigningCondition (keyUserId, method, kind, allowed) VALUES (1, 'sign_event', 'all', 1)`).run()

// Statements mirroring the queries checkRequestPermission issues (prepared once, as
// Prisma also caches prepared statements).
const selKeyUser = db.prepare(
  `SELECT id, revokedAt, suspendedAt, suspendUntil, trustLevel FROM KeyUser WHERE keyName = ? AND userPubkey = ?`
)
const selDeny = db.prepare(
  `SELECT id FROM SigningCondition WHERE keyUserId = ? AND method = '*' AND allowed = 0 LIMIT 1`
)
const selCondition = db.prepare(
  `SELECT id, allowed FROM SigningCondition WHERE keyUserId = ? AND method = ? AND kind IN ('all', ?) LIMIT 1`
)

describe('ACL decision: indexed SQLite lookup cost', () => {
  bench('KeyUser lookup (unique index)', () => {
    selKeyUser.get(KEY, PUB)
  })

  bench('SigningCondition lookup (keyUserId index, sign_event/kind)', () => {
    selCondition.get(1, 'sign_event', '1')
  })

  // The hot path once an app's trust/suspension state is in the in-memory ACL cache:
  // a single indexed SigningCondition lookup for the method/kind.
  bench('cached ACL decision (1 indexed query)', () => {
    selCondition.get(1, 'sign_event', '1')
  })

  // The cold path (cache miss): KeyUser fetch + explicit-deny check + condition lookup.
  bench('uncached ACL decision (KeyUser + deny + condition)', () => {
    selKeyUser.get(KEY, PUB)
    selDeny.get(1)
    selCondition.get(1, 'sign_event', '1')
  })
})
