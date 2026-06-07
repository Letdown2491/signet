const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DB_BACKUPS_TO_KEEP = 5;

function ensureConfigFolder() {
    const target = path.resolve(process.cwd(), 'config');
    if (!fs.existsSync(target)) {
        fs.mkdirSync(target, { recursive: true });
    }
}

function resolveDbPath() {
    const url = process.env.DATABASE_URL;
    if (!url || !url.trim()) {
        return path.join(os.homedir(), '.signet-config', 'signet.db');
    }
    return url.startsWith('file:') ? url.slice(5) : url;
}

function pruneBackups(dir, base) {
    const prefix = `${base}.backup-`;
    // Timestamped names sort chronologically; drop everything but the newest N.
    const backups = fs.readdirSync(dir).filter((f) => f.startsWith(prefix)).sort();
    for (const f of backups.slice(0, Math.max(0, backups.length - DB_BACKUPS_TO_KEEP))) {
        try { fs.unlinkSync(path.join(dir, f)); } catch { /* best effort */ }
    }
}

// Snapshot the database before applying migrations so a bad migration can be rolled back.
function backupDatabase() {
    try {
        const dbPath = resolveDbPath();
        if (!fs.existsSync(dbPath)) {
            return; // Fresh install, nothing to back up
        }
        const dir = path.dirname(dbPath);
        const base = path.basename(dbPath);
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const suffix = `.backup-${stamp}`;
        // Copy the main DB plus any WAL/SHM sidecar files for a consistent snapshot.
        for (const ext of ['', '-wal', '-shm']) {
            const src = `${dbPath}${ext}`;
            if (fs.existsSync(src)) {
                fs.copyFileSync(src, `${dir}/${base}${ext}${suffix}`);
            }
        }
        console.log(`Backed up database to ${dbPath}${suffix}`);
        pruneBackups(dir, base);
    } catch (err) {
        console.warn(`Database backup failed (continuing): ${err.message}`);
    }
}

function runMigrations() {
    console.log('Running database migrations…');
    const appDir = path.resolve(__dirname, '..');
    const prisma = path.join(appDir, 'node_modules', '.bin', 'prisma');
    const result = spawnSync(prisma, ['migrate', 'deploy'], {
        stdio: 'inherit',
        cwd: appDir,
    });

    if (result.status !== 0) {
        console.warn('Migrations exited with a non-zero status.');
    }
}

ensureConfigFolder();
backupDatabase();
runMigrations();

const args = process.argv.slice(2);
const daemon = spawn('node', ['./dist/index.js', ...args], {
    stdio: 'inherit',
    env: process.env,
});

daemon.on('exit', (code) => {
    process.exit(code ?? 0);
});
