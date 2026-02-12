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
    it('should update request with allowed=true and processedAt', async () => {
      await repository.approve('test-request-id');

      expect(mockPrisma.request.update).toHaveBeenCalledWith({
        where: { id: 'test-request-id' },
        data: {
          allowed: true,
          processedAt: expect.any(Date),
          approvalType: 'manual',
        },
      });
    });
  });

  describe('deny', () => {
    it('should update request with allowed=false and processedAt', async () => {
      await repository.deny('test-request-id');

      expect(mockPrisma.request.update).toHaveBeenCalledWith({
        where: { id: 'test-request-id' },
        data: {
          allowed: false,
          processedAt: expect.any(Date),
        },
      });
    });
  });
});
