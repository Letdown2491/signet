import axios from 'axios';
import createDebug from 'debug';
import type { WalletConfig, LnBitsWalletConfig } from '../../../../config/types.js';

const debug = createDebug('signet:wallet');

export async function createWalletForUser(
    walletConfig: WalletConfig,
    username: string,
    domain: string,
    npub: string
): Promise<string | undefined> {
    if (walletConfig.lnbits) {
        return createLnBitsWallet(walletConfig.lnbits, username, domain, npub);
    }

    return undefined;
}

async function createLnBitsWallet(
    cfg: LnBitsWalletConfig,
    username: string,
    domain: string,
    npub: string
): Promise<string | undefined> {
    const apiUrl = new URL(cfg.url);
    apiUrl.pathname = '/usermanager/api/v1/users';

    debug('Creating LNbits wallet for %s@%s via %s', username, domain, apiUrl.toString());

    const response = await axios.post(
        apiUrl.toString(),
        {
            user_name: username,
            wallet_name: `${username}@${domain}`,
        },
        {
            headers: {
                'X-Api-Key': cfg.key,
            },
        }
    );

    const wallet = response.data.wallets?.[0];
    if (!wallet?.inkey) {
        throw new Error('LNbits response did not include invoice key.');
    }

    return registerLnAddress(
        username,
        domain,
        wallet.inkey,
        npub,
        cfg.url,
        cfg.nostdressUrl
    );
}

async function registerLnAddress(
    username: string,
    domain: string,
    userInvoiceKey: string,
    npub: string,
    host: string,
    nostdressUrl: string
): Promise<string> {
    const payload = new URLSearchParams();
    payload.set('name', username);
    payload.set('domain', domain);
    payload.set('kind', 'lnbits');
    payload.set('host', host);
    payload.set('key', userInvoiceKey);
    payload.set('pin', ' ');
    payload.set('npub', npub);
    payload.set('currentName', ' ');

    const target = new URL(nostdressUrl);
    target.pathname = '/api/easy/';

    debug('Registering LN address on %s', target.toString());
    await axios.post(target.toString(), payload, {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
    });

    return `${username}@${domain}`;
}
