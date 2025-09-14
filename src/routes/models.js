const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const YAML = require('yamljs');
const archiver = require('archiver');
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

// Helper function to calculate MD5 hash of model files
const calculateModelHash = async (files) => {
  const hash = crypto.createHash('md5');

  // Sort files for consistent hashing
  const sortedFiles = files.sort((a, b) => a.originalname.localeCompare(b.originalname));

  for (const file of sortedFiles) {
    const fileContent = await fs.readFile(file.path);
    hash.update(file.originalname); // Include filename in hash
    hash.update(fileContent);
  }

  return hash.digest('hex');
};

// Helper function to format image size display
const formatImageSize = (imgsz) => {
  if (!imgsz || !Array.isArray(imgsz) || imgsz.length < 2) return null;

  const [width, height] = imgsz;
  return width === height ? width.toString() : `${width}x${height}`;
};

// Helper function to process and enhance metadata
const processMetadata = (metadata) => {
  const processed = { ...metadata };

  // Calculate the number of classes and class list
  if (processed.names) {
    processed.num_classes = Object.keys(processed.names).length;
    processed.class_list = Object.values(processed.names);
  }

  // Format image size display
  if (processed.imgsz) {
    processed.image_size_display = formatImageSize(processed.imgsz);
  }

  // Determine precision from the half-precision flag
  if (processed.args.half !== undefined) {
    processed.precision = processed.args.half ? 'FP16' : 'FP32';
  }

  // Determine quantization from int8 flag
  if (processed.args.int8 !== undefined) {
    processed.quantization = processed.args.int8 ? 'INT8' : 'None';
  }

  // Set the model format (hardcoded to TF.js for now)
  processed.model_format = processed.model_format || 'TF.js';

  return processed;
};

