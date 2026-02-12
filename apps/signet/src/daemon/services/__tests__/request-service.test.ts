import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RequestService } from '../request-service.js';
import { createMockRequest, createMockStoredKeys } from '../../testing/mocks.js';

// Mock the repository
vi.mock('../../repositories/index.js', () => ({
  requestRepository: {
    findPending: vi.fn(),
    findMany: vi.fn(),
    countPending: vi.fn(),
    approve: vi.fn(),
    deny: vi.fn(),
  },
}));

describe('RequestService', () => {
  let service: RequestService;
  let mockRequestRepository: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    const repoModule = await import('../../repositories/index.js');
    mockRequestRepository = repoModule.requestRepository;

    service = new RequestService({
      allKeys: createMockStoredKeys(),
    });
  });

  describe('findPending', () => {
    it('should delegate to repository', async () => {
      const mockRequest = createMockRequest();
      mockRequestRepository.findPending.mockResolvedValue(mockRequest);

      const result = await service.findPending('test-id');

      expect(result).toEqual(mockRequest);
      expect(mockRequestRepository.findPending).toHaveBeenCalledWith('test-id');
    });
  });

  describe('listRequests', () => {
    it('should return formatted requests', async () => {
      const now = new Date();
      const mockRequests = [
        createMockRequest({
          id: 'req-1',
          keyName: 'test-key',
          method: 'sign_event',
          createdAt: now,
        }),
      ];
      mockRequestRepository.findMany.mockResolvedValue(mockRequests);

      const result = await service.listRequests({ status: 'pending' });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'req-1',
        keyName: 'test-key',
        method: 'sign_event',
        requiresPassword: false, // test-key is a plain key
      });
    });

    it('should set requiresPassword=true for encrypted keys', async () => {
      const mockRequests = [
        createMockRequest({
          keyName: 'encrypted-key',
        }),
      ];
      mockRequestRepository.findMany.mockResolvedValue(mockRequests);

      const result = await service.listRequests({ status: 'pending' });

      expect(result[0].requiresPassword).toBe(true);
    });

    it('should parse event preview for sign_event requests', async () => {
      const eventParams = JSON.stringify([{
        kind: 1,
        content: 'Hello world',
        tags: [['p', 'pubkey123']],
      }]);

      const mockRequests = [
        createMockRequest({
          method: 'sign_event',
          params: eventParams,
        }),
      ];
      mockRequestRepository.findMany.mockResolvedValue(mockRequests);

      const result = await service.listRequests({ status: 'pending' });

      expect(result[0].eventPreview).toEqual({
        kind: 1,
        content: 'Hello world',
        tags: [['p', 'pubkey123']],
      });
    });

    it('should apply default limit and offset', async () => {
      mockRequestRepository.findMany.mockResolvedValue([]);

      await service.listRequests({});

      expect(mockRequestRepository.findMany).toHaveBeenCalledWith({
        status: 'all',
        limit: 10,
        offset: 0,
      });
    });

    it('should cap limit at 50', async () => {
      mockRequestRepository.findMany.mockResolvedValue([]);

      await service.listRequests({ limit: 100 });

      expect(mockRequestRepository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 50 })
      );
    });
  });

  describe('countPending', () => {
    it('should delegate to repository', async () => {
      mockRequestRepository.countPending.mockResolvedValue(5);

      const result = await service.countPending();

      expect(result).toBe(5);
    });
  });

  describe('approve', () => {
    it('should delegate to repository', async () => {
      await service.approve('test-id');

      expect(mockRequestRepository.approve).toHaveBeenCalledWith('test-id');
    });
  });

  describe('deny', () => {
    it('should delegate to repository', async () => {
      await service.deny('test-id');

      expect(mockRequestRepository.deny).toHaveBeenCalledWith('test-id');
    });
  });
});
