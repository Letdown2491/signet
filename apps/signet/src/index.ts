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
                    // Declared as `encrypt` with a default of `true` rather than
                    // as `no-encrypt`. yargs implements `--no-*` as boolean
                    // negation, so an option literally named `no-encrypt` can
                    // never be reached: `--no-encrypt` is parsed as
                    // `encrypt: false`, and strict mode then rejects the name it
                    // actually received ("Unknown argument: encrypt").
                    // Contradictory flag combinations are rejected in
                    // commands/add.ts, since `conflicts` can no longer express
                    // them (this option always has a value).
                    .option('encrypt', {
                        type: 'boolean',
                        default: true,
                        describe:
                            'Encrypt the stored key (use --no-encrypt to store it unencrypted; not recommended)',
                    })
                    .option('nip49', {
                        type: 'boolean',
                        describe: 'Use NIP-49 encryption (recommended)',
                        conflicts: ['legacy'],
                    })
                    .option('legacy', {
                        type: 'boolean',
                        describe: 'Use legacy AES-256-GCM encryption',
                        conflicts: ['nip49'],
                    }),
            async (argv) => {
                await addKey({
                    configPath: argv.config as string,
                    keyName: argv.name as string,
                    noEncrypt: argv.encrypt === false,
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
