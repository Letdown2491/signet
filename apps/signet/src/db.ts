import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { PrismaClient } from '@prisma/client';

const DEFAULT_DB_URL = 'file:/app/config/signet.db';

const normaliseDatabaseUrl = (url: string | undefined): string => {
    if (!url || url.trim() === '') {
        return DEFAULT_DB_URL;
    }

    if (!url.startsWith('file:')) {
        return url;
    }

    let path = url.slice('file:'.length);

    const scopedReplacements: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
        [/^\$HOME\/\.signet-config(.*)$/i, (match) => `/app/config${match[1]}`],
        [/^\${HOME}\/\.signet-config(.*)$/i, (match) => `/app/config${match[1]}`],
        [/^~\/\.signet-config(.*)$/i, (match) => `/app/config${match[1]}`],
        [/^~\/(.*)$/i, (match) => `/app/config/${match[1]}`],
        [/^\.\/\.signet-config(.*)$/i, (match) => `/app/config${match[1]}`],
        [/^\.signet-config(.*)$/i, (match) => `/app/config${match[1]}`],
        [/^\/.+\.signet-config(.*)$/i, (match) => `/app/config${match[1]}`],
    ];

    for (const [pattern, builder] of scopedReplacements) {
        const exec = path.match(pattern);
        if (exec) {
            path = builder(exec);
            break;
        }
    }

    if (!path.startsWith('/')) {
        path = `/app/${path.replace(/^\.?\//, '')}`;
    }

    return `file:${path}`;
};

const resolvedUrl = normaliseDatabaseUrl(process.env.DATABASE_URL);

if (resolvedUrl !== process.env.DATABASE_URL) {
    console.log(`ℹ️ Using database location ${resolvedUrl}`);
    process.env.DATABASE_URL = resolvedUrl;
}

if (resolvedUrl.startsWith('file:')) {
    const fsPath = resolvedUrl.slice('file:'.length);
    const dir = dirname(fsPath);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}

const prisma = new PrismaClient();

export default prisma;
