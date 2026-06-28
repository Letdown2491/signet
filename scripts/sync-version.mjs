#!/usr/bin/env node

/**
 * Syncs the version from the root VERSION file to all package.json files.
 *
 * Usage: node scripts/sync-version.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// Read version from VERSION file
const versionFile = join(repoRoot, 'VERSION');
const version = readFileSync(versionFile, 'utf-8').trim();

console.log(`Syncing version: ${version}`);

// List of package.json files to update
const packageFiles = [
    'package.json',
    'apps/signet/package.json',
    'apps/signet-ui/package.json',
    'apps/signet-extension/package.json',
    'packages/signet-types/package.json',
];

for (const file of packageFiles) {
    const filePath = join(repoRoot, file);
    try {
        const pkg = JSON.parse(readFileSync(filePath, 'utf-8'));
        const oldVersion = pkg.version;
        pkg.version = version;
        writeFileSync(filePath, JSON.stringify(pkg, null, 2) + '\n');
        console.log(`  ${file}: ${oldVersion} -> ${version}`);
    } catch (err) {
        console.error(`  ${file}: Failed to update - ${err.message}`);
    }
}

console.log('Done!');
