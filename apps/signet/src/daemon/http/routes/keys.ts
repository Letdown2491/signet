import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { KeyService } from '../../services/index.js';
import { emitCurrentStats, emitCurrentHealth, getConnectionTokenService, getEventService } from '../../services/index.js';
import type { PreHandlerFull } from '../types.js';
import { sendError } from '../../lib/route-errors.js';
import { adminLogRepository } from '../../repositories/admin-log-repository.js';
import { getClientInfo } from '../../lib/client-info.js';
import { validateKeyName, validatePassphrase, sanitizeString } from '../../lib/validation.js';
import type { EncryptionFormat } from '@signet/types';

export interface KeysRouteConfig {
    keyService: KeyService;
}

export function registerKeysRoutes(
    fastify: FastifyInstance,
    config: KeysRouteConfig,
    preHandler: PreHandlerFull
): void {
    // List all keys (GET - no CSRF needed)
    fastify.get('/keys', { preHandler: preHandler.auth }, async (_request: FastifyRequest, reply: FastifyReply) => {
        const keys = await config.keyService.listKeys();
        return reply.send({ keys });
    });

    // Create new key (POST - needs CSRF)
    fastify.post('/keys', { preHandler: [...preHandler.rateLimit, ...preHandler.auth, ...preHandler.csrf] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as {
            keyName?: string;
            passphrase?: string;
            confirmPassphrase?: string;
            nsec?: string;
            encryption?: EncryptionFormat;
        };

        // Validate key name
        const keyNameResult = validateKeyName(body.keyName);
        if (!keyNameResult.valid) {
            return reply.code(400).send({ error: keyNameResult.error });
        }

        // Validate passphrase length if provided
        if (body.passphrase) {
            const passphraseResult = validatePassphrase(body.passphrase);
            if (!passphraseResult.valid) {
                return reply.code(400).send({ error: passphraseResult.error });
            }
        }

        // Validate encryption format
        const encryption = body.encryption ?? 'none';
        if (!['none', 'nip49', 'legacy'].includes(encryption)) {
            return reply.code(400).send({ error: 'Invalid encryption format' });
        }

        try {
            const key = await config.keyService.createKey({
                keyName: sanitizeString(body.keyName),
                passphrase: body.passphrase,
                confirmPassphrase: body.confirmPassphrase,
                nsec: body.nsec,
                encryption,
            });

            // Emit stats and health updates (key count changed)
            await emitCurrentStats();
            emitCurrentHealth();

            return reply.send({ ok: true, key });
        } catch (error) {
            return sendError(reply, error);
        }
    });

    // Unlock an encrypted key (POST - needs CSRF)
    fastify.post('/keys/:keyName/unlock', { preHandler: [...preHandler.auth, ...preHandler.csrf] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { keyName } = request.params as { keyName: string };
        const { passphrase } = request.body as { passphrase?: string };

        if (!passphrase) {
            return reply.code(400).send({ error: 'passphrase is required' });
        }

        const passphraseResult = validatePassphrase(passphrase);
        if (!passphraseResult.valid) {
            return reply.code(400).send({ error: passphraseResult.error });
        }

        try {
            await config.keyService.unlockKey(keyName, passphrase);

            // Log admin event
            const clientInfo = getClientInfo(request);
            const adminLog = await adminLogRepository.create({
                eventType: 'key_unlocked',
                keyName,
                ...clientInfo,
            });

            // Emit stats and health updates (active key count changed)
            await emitCurrentStats();
            emitCurrentHealth();

            // Emit admin event for real-time updates
            getEventService().emitAdminEvent(adminLogRepository.toActivityEntry(adminLog));

            return reply.send({ ok: true });
        } catch (error) {
            return sendError(reply, error);
        }
    });

    // Lock an active key (POST - needs CSRF)
    fastify.post('/keys/:keyName/lock', { preHandler: [...preHandler.auth, ...preHandler.csrf] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { keyName } = request.params as { keyName: string };

        try {
            config.keyService.lockKey(keyName);

            // Log admin event
            const clientInfo = getClientInfo(request);
            const adminLog = await adminLogRepository.create({
                eventType: 'key_locked',
                keyName,
                ...clientInfo,
            });

            // Emit stats and health updates (active key count changed)
            await emitCurrentStats();
            emitCurrentHealth();

            // Emit admin event for real-time updates
            getEventService().emitAdminEvent(adminLogRepository.toActivityEntry(adminLog));

            return reply.send({ ok: true });
        } catch (error) {
            return sendError(reply, error);
        }
    });

    // Set passphrase on an unencrypted key (POST - needs CSRF + rate limit)
    fastify.post('/keys/:keyName/set-passphrase', { preHandler: [...preHandler.rateLimit, ...preHandler.auth, ...preHandler.csrf] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { keyName } = request.params as { keyName: string };
        const { passphrase } = request.body as { passphrase?: string };

        if (!passphrase || !passphrase.trim()) {
            return reply.code(400).send({ error: 'passphrase is required' });
        }

        const passphraseResult = validatePassphrase(passphrase);
        if (!passphraseResult.valid) {
            return reply.code(400).send({ error: passphraseResult.error });
        }

        try {
            await config.keyService.setPassphrase(keyName, passphrase);
            return reply.send({ ok: true });
        } catch (error) {
            return sendError(reply, error);
        }
    });

    // Rename a key (PATCH - needs CSRF)
    fastify.patch('/keys/:keyName', { preHandler: [...preHandler.auth, ...preHandler.csrf] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { keyName } = request.params as { keyName: string };
        const { newName } = request.body as { newName?: string };

        // Validate new key name
        const keyNameResult = validateKeyName(newName);
        if (!keyNameResult.valid) {
            return reply.code(400).send({ error: keyNameResult.error });
        }

        try {
            await config.keyService.renameKey(keyName, sanitizeString(newName));
            return reply.send({ ok: true });
        } catch (error) {
            return sendError(reply, error);
        }
    });

    // Delete a key (DELETE - needs CSRF)
    fastify.delete('/keys/:keyName', { preHandler: [...preHandler.rateLimit, ...preHandler.auth, ...preHandler.csrf] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { keyName } = request.params as { keyName: string };
        const { passphrase } = request.body as { passphrase?: string } ?? {};

        try {
            const result = await config.keyService.deleteKey(keyName, passphrase);

            // Emit stats and health updates (key count and possibly app count changed)
            await emitCurrentStats();
            emitCurrentHealth();

            return reply.send({
                ok: true,
                revokedApps: result.revokedApps,
            });
        } catch (error) {
            return sendError(reply, error);
        }
    });

    // Lock all active encrypted keys (POST - needs CSRF)
    fastify.post('/keys/lock-all', { preHandler: [...preHandler.auth, ...preHandler.csrf] }, async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const lockedKeys = config.keyService.lockAllKeys();

            // Log admin events for each locked key
            const clientInfo = getClientInfo(request);
            for (const keyName of lockedKeys) {
                const adminLog = await adminLogRepository.create({
                    eventType: 'key_locked',
                    keyName,
                    ...clientInfo,
                });
                getEventService().emitAdminEvent(adminLogRepository.toActivityEntry(adminLog));
            }

            // Emit stats and health updates (active key count changed)
            await emitCurrentStats();
            emitCurrentHealth();

            return reply.send({ ok: true, lockedCount: lockedKeys.length });
        } catch (error) {
            return sendError(reply, error);
        }
    });

    // Generate a one-time connection token (POST - needs CSRF + rate limit)
    fastify.post('/keys/:keyName/connection-token', { preHandler: [...preHandler.rateLimit, ...preHandler.auth, ...preHandler.csrf] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { keyName } = request.params as { keyName: string };

        // Verify key exists and is active
        if (!config.keyService.isKeyActive(keyName)) {
            return reply.code(400).send({ error: 'Key is not active' });
        }

        try {
            const tokenService = getConnectionTokenService();
            const result = await tokenService.createToken(keyName);
            const bunkerUri = config.keyService.buildBunkerUriWithToken(keyName, result.token);

            if (!bunkerUri) {
                return reply.code(500).send({ error: 'Failed to build bunker URI' });
            }

            return reply.send({
                ok: true,
                bunkerUri,
                expiresAt: result.expiresAt.toISOString(),
            });
        } catch (error) {
            return sendError(reply, error);
        }
    });

    // Encrypt an unencrypted key (POST - needs CSRF + rate limit)
    fastify.post('/keys/:keyName/encrypt', { preHandler: [...preHandler.rateLimit, ...preHandler.auth, ...preHandler.csrf] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { keyName } = request.params as { keyName: string };
        const body = request.body as {
            encryption?: 'nip49' | 'legacy';
            passphrase?: string;
            confirmPassphrase?: string;
        };

        if (!body.encryption || !['nip49', 'legacy'].includes(body.encryption)) {
            return reply.code(400).send({ error: 'encryption must be "nip49" or "legacy"' });
        }

        if (!body.passphrase || !body.passphrase.trim()) {
            return reply.code(400).send({ error: 'passphrase is required' });
        }

        const passphraseResult = validatePassphrase(body.passphrase);
        if (!passphraseResult.valid) {
            return reply.code(400).send({ error: passphraseResult.error });
        }

        if (!body.confirmPassphrase) {
            return reply.code(400).send({ error: 'confirmPassphrase is required' });
        }

        try {
            await config.keyService.encryptKey(
                keyName,
                body.passphrase,
                body.confirmPassphrase,
                body.encryption
            );

            // Log admin event
            const clientInfo = getClientInfo(request);
            const adminLog = await adminLogRepository.create({
                eventType: 'key_encrypted',
                keyName,
                ...clientInfo,
            });
            getEventService().emitAdminEvent(adminLogRepository.toActivityEntry(adminLog));

            return reply.send({ ok: true });
        } catch (error) {
            return sendError(reply, error);
        }
    });

    // Migrate a legacy-encrypted key to NIP-49 (POST - needs CSRF + rate limit)
    fastify.post('/keys/:keyName/migrate', { preHandler: [...preHandler.rateLimit, ...preHandler.auth, ...preHandler.csrf] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { keyName } = request.params as { keyName: string };
        const { passphrase } = request.body as { passphrase?: string };

        if (!passphrase) {
            return reply.code(400).send({ error: 'passphrase is required' });
        }

        try {
            await config.keyService.migrateToNip49(keyName, passphrase);

            // Log admin event
            const clientInfo = getClientInfo(request);
            const adminLog = await adminLogRepository.create({
                eventType: 'key_migrated',
                keyName,
                ...clientInfo,
            });
            getEventService().emitAdminEvent(adminLogRepository.toActivityEntry(adminLog));

            return reply.send({ ok: true });
        } catch (error) {
            // Log failed auth attempts
            if (error instanceof Error && error.message === 'Incorrect passphrase') {
                const clientInfo = getClientInfo(request);
                const adminLog = await adminLogRepository.create({
                    eventType: 'auth_failed',
                    keyName,
                    ...clientInfo,
                });
                getEventService().emitAdminEvent(adminLogRepository.toActivityEntry(adminLog));
            }
            return sendError(reply, error);
        }
    });

    // Export a key (POST - needs CSRF + rate limit)
    fastify.post('/keys/:keyName/export', { preHandler: [...preHandler.rateLimit, ...preHandler.auth, ...preHandler.csrf] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { keyName } = request.params as { keyName: string };
        const body = request.body as {
            currentPassphrase?: string;
            format?: 'nip49' | 'nsec';
            exportPassphrase?: string;
            confirmExportPassphrase?: string;
        };

        if (!body.format || !['nip49', 'nsec'].includes(body.format)) {
            return reply.code(400).send({ error: 'format must be "nip49" or "nsec"' });
        }

        // Validate export passphrase if nip49 format
        if (body.format === 'nip49') {
            if (!body.exportPassphrase || !body.exportPassphrase.trim()) {
                return reply.code(400).send({ error: 'exportPassphrase is required for NIP-49 format' });
            }

            const passphraseResult = validatePassphrase(body.exportPassphrase);
            if (!passphraseResult.valid) {
                return reply.code(400).send({ error: passphraseResult.error });
            }

            if (!body.confirmExportPassphrase) {
                return reply.code(400).send({ error: 'confirmExportPassphrase is required' });
            }
        }

        try {
            const result = await config.keyService.exportKey(
                keyName,
                body.currentPassphrase,
                body.format,
                body.exportPassphrase,
                body.confirmExportPassphrase
            );

            // Log admin event
            const clientInfo = getClientInfo(request);
            const adminLog = await adminLogRepository.create({
                eventType: 'key_exported',
                keyName,
                ...clientInfo,
            });
            getEventService().emitAdminEvent(adminLogRepository.toActivityEntry(adminLog));

            return reply.send({ ok: true, ...result });
        } catch (error) {
            // Log failed auth attempts
            if (error instanceof Error && (
                error.message === 'Current passphrase is required' ||
                error.message.includes('passphrase')
            )) {
                const clientInfo = getClientInfo(request);
                const adminLog = await adminLogRepository.create({
                    eventType: 'auth_failed',
                    keyName,
                    ...clientInfo,
                });
                getEventService().emitAdminEvent(adminLogRepository.toActivityEntry(adminLog));
            }
            return sendError(reply, error);
        }
    });
}
