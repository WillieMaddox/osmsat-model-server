const request = require('supertest');
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const modelsRouter = require('../src/routes/models');

// Mock database
jest.mock('../src/database', () => ({
  pool: {
    query: jest.fn()
  }
}));

// Mock auth middleware  
jest.mock('../src/middleware/auth', () => ({
  authenticateToken: jest.fn((req, res, next) => {
    req.user = { userId: 'test-user-id' };
    next();
  }),
  optionalAuth: jest.fn((req, res, next) => {
    req.user = { userId: 'test-user-id' };
    next();
  })
}));

const { pool } = require('../src/database');
const app = express();
app.use(express.json());
app.use('/api/models', modelsRouter);

describe('Models API - Bulk Download', () => {
  const testModelId = 'test-model-123';
  const testUploadPath = path.join(__dirname, '../uploads/models', testModelId);
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up test files
    try {
      await fs.rm(testUploadPath, { recursive: true });
    } catch (err) {
      // Ignore cleanup errors
    }
  });

  describe('GET /:id/download-all', () => {
    beforeEach(async () => {
      // Create test directory and files
      await fs.mkdir(testUploadPath, { recursive: true });
      await fs.writeFile(path.join(testUploadPath, 'model.json'), '{"test": true}');
      await fs.writeFile(path.join(testUploadPath, 'weights.bin'), 'binary data');
      await fs.writeFile(path.join(testUploadPath, 'metadata.yaml'), 'version: 1.0');
    });

    it('should return 404 for non-existent model', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const response = await request(app)
        .get('/api/models/non-existent/download-all');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Model not found or unauthorized');
    });

    it('should return 404 when model has no files', async () => {
      pool.query.mockResolvedValue({ 
        rows: [{ id: testModelId, name: 'Test Model' }] 
      });

      // Remove test files to simulate empty directory
      await fs.rm(testUploadPath, { recursive: true });
      await fs.mkdir(testUploadPath, { recursive: true });

      const response = await request(app)
        .get(`/api/models/${testModelId}/download-all`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('No files available for download');
    });

    it('should download ZIP archive for valid model', async () => {
      pool.query.mockResolvedValue({ 
        rows: [{ id: testModelId, name: 'Test Model' }] 
      });

      const response = await request(app)
        .get(`/api/models/${testModelId}/download-all`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('application/zip');
      expect(response.headers['content-disposition']).toContain('attachment');
      expect(response.headers['content-disposition']).toContain('Test_Model.zip');
    });

    it('should handle model name with special characters', async () => {
      pool.query.mockResolvedValue({ 
        rows: [{ id: testModelId, name: 'Test Model! @#$%' }] 
      });

      const response = await request(app)
        .get(`/api/models/${testModelId}/download-all`);

      expect(response.status).toBe(200);
      expect(response.headers['content-disposition']).toContain('Test_Model______.zip');
    });

    it('should use default filename when model name is null', async () => {
      pool.query.mockResolvedValue({ 
        rows: [{ id: testModelId, name: null }] 
      });

      const response = await request(app)
        .get(`/api/models/${testModelId}/download-all`);

      expect(response.status).toBe(200);
      expect(response.headers['content-disposition']).toContain(`model-${testModelId}.zip`);
    });

    it('should respect access control for public models', async () => {
      // Mock unauthenticated request
      const { optionalAuth } = require('../src/middleware/auth');
      optionalAuth.mockImplementation((req, res, next) => {
        req.user = null; // Unauthenticated
        next();
      });

      pool.query.mockResolvedValue({ 
        rows: [{ id: testModelId, name: 'Public Model' }] 
      });

      const response = await request(app)
        .get(`/api/models/${testModelId}/download-all`);

      expect(response.status).toBe(200);
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining("visibility = 'public'"),
        [testModelId]
      );
    });

    it('should handle missing files gracefully', async () => {
      pool.query.mockResolvedValue({ 
        rows: [{ id: testModelId, name: 'Test Model' }] 
      });

      // Create directory but remove one file to test file access handling
      await fs.rm(path.join(testUploadPath, 'model.json'));

      const response = await request(app)
        .get(`/api/models/${testModelId}/download-all`);

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('application/zip');
    });

    it('should handle missing model directory', async () => {
      pool.query.mockResolvedValue({ 
        rows: [{ id: testModelId, name: 'Test Model' }] 
      });

      // Remove test directory
      await fs.rm(testUploadPath, { recursive: true });

      const response = await request(app)
        .get(`/api/models/${testModelId}/download-all`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Model files not found');
    });
  });
});