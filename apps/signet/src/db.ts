import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const DEFAULT_DB_PATH = join(homedir(), '.signet-config', 'signet.db');

/**
 * Normalize DATABASE_URL to a file path.
 * - Strips 'file:' prefix if present
 * - Uses default path (~/.signet-config/signet.db) if not specified
 * - In Docker: normalizes ~/.signet-config paths to /app/config
 * - In local dev (SIGNET_LOCAL=1): uses path as-is
 */
function normaliseDatabasePath(url: string | undefined): string {
    if (!url || url.trim() === '') {
        return DEFAULT_DB_PATH;
    }

    // Strip file: prefix if present
    let path = url.startsWith('file:') ? url.slice(5) : url;

    // In local development mode, use path as-is
    if (process.env.SIGNET_LOCAL === '1' || process.env.NODE_ENV === 'development') {
        return path;
    }

    // In Docker: map ~/.signet-config to /app/config (mounted volume)
    if (path.includes('.signet-config')) {
        const match = path.match(/\.signet-config(.*)$/);
        if (match) {
            return `/app/config${match[1]}`;
        }
    }

    // Relative paths go under /app
    if (!path.startsWith('/')) {
        return `/app/${path.replace(/^\.\//, '')}`;
    }

    return path;
}

const dbPath = normaliseDatabasePath(process.env.DATABASE_URL);

if (dbPath !== process.env.DATABASE_URL) {
    console.log(`Using database: ${dbPath}`);
}

// Ensure database directory exists
const dir = dirname(dbPath);
if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
}

// Prisma 7 with client engine requires driver adapter.
// timeout = SQLite busy_timeout: wait up to 5s for a lock rather than failing
// immediately with SQLITE_BUSY when a read and write briefly contend.
const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}`, timeout: 5000 });
const prisma = new PrismaClient({ adapter });

/**
 * Apply connection pragmas. Call once at startup before serving requests.
 * - WAL: readers no longer block the writer (and vice-versa), which matters because
 *   better-sqlite3 calls are synchronous and run inside the request hot path
 *   (ACL lookups, per-response keyUser lookup, log writes). WAL is persisted in the
 *   database file, but we set it on every boot so a fresh/copied DB gets it too.
 * - synchronous=NORMAL: the recommended durability/throughput trade-off under WAL
 *   (safe against corruption; at most the last transaction can be lost on power loss).
 */
export async function applyDatabasePragmas(): Promise<void> {
    await prisma.$executeRawUnsafe('PRAGMA journal_mode=WAL;');
    await prisma.$executeRawUnsafe('PRAGMA synchronous=NORMAL;');
    await prisma.$executeRawUnsafe('PRAGMA busy_timeout=5000;');
}

export default prisma;
