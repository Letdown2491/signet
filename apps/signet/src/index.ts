#!/usr/bin/env node
import 'websocket-polyfill';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { runSetup } from './commands/setup.js';
import { addKey } from './commands/add.js';
import { runStart } from './commands/start.js';

function parseEnvAdmins(): string[] {
    const raw = process.env.ADMIN_NPUBS;
    if (!raw) {
        return [];
    }

    return raw
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
}

yargs(hideBin(process.argv))
    .scriptName('signet')
    .option('config', {
        alias: 'c',
        type: 'string',
        default: 'config/signet.json',
        describe: 'Path to the configuration file',
    })
    .command(
        'setup',
        'Add an administrator npub',
        () => {},
        async (argv) => {
            await runSetup(argv.config as string);
        }
    )
    .command(
        'add',
        'Encrypt and store an nsec',
        (command) =>
            command.option('name', {
                alias: 'n',
                type: 'string',
                demandOption: true,
                describe: 'Key label to store the nsec under',
            }),
        async (argv) => {
            await addKey({
                configPath: argv.config as string,
                keyName: argv.name as string,
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
                .option('admin', {
                    alias: 'a',
                    type: 'string',
                    array: true,
                    describe: 'Administrator npub',
                })
                .option('verbose', {
                    alias: 'v',
                    type: 'boolean',
                    default: false,
                    describe: 'Enable verbose logging',
                }),
        async (argv) => {
            const providedAdmins = argv.admin ? (argv.admin as string[]) : [];
            const envAdmins = parseEnvAdmins();
            const combinedAdmins = Array.from(
                new Set([...providedAdmins, ...envAdmins])
            );

            await runStart({
                configPath: argv.config as string,
                keyNames: argv.key ? (argv.key as string[]) : undefined,
                verbose: Boolean(argv.verbose),
                adminNpubs: combinedAdmins.length ? combinedAdmins : undefined,
            });
        }
    )
    .demandCommand(1, 'Specify a command to run.')
    .strict()
    .help()
    .parse();
