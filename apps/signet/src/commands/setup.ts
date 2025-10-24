import readline from 'readline';
import { loadConfig, saveConfig } from '../config/config.js';

function ask(question: string, rl: readline.Interface): Promise<string> {
    return new Promise((resolve) => rl.question(question, resolve));
}

export async function runSetup(configPath: string): Promise<void> {
    const config = await loadConfig(configPath);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    try {
        console.log('Enter at least one administrator npub to manage your bunker remotely.');
        const npub = (await ask('Administrator npub: ', rl)).trim();

        if (!npub) {
            console.log('No npub provided. Configuration left unchanged.');
            return;
        }

        if (!config.admin.npubs.includes(npub)) {
            config.admin.npubs.push(npub);
            await saveConfig(configPath, config);
            console.log('Administrator added.');
        } else {
            console.log('That npub is already configured.');
        }
    } finally {
        rl.close();
    }
}
