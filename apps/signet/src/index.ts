#!/usr/bin/env node
import 'websocket-polyfill';
import { homedir } from 'os';
import { join } from 'path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { addKey } from './commands/add.js';
import { runStart } from './commands/start.js';

const defaultConfigPath = join(homedir(), '.signet-config', 'signet.json');

async function main() {
    await yargs(hideBin(process.argv))
        .scriptName('signet')
        .option('config', {
            alias: 'c',
            type: 'string',
            default: defaultConfigPath,
            describe: 'Path to the configuration file',
        })
        .command(
            'add',
            'Add a key (nsec or ncryptsec)',
            (command) =>
                command
                    .option('name', {
                        alias: 'n',
                        type: 'string',
                        demandOption: true,
                        describe: 'Key label to store the key under',
                    })
                    .option('no-encrypt', {
                        type: 'boolean',
                        describe: 'Store key without encryption (not recommended)',
                        conflicts: ['nip49', 'legacy'],
                    })
                    .option('nip49', {
                        type: 'boolean',
                        describe: 'Use NIP-49 encryption (recommended)',
                        conflicts: ['no-encrypt', 'legacy'],
                    })
                    .option('legacy', {
                        type: 'boolean',
                        describe: 'Use legacy AES-256-GCM encryption',
                        conflicts: ['no-encrypt', 'nip49'],
                    }),
            async (argv) => {
                await addKey({
                    configPath: argv.config as string,
                    keyName: argv.name as string,
                    noEncrypt: argv['no-encrypt'] as boolean | undefined,
                    useNip49: argv.nip49 as boolean | undefined,
                    useLegacy: argv.legacy as boolean | undefined,
                });
            }
        )
        .command(
            'start',
            'Start the Signet daemon',
            (command) =>
                command
                    .option('key', {
                        type: 'string',
                        array: true,
                        describe: 'Key label to unlock at startup',
                    })
                    .option('verbose', {
                        alias: 'v',
                        type: 'boolean',
                        default: false,
                        describe: 'Enable verbose logging',
                    }),
            async (argv) => {
                await runStart({
                    configPath: argv.config as string,
                    keyNames: argv.key ? (argv.key as string[]) : undefined,
                    verbose: Boolean(argv.verbose),
                });
            }
        )
        .demandCommand(1, 'Specify a command to run.')
        .strict()
        .help()
        .parse();
}

main().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
});
