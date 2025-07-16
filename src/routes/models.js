const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const YAML = require('yamljs');
const { pool } = require('../database');
const { authenticateToken, optionalAuth } = require('../middleware/auth');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const modelId = req.params.id;
    const uploadPath = path.join(__dirname, '../../uploads/models', modelId);
    fs.mkdir(uploadPath, { recursive: true }).then(() => {
      cb(null, uploadPath);
    }).catch(cb);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }
});

router.get('/', optionalAuth, async (req, res) => {
  try {
    const { task_type, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT 
        m.id, m.name, m.description, m.task_type, m.zoom_level, m.is_public, m.created_at,
        u.username as owner,
        mv.version, mv.file_size, mv.metadata
      FROM models m
      JOIN users u ON m.user_id = u.id
      LEFT JOIN model_versions mv ON m.id = mv.model_id AND mv.is_active = true
      WHERE m.is_public = true
    `;

    const params = [];
    if (req.user) {
      query += ` OR m.user_id = $${params.length + 1}`;
      params.push(req.user.userId);
    }

    if (task_type) {
      query += ` AND m.task_type = $${params.length + 1}`;
      params.push(task_type);
    }

    query += ` ORDER BY m.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching models:', err);
    res.status(500).json({ error: 'Failed to fetch models' });
  }
});

router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const query = `
      SELECT 
        m.id, m.name, m.description, m.task_type, m.zoom_level, m.is_public, m.created_at,
        u.username as owner,
        mv.version, mv.file_size, mv.metadata
      FROM models m
      JOIN users u ON m.user_id = u.id
      LEFT JOIN model_versions mv ON m.id = mv.model_id AND mv.is_active = true
      WHERE m.id = $1 AND (m.is_public = true OR m.user_id = $2)
    `;

    const result = await pool.query(query, [id, req.user?.userId || null]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Model not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching model:', err);
    res.status(500).json({ error: 'Failed to fetch model' });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, description, task_type, zoom_level = 19, is_public = false } = req.body;

    if (!name || !task_type) {
      return res.status(400).json({ error: 'Name and task_type are required' });
    }

    if (!['detect', 'obb', 'pose'].includes(task_type)) {
      return res.status(400).json({ error: 'Invalid task_type' });
    }

    if (zoom_level < 8 || zoom_level > 21) {
      return res.status(400).json({ error: 'Zoom level must be between 8 and 21' });
    }

    const result = await pool.query(
      'INSERT INTO models (name, description, task_type, zoom_level, user_id, is_public) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [name, description, task_type, zoom_level, req.user.userId, is_public]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating model:', err);
    res.status(500).json({ error: 'Failed to create model' });
  }
});

router.post('/:id/upload', authenticateToken, upload.array('files'), async (req, res) => {
  try {
    const { id } = req.params;
    const { version = '1.0.0', created_date } = req.body;

    const modelCheck = await pool.query(
      'SELECT id FROM models WHERE id = $1 AND user_id = $2',
      [id, req.user.userId]
    );

    if (modelCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Model not found or unauthorized' });
    }

    const uploadPath = path.join(__dirname, '../../uploads/models', id);
    await fs.mkdir(uploadPath, { recursive: true });

    let totalSize = 0;
    let metadata = {};

    for (const file of req.files) {
      totalSize += file.size;
      
      if (file.originalname === 'metadata.yaml') {
        const yamlContent = await fs.readFile(file.path, 'utf8');
        metadata = YAML.parse(yamlContent);
      }
    }

    // Add form-provided created_date to metadata if provided
    if (created_date) {
      metadata.form_created_date = created_date;
    }

    await pool.query(
      'UPDATE model_versions SET is_active = false WHERE model_id = $1',
      [id]
    );

    const result = await pool.query(
      'INSERT INTO model_versions (model_id, version, file_path, file_size, metadata) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [id, version, uploadPath, totalSize, metadata]
    );

    res.json({
      message: 'Model uploaded successfully',
      version: result.rows[0]
    });
  } catch (err) {
    console.error('Error uploading model:', err);
    res.status(500).json({ error: 'Failed to upload model' });
  }
});

router.get('/:id/files', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const modelCheck = await pool.query(
      'SELECT id FROM models WHERE id = $1 AND (is_public = true OR user_id = $2)',
      [id, req.user?.userId || null]
    );

    if (modelCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Model not found or unauthorized' });
    }

    const uploadPath = path.join(__dirname, '../../uploads/models', id);
    
    try {
      const files = await fs.readdir(uploadPath);
      res.json(files);
    } catch (err) {
      res.json([]);
    }
  } catch (err) {
    console.error('Error getting file list:', err);
    res.status(500).json({ error: 'Failed to get file list' });
  }
});


router.get('/:id/download/:filename', optionalAuth, async (req, res) => {
  try {
    const { id, filename } = req.params;

    const modelCheck = await pool.query(
      'SELECT id FROM models WHERE id = $1 AND (is_public = true OR user_id = $2)',
      [id, req.user?.userId || null]
    );

    if (modelCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Model not found or unauthorized' });
    }

    const filePath = path.join(__dirname, '../../uploads/models', id, filename);
    
    // Check if file exists before trying to download
    try {
      await fs.access(filePath);
      res.download(filePath);
    } catch (fileErr) {
      return res.status(404).json({ error: `File ${filename} not found` });
    }
  } catch (err) {
    console.error('Error downloading file:', err);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

router.patch('/:id/visibility', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_public } = req.body;

    if (typeof is_public !== 'boolean') {
      return res.status(400).json({ error: 'is_public must be a boolean' });
    }

    const result = await pool.query(
      'UPDATE models SET is_public = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3 RETURNING *',
      [is_public, id, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Model not found or unauthorized' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating model visibility:', err);
    res.status(500).json({ error: 'Failed to update model visibility' });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if model exists and user is owner
    const modelCheck = await pool.query(
      'SELECT id FROM models WHERE id = $1 AND user_id = $2',
      [id, req.user.userId]
    );

    if (modelCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Model not found or unauthorized' });
    }

    // Delete model files
    const uploadPath = path.join(__dirname, '../../uploads/models', id);
    try {
      await fs.rmdir(uploadPath, { recursive: true });
    } catch (err) {
      console.log('Could not delete model files:', err.message);
    }

    // Delete model from database (cascade will handle model_versions)
    await pool.query('DELETE FROM models WHERE id = $1', [id]);

    res.json({ message: 'Model deleted successfully' });
  } catch (err) {
    console.error('Error deleting model:', err);
    res.status(500).json({ error: 'Failed to delete model' });
  }
});

module.exports = router;