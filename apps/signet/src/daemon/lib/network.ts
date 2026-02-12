import os from 'os';
import fs from 'fs';
import QRCode from 'qrcode';
import { logger } from './logger.js';

/**
 * Interface patterns to filter out (virtual/container interfaces)
 */
const VIRTUAL_INTERFACE_PATTERNS = [
    /^docker/,
    /^br-/,
    /^veth/,
    /^virbr/,
    /^vboxnet/,
    /^vmnet/,
    /^lo$/,
];

/**
 * Check if an interface name matches a virtual interface pattern
 */
function isVirtualInterface(name: string): boolean {
    return VIRTUAL_INTERFACE_PATTERNS.some(pattern => pattern.test(name));
}

/**
 * Check if an IP address is in the Tailscale CGNAT range (100.64.0.0/10)
 * Tailscale uses 100.64.0.0 - 100.127.255.255
 */
function isTailscaleAddress(ip: string): boolean {
    const parts = ip.split('.');
    if (parts.length !== 4) return false;

    const firstOctet = parseInt(parts[0], 10);
    const secondOctet = parseInt(parts[1], 10);

    return firstOctet === 100 && secondOctet >= 64 && secondOctet <= 127;
}

/**
 * Get a human-readable label for an IP address
 */
function getAddressLabel(ip: string): string {
    if (isTailscaleAddress(ip)) {
        return 'Tailscale';
    }
    return 'Local';
}

/**
 * Check if we're running inside a Docker container
 */
function isRunningInContainer(): boolean {
    try {
        // Check for Docker
        if (fs.existsSync('/.dockerenv')) {
            return true;
        }
        // Check for Podman/other container runtimes
        if (fs.existsSync('/run/.containerenv')) {
            return true;
        }
        return false;
    } catch {
        return false;
    }
}

export interface LocalAddress {
    address: string;
    interface: string;
    label: string;
}

/**
 * Get local network IPv4 addresses, filtering out loopback and virtual interfaces.
 * Returns addresses that are likely reachable from other devices on the network.
 */
export function getLocalAddresses(): LocalAddress[] {
    const interfaces = os.networkInterfaces();
    const addresses: LocalAddress[] = [];

    for (const [name, nets] of Object.entries(interfaces)) {
        if (!nets || isVirtualInterface(name)) {
            continue;
        }

        for (const net of nets) {
            // Skip internal (loopback) and non-IPv4
            if (net.internal || net.family !== 'IPv4') {
                continue;
            }

            addresses.push({
                address: net.address,
                interface: name,
                label: getAddressLabel(net.address),
            });
        }
    }

    return addresses;
}

/**
 * Print server startup information including local URLs and optionally a QR code.
 */
export async function printServerInfo(host: string, port: number): Promise<void> {
    logger.info('HTTP server listening', { port, host });

    // In containers, the container's IP isn't useful for external connections
    if (isRunningInContainer()) {
        logger.info('Running in container', { url: `http://localhost:${port}` });
        return;
    }

    const addresses = getLocalAddresses();

    if (addresses.length === 0) {
        logger.info('Local address', { url: `http://localhost:${port}` });
        return;
    }

    // Print all addresses with labels and QR codes
    // Using console.log here since QR codes are visual and need raw output
    console.log('\nScan to connect from Android:\n');

    for (const addr of addresses) {
        const url = `http://${addr.address}:${port}`;
        console.log(`  ${url} (${addr.label})`);

        try {
            const qr = await QRCode.toString(url, {
                type: 'terminal',
                small: true,
            });
            console.log(qr);
        } catch {
            // QR generation failed, not critical
        }
    }
}
