import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppService } from '../app-service.js';
import { createMockKeyUser, createMockLogEntry } from '../../testing/mocks.js';

// Mock the acl module to prevent db.ts from loading
vi.mock('../../lib/acl.js', () => ({
  updateTrustLevel: vi.fn(),
}));

// Stable event-service mock so we can assert emitted activity.
const { mockEventService } = vi.hoisted(() => ({
  mockEventService: {
    emitAppRevoked: vi.fn(),
    emitAppUpdated: vi.fn(),
    emitAppsUpdated: vi.fn(),
    emitAppConnected: vi.fn(),
    emitRequestAutoApproved: vi.fn(),
  },
}));

vi.mock('../event-service.js', () => ({
  getEventService: () => mockEventService,
  emitCurrentStats: vi.fn(),
}));

// Mock the repository
vi.mock('../../repositories/index.js', () => ({
  appRepository: {
    findAll: vi.fn(),
    findById: vi.fn(),
    findByIdWithConditions: vi.fn(),
    revoke: vi.fn(),
    updateDescription: vi.fn(),
    getRequestCount: vi.fn(),
    getRequestCountsBatch: vi.fn(),
    getMethodBreakdownsBatch: vi.fn(),
    countActive: vi.fn(),
  },
  requestRepository: {
    createAutoApproved: vi.fn(),
  },
  logRepository: {
    create: vi.fn(),
  },
}));

describe('AppService', () => {
  let service: AppService;
  let mockAppRepository: any;
  let mockRequestRepository: any;
  let mockLogRepository: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    const repoModule = await import('../../repositories/index.js');
    mockAppRepository = repoModule.appRepository;
    mockRequestRepository = repoModule.requestRepository;
    mockLogRepository = repoModule.logRepository;

    service = new AppService();
  });

  describe('listApps', () => {
    it('should return formatted app list', async () => {
      const mockKeyUsers = [
        createMockKeyUser({
          id: 1,
          keyName: 'main-key',
          description: 'Test App',
          signingConditions: [
            { id: 1, method: 'sign_event', kind: null, allowed: true },
            { id: 2, method: 'connect', kind: null, allowed: true }, // Should be filtered out
          ],
        }),
      ];

      mockAppRepository.findAll.mockResolvedValue(mockKeyUsers);
      mockAppRepository.getRequestCountsBatch.mockResolvedValue(new Map([[1, 10]]));
      mockAppRepository.getMethodBreakdownsBatch.mockResolvedValue(new Map([[1, {}]]));

      const result = await service.listApps();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 1,
        keyName: 'main-key',
        description: 'Test App',
        requestCount: 10,
      });
    });

    it('should return empty array when no apps', async () => {
      mockAppRepository.findAll.mockResolvedValue([]);

      const result = await service.listApps();

      expect(result).toEqual([]);
    });

    it('should handle missing counts gracefully', async () => {
      const mockKeyUsers = [
        createMockKeyUser({
          id: 1,
          signingConditions: [],
        }),
      ];

      mockAppRepository.findAll.mockResolvedValue(mockKeyUsers);
      mockAppRepository.getRequestCountsBatch.mockResolvedValue(new Map());
      mockAppRepository.getMethodBreakdownsBatch.mockResolvedValue(new Map());

      const result = await service.listApps();

      expect(result[0].requestCount).toBe(0);
    });
  });

  describe('revokeApp', () => {
    it('should revoke app when found', async () => {
      mockAppRepository.findById.mockResolvedValue(createMockKeyUser({ id: 1 }));
      mockAppRepository.revoke.mockResolvedValue(undefined);

      await service.revokeApp(1);

      expect(mockAppRepository.revoke).toHaveBeenCalledWith(1);
    });

    it('should throw when app not found', async () => {
      mockAppRepository.findById.mockResolvedValue(null);

      await expect(service.revokeApp(999)).rejects.toThrow('App not found');
    });
  });

  describe('logoutApp', () => {
    it('records an audit entry, emits activity, and revokes when the app exists', async () => {
      mockAppRepository.findById.mockResolvedValue(
        createMockKeyUser({ id: 1, keyName: 'Geek', description: 'nostr-client' }),
      );
      mockAppRepository.revoke.mockResolvedValue(undefined);
      mockRequestRepository.createAutoApproved.mockResolvedValue({ id: 10 });
      mockLogRepository.create.mockResolvedValue(
        createMockLogEntry({ id: 99, method: 'logout', timestamp: new Date('2026-06-09T00:00:00.000Z') }),
      );

      await service.logoutApp(1, 'req-123', 'Geek', 'pubkeyhex');

      expect(mockRequestRepository.createAutoApproved).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'req-123',
          keyName: 'Geek',
          method: 'logout',
          remotePubkey: 'pubkeyhex',
          keyUserId: 1,
        }),
      );
      expect(mockLogRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'approval',
          method: 'logout',
          keyUserId: 1,
          autoApproved: true,
          keyName: 'Geek',
          remotePubkey: 'pubkeyhex',
        }),
      );
      expect(mockEventService.emitRequestAutoApproved).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 99,
          method: 'logout',
          keyName: 'Geek',
          userPubkey: 'pubkeyhex',
          appName: 'nostr-client',
          autoApproved: true,
        }),
      );
      expect(mockAppRepository.revoke).toHaveBeenCalledWith(1);
    });

    it('is idempotent: does nothing when the app no longer exists', async () => {
      mockAppRepository.findById.mockResolvedValue(null);

      await service.logoutApp(999, 'req-x', 'Geek', 'pubkeyhex');

      expect(mockRequestRepository.createAutoApproved).not.toHaveBeenCalled();
      expect(mockLogRepository.create).not.toHaveBeenCalled();
      expect(mockEventService.emitRequestAutoApproved).not.toHaveBeenCalled();
      expect(mockAppRepository.revoke).not.toHaveBeenCalled();
    });
  });

  describe('updateDescription', () => {
    it('should update description when app found', async () => {
      const mockKeyUser = createMockKeyUser({ id: 1 });
      mockAppRepository.findById.mockResolvedValue(mockKeyUser);
      mockAppRepository.findByIdWithConditions.mockResolvedValue(mockKeyUser);
      mockAppRepository.updateDescription.mockResolvedValue(undefined);
      mockAppRepository.getRequestCountsBatch.mockResolvedValue(new Map([[1, 0]]));
      mockAppRepository.getMethodBreakdownsBatch.mockResolvedValue(new Map([[1, {}]]));

      await service.updateDescription(1, 'New Name');

      expect(mockAppRepository.updateDescription).toHaveBeenCalledWith(1, 'New Name');
    });

    it('should throw when app not found', async () => {
      mockAppRepository.findById.mockResolvedValue(null);

      await expect(service.updateDescription(999, 'New Name')).rejects.toThrow('App not found');
    });
  });

  describe('countActive', () => {
    it('should return active app count', async () => {
      mockAppRepository.countActive.mockResolvedValue(5);

      const result = await service.countActive();

      expect(result).toBe(5);
    });
  });
});
