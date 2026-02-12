import readline from 'readline';
import { nip19 } from 'nostr-tools';
import { encryptSecret, encryptNip49, decryptNip49, isNcryptsec } from '../config/keyring.js';
import { loadConfig, saveConfig } from '../config/config.js';

type AddKeyOptions = {
    configPath: string;
    keyName: string;
    noEncrypt?: boolean;
    useNip49?: boolean;
    useLegacy?: boolean;
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
        const secret = await ask(`nsec or ncryptsec for ${options.keyName}: `, rl);
        const trimmedSecret = secret.trim();

        // Check if importing an ncryptsec
        if (isNcryptsec(trimmedSecret)) {
            // Cannot use encryption flags with ncryptsec input
            if (options.noEncrypt || options.useNip49 || options.useLegacy) {
                console.error('Cannot use encryption flags with ncryptsec input (already encrypted).');
                process.exit(1);
            }

            console.log('Detected NIP-49 encrypted key (ncryptsec).');
            const passphrase = await ask('Enter passphrase to verify: ', rl);

            // Verify the passphrase by attempting to decrypt
            try {
                decryptNip49(trimmedSecret, passphrase);
            } catch (err) {
                console.error(`Invalid passphrase or corrupted ncryptsec: ${(err as Error).message}`);
                process.exit(1);
            }

            // Store the ncryptsec directly
            const config = await loadConfig(options.configPath);
            config.keys[options.keyName] = { ncryptsec: trimmedSecret };
            await saveConfig(options.configPath, config);

            console.log(`Key "${options.keyName}" stored successfully (NIP-49 encrypted).`);
            return;
        }

        // Regular nsec import
        try {
            const decoded = nip19.decode(trimmedSecret);
            if (decoded.type !== 'nsec') {
                throw new Error('Provided value is not an nsec or ncryptsec.');
            }
        } catch (err) {
            console.error(`Invalid key: ${(err as Error).message}`);
            process.exit(1);
        }

        // Determine encryption format from flags or interactive prompt
        let encryptionChoice: 'none' | 'nip49' | 'legacy';

        if (options.noEncrypt) {
            encryptionChoice = 'none';
        } else if (options.useNip49) {
            encryptionChoice = 'nip49';
        } else if (options.useLegacy) {
            encryptionChoice = 'legacy';
        } else {
            // Interactive prompt
            console.log('\nEncryption:');
            console.log('  1. None (auto-unlock on startup, not recommended)');
            console.log('  2. NIP-49 (recommended)');
            console.log('  3. Legacy');
            const choice = await ask('\nSelect [1-3, default 2]: ', rl);
            const choiceNum = choice.trim() === '' ? 2 : parseInt(choice.trim(), 10);

            if (choiceNum === 1) {
                encryptionChoice = 'none';
            } else if (choiceNum === 3) {
                encryptionChoice = 'legacy';
            } else {
                encryptionChoice = 'nip49';
            }
        }

        const config = await loadConfig(options.configPath);

        if (encryptionChoice === 'none') {
            // Store unencrypted
            config.keys[options.keyName] = { key: trimmedSecret };
            await saveConfig(options.configPath, config);
            console.log(`Key "${options.keyName}" stored successfully (unencrypted).`);
            console.log('Warning: Key will auto-unlock on daemon startup. Consider using encryption.');
        } else {
            // Get passphrase for encryption
            const passphrase = await ask('Passphrase: ', rl);
            const confirmPassphrase = await ask('Confirm passphrase: ', rl);

            if (passphrase !== confirmPassphrase) {
                console.error('Passphrases do not match.');
                process.exit(1);
            }

            if (encryptionChoice === 'nip49') {
                // Convert nsec to hex and encrypt with NIP-49
                const decoded = nip19.decode(trimmedSecret);
                const secretHex = Buffer.from(decoded.data as Uint8Array).toString('hex');
                const ncryptsec = encryptNip49(secretHex, passphrase);
                config.keys[options.keyName] = { ncryptsec };
                await saveConfig(options.configPath, config);
                console.log(`Key "${options.keyName}" stored successfully (NIP-49 encrypted).`);
            } else {
                // Use legacy encryption
                const encrypted = encryptSecret(trimmedSecret, passphrase);
                config.keys[options.keyName] = encrypted;
                await saveConfig(options.configPath, config);
                console.log(`Key "${options.keyName}" stored successfully (legacy encrypted).`);
            }
        }
    } finally {
        rl.close();
    }
}
