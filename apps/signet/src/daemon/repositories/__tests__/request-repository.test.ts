import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RequestRepository } from '../request-repository.js';
import { createMockRequest } from '../../testing/mocks.js';

// Mock the db module - must use inline factory to avoid hoisting issues
vi.mock('../../../db.js', () => ({
  default: {
    request: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    keyUser: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

describe('RequestRepository', () => {
  let repository: RequestRepository;
  let mockPrisma: any;

  beforeEach(async () => {
    const dbModule = await import('../../../db.js');
    mockPrisma = dbModule.default;
    vi.clearAllMocks();

    repository = new RequestRepository();
  });

  describe('findById', () => {
    it('should return request when found', async () => {
      const mockRequest = createMockRequest();
      mockPrisma.request.findUnique.mockResolvedValue(mockRequest);

      const result = await repository.findById('test-request-id');

      expect(result).toEqual(mockRequest);
      expect(mockPrisma.request.findUnique).toHaveBeenCalledWith({
        where: { id: 'test-request-id' },
        include: { KeyUser: true },
      });
    });

    it('should return null when not found', async () => {
      mockPrisma.request.findUnique.mockResolvedValue(null);

      const result = await repository.findById('nonexistent-id');

      expect(result).toBeNull();
    });
  });

  describe('findPending', () => {
    it('should return request when pending (allowed is null)', async () => {
      const mockRequest = createMockRequest({ allowed: null });
      mockPrisma.request.findUnique.mockResolvedValue(mockRequest);

      const result = await repository.findPending('test-request-id');

      expect(result).toEqual(mockRequest);
    });

    it('should return null when already processed', async () => {
      const mockRequest = createMockRequest({ allowed: true });
      mockPrisma.request.findUnique.mockResolvedValue(mockRequest);

      const result = await repository.findPending('test-request-id');

      expect(result).toBeNull();
    });

    it('should return null when not found', async () => {
      mockPrisma.request.findUnique.mockResolvedValue(null);

      const result = await repository.findPending('nonexistent-id');

      expect(result).toBeNull();
    });
  });

  describe('countPending', () => {
    it('should return count of pending non-expired requests', async () => {
      mockPrisma.request.count.mockResolvedValue(5);

      const result = await repository.countPending();

      expect(result).toBe(5);
      expect(mockPrisma.request.count).toHaveBeenCalledWith({
        where: {
          allowed: null,
          createdAt: { gte: expect.any(Date) },
        },
      });
    });
  });

  describe('approve', () => {
    it('should atomically update a pending request with allowed=true and processedAt', async () => {
      mockPrisma.request.updateMany.mockResolvedValue({ count: 1 });

      const result = await repository.approve('test-request-id');

      expect(result).toBe(true);
      expect(mockPrisma.request.updateMany).toHaveBeenCalledWith({
        where: { id: 'test-request-id', allowed: null },
        data: {
          allowed: true,
          processedAt: expect.any(Date),
          approvalType: 'manual',
        },
      });
    });

    it('should return false when the request was already processed', async () => {
      mockPrisma.request.updateMany.mockResolvedValue({ count: 0 });

      const result = await repository.approve('test-request-id');

      expect(result).toBe(false);
    });
  });

  describe('deny', () => {
    it('should atomically update a pending request with allowed=false and processedAt', async () => {
      mockPrisma.request.updateMany.mockResolvedValue({ count: 1 });

      const result = await repository.deny('test-request-id');

      expect(result).toBe(true);
      expect(mockPrisma.request.updateMany).toHaveBeenCalledWith({
        where: { id: 'test-request-id', allowed: null },
        data: {
          allowed: false,
          processedAt: expect.any(Date),
        },
      });
    });

    it('should return false when the request was already processed', async () => {
      mockPrisma.request.updateMany.mockResolvedValue({ count: 0 });

      const result = await repository.deny('test-request-id');

      expect(result).toBe(false);
    });
  });

  describe('deleteOrphanedPending', () => {
    it('deletes all unprocessed (allowed=null) requests and returns the count', async () => {
      mockPrisma.request.deleteMany.mockResolvedValue({ count: 3 });

      const count = await repository.deleteOrphanedPending();

      expect(count).toBe(3);
      expect(mockPrisma.request.deleteMany).toHaveBeenCalledWith({
        where: { allowed: null },
      });
    });
  });
});