router.get('/', optionalAuth, async (req, res) => {
  try {
    const { task_type, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT 
        m.id, m.name, m.description, m.task_type, m.zoom_level, m.visibility, m.created_at,
        u.username as owner,
        mv.version, mv.file_size, mv.metadata
      FROM models m
      JOIN users u ON m.user_id = u.id
      LEFT JOIN model_versions mv ON m.id = mv.model_id AND mv.is_active = true
      WHERE m.visibility = 'public'
    `;

    const params = [];
    if (req.user) {
      // Authenticated users can see public + members + their own private models
      query = `
        SELECT 
          m.id, m.name, m.description, m.task_type, m.zoom_level, m.visibility, m.created_at,
          u.username as owner,
          mv.version, mv.file_size, mv.metadata
        FROM models m
        JOIN users u ON m.user_id = u.id
        LEFT JOIN model_versions mv ON m.id = mv.model_id AND mv.is_active = true
        WHERE (m.visibility IN ('public', 'members') OR m.user_id = $${params.length + 1})
      `;
      params.push(req.user.userId);
    }

    if (task_type) {
      query += ` AND m.task_type = $${params.length + 1}`;
      params.push(task_type);
    }

    query += ` ORDER BY m.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Process metadata for each model
    const modelsWithProcessedMetadata = result.rows.map(model => ({
      ...model,
      metadata: model.metadata ? processMetadata(model.metadata) : {}
    }));

    res.json(modelsWithProcessedMetadata);
  } catch (err) {
    console.error('Error fetching models:', err);
    res.status(500).json({ error: 'Failed to fetch models' });
  }
});

router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;
    let accessCondition;
    const params = [id];
    
    if (req.user) {
      // Authenticated users can access 'public', 'members', and/or their own private models
      accessCondition = `(m.visibility IN ('public', 'members') OR m.user_id = $2)`;
      params.push(req.user.userId);
    } else {
      // Anonymous users can only access public models
      accessCondition = `m.visibility = 'public'`;
    }
    
    const query = `
      SELECT 
        m.id, m.name, m.description, m.task_type, m.zoom_level, m.visibility, m.created_at,
        u.username as owner,
        mv.version, mv.file_size, mv.metadata
      FROM models m
      JOIN users u ON m.user_id = u.id
      LEFT JOIN model_versions mv ON m.id = mv.model_id AND mv.is_active = true
      WHERE m.id = $1 AND ${accessCondition}
    `;

    const result = await pool.query(query, params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Model not found' });
    }

    // Process metadata for the model
    const model = result.rows[0];
    const processedModel = {
      ...model,
      metadata: model.metadata ? processMetadata(model.metadata) : {}
    };

    res.json(processedModel);
  } catch (err) {
    console.error('Error fetching model:', err);
    res.status(500).json({ error: 'Failed to fetch model' });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, description, task_type, zoom_level = 19, visibility = 'private' } = req.body;

    if (!name || !task_type) {
      return res.status(400).json({ error: 'Name and task_type are required' });
    }

    if (!['detect', 'obb', 'pose'].includes(task_type)) {
      return res.status(400).json({ error: 'Invalid task_type' });
    }

    if (zoom_level < 8 || zoom_level > 21) {
      return res.status(400).json({ error: 'Zoom level must be between 8 and 21' });
    }

    if (!['private', 'members', 'public'].includes(visibility)) {
      return res.status(400).json({ error: 'Invalid visibility. Must be private, members, or public' });
    }

    const result = await pool.query(
      'INSERT INTO models (name, description, task_type, zoom_level, user_id, visibility) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [name, description, task_type, zoom_level, req.user.userId, visibility]
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

    // Calculate MD5 hash of all uploaded files
    const modelHash = await calculateModelHash(req.files);

    // Add form-provided created_date to metadata if provided
    if (created_date) {
      metadata.form_created_date = created_date;
    }

    // Add hash and format to metadata
    metadata.model_hash = modelHash;
    metadata.model_format = metadata.model_format || 'TF.js';

    // Process metadata to add calculated fields
    metadata = processMetadata(metadata);

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

    let accessCondition;
    const params = [id];
    
    if (req.user) {
      // Authenticated users can access 'public', 'members', and/or their own private models
      accessCondition = `(visibility IN ('public', 'members') OR user_id = $2)`;
      params.push(req.user.userId);
    } else {
      // Anonymous users can only access public models
      accessCondition = `visibility = 'public'`;
    }
    
    const modelCheck = await pool.query(
      `SELECT id FROM models WHERE id = $1 AND ${accessCondition}`,
      params
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

    let accessCondition;
    const params = [id];
    
    if (req.user) {
      // Authenticated users can access 'public', 'members', and/or their own private models
      accessCondition = `(visibility IN ('public', 'members') OR user_id = $2)`;
      params.push(req.user.userId);
    } else {
      // Anonymous users can only access public models
      accessCondition = `visibility = 'public'`;
    }
    
    const modelCheck = await pool.query(
      `SELECT id FROM models WHERE id = $1 AND ${accessCondition}`,
      params
    );

    if (modelCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Model not found or unauthorized' });
    }

    const filePath = path.join(__dirname, '../../uploads/models', id, filename);
    
    // Check if the file exists before trying to download
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

// Bulk download all model files as ZIP archive
router.get('/:id/download-all', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;

    let accessCondition;
    const params = [id];
    
    if (req.user) {
      // Authenticated users can access 'public', 'members', and/or their own private models
      accessCondition = `(visibility IN ('public', 'members') OR user_id = $2)`;
      params.push(req.user.userId);
    } else {
      // Anonymous users can only access public models
      accessCondition = `visibility = 'public'`;
    }
    
    const modelCheck = await pool.query(
      `SELECT id, name FROM models WHERE id = $1 AND ${accessCondition}`,
      params
    );

    if (modelCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Model not found or unauthorized' });
    }

    const modelName = modelCheck.rows[0].name || `model-${id}`;
    const uploadPath = path.join(__dirname, '../../uploads/models', id);
    
    // Check if the directory exists and get files
    try {
      const files = await fs.readdir(uploadPath);
      
      if (files.length === 0) {
        return res.status(404).json({ error: 'No files available for download' });
      }

      // Set response headers for ZIP download
      const zipFilename = `${modelName.replace(/[^a-zA-Z0-9-_]/g, '_')}.zip`;
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

      // Create a ZIP archive
      const archive = archiver('zip', {
        zlib: { level: 9 } // Best compression
      });

      // Handle archive errors
      archive.on('error', (err) => {
        console.error('Archive error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to create archive' });
        }
      });

      // Pipe archive to response
      archive.pipe(res);

      // Add files to an archive
      for (const filename of files) {
        const filePath = path.join(uploadPath, filename);
        try {
          await fs.access(filePath);
          archive.file(filePath, { name: filename });
        } catch (fileErr) {
          console.warn(`Skipping missing file: ${filename}`);
        }
      }

      // Finalize the archive
      await archive.finalize();

    } catch (dirErr) {
      return res.status(404).json({ error: 'Model files not found' });
    }
  } catch (err) {
    console.error('Error creating bulk download:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to create bulk download' });
    }
  }
});

router.patch('/:id/visibility', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { visibility } = req.body;

    if (!visibility || !['private', 'members', 'public'].includes(visibility)) {
      return res.status(400).json({ error: 'visibility must be private, members, or public' });
    }

    const result = await pool.query(
      'UPDATE models SET visibility = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3 RETURNING *',
      [visibility, id, req.user.userId]
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

    // Delete the model from the database (cascade will handle model_versions)
    await pool.query('DELETE FROM models WHERE id = $1', [id]);

    res.json({ message: 'Model deleted successfully' });
  } catch (err) {
    console.error('Error deleting model:', err);
    res.status(500).json({ error: 'Failed to delete model' });
  }
});

module.exports = router;