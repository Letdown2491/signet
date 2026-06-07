import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppRepository } from '../app-repository.js';
import { createMockKeyUser } from '../../testing/mocks.js';

// Mock the acl module
vi.mock('../../lib/acl.js', () => ({
  invalidateAclCache: vi.fn(),
}));

// Mock the db module - must use inline factory to avoid hoisting issues
vi.mock('../../../db.js', () => ({
  default: {
    keyUser: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
    log: {
      count: vi.fn().mockResolvedValue(0),
    },
  },
}));

describe('AppRepository', () => {
  let repository: AppRepository;
  let mockPrisma: any;

  beforeEach(async () => {
    const dbModule = await import('../../../db.js');
    mockPrisma = dbModule.default;
    vi.clearAllMocks();

    repository = new AppRepository();
  });

  describe('findAll', () => {
    it('should return all active apps', async () => {
      const mockApps = [
        createMockKeyUser({ id: 1, description: 'App 1' }),
        createMockKeyUser({ id: 2, description: 'App 2' }),
      ];
      mockPrisma.keyUser.findMany.mockResolvedValue(mockApps);

      const result = await repository.findAll();

      expect(result).toEqual(mockApps);
      expect(mockPrisma.keyUser.findMany).toHaveBeenCalledWith({
        where: { revokedAt: null },
        include: { signingConditions: true },
        orderBy: { lastUsedAt: 'desc' },
      });
    });

    it('should return empty array when no apps', async () => {
      mockPrisma.keyUser.findMany.mockResolvedValue([]);

      const result = await repository.findAll();

      expect(result).toEqual([]);
    });
  });

  describe('findById', () => {
    it('should return app when found', async () => {
      const mockApp = createMockKeyUser({ id: 1 });
      mockPrisma.keyUser.findUnique.mockResolvedValue(mockApp);

      const result = await repository.findById(1);

      expect(result).toEqual(mockApp);
      expect(mockPrisma.keyUser.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        include: { signingConditions: true },
      });
    });

    it('should return null when not found', async () => {
      mockPrisma.keyUser.findUnique.mockResolvedValue(null);

      const result = await repository.findById(999);

      expect(result).toBeNull();
    });
  });

  describe('countActive', () => {
    it('should return count of active apps', async () => {
      mockPrisma.keyUser.count.mockResolvedValue(10);

      const result = await repository.countActive();

      expect(result).toBe(10);
      expect(mockPrisma.keyUser.count).toHaveBeenCalledWith({
        where: { revokedAt: null },
      });
    });
  });

  describe('revoke', () => {
    it('should set revokedAt timestamp and invalidate cache', async () => {
      mockPrisma.keyUser.update.mockResolvedValue({
        keyName: 'test-key',
        userPubkey: 'abc123',
      });

      await repository.revoke(1);

      expect(mockPrisma.keyUser.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { revokedAt: expect.any(Date) },
        select: { keyName: true, userPubkey: true },
      });
    });
  });

  describe('updateDescription', () => {
    it('should update description and invalidate cache', async () => {
      mockPrisma.keyUser.update.mockResolvedValue({
        keyName: 'test-key',
        userPubkey: 'abc123',
      });

      await repository.updateDescription(1, 'New Description');

      expect(mockPrisma.keyUser.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { description: 'New Description' },
        select: { keyName: true, userPubkey: true },
      });
    });
  });

  describe('getRequestCount', () => {
    it('should return log count for key user', async () => {
      mockPrisma.log.count.mockResolvedValue(42);

      const result = await repository.getRequestCount(1);

      expect(result).toBe(42);
      expect(mockPrisma.log.count).toHaveBeenCalledWith({
        where: { keyUserId: 1 },
      });
    });
  });
});
