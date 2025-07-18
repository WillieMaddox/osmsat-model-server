const express = require('express');
const { pool } = require('../database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.get('/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, email, created_at FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching user:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

router.get('/me/models', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        m.id, m.name, m.description, m.task_type, m.zoom_level, m.visibility, m.created_at,
        mv.version, mv.file_size, mv.metadata
      FROM models m
      LEFT JOIN model_versions mv ON m.id = mv.model_id AND mv.is_active = true
      WHERE m.user_id = $1
      ORDER BY m.created_at DESC
    `, [req.user.userId]);

    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching user models:', err);
    res.status(500).json({ error: 'Failed to fetch user models' });
  }
});

module.exports = router;