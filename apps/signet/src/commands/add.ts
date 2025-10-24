import readline from 'readline';
import { nip19 } from 'nostr-tools';
import { encryptSecret } from '../config/keyring.js';
import { loadConfig, saveConfig } from '../config/config.js';

type AddKeyOptions = {
    configPath: string;
    keyName: string;
};

function ask(prompt: string, rl: readline.Interface): Promise<string> {
    return new Promise((resolve) => rl.question(prompt, resolve));
}

export async function addKey(options: AddKeyOptions): Promise<void> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    try {
        console.log('Keys stored on disk are encrypted with a passphrase.');
        console.log('You will need the same passphrase whenever the bunker restarts.');

        const passphrase = await ask('Passphrase: ', rl);
        const secret = await ask(`nsec for ${options.keyName}: `, rl);

        try {
            const decoded = nip19.decode(secret.trim());
            if (decoded.type !== 'nsec') {
                throw new Error('Provided value is not an nsec.');
            }
        } catch (err) {
            console.error(`Invalid nsec: ${(err as Error).message}`);
            process.exit(1);
        }

        const encrypted = encryptSecret(secret.trim(), passphrase);
        const config = await loadConfig(options.configPath);
        config.keys[options.keyName] = encrypted;
        await saveConfig(options.configPath, config);

        console.log(`Key "${options.keyName}" stored successfully.`);
    } finally {
        rl.close();
    }
}
