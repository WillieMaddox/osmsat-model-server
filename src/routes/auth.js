const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pool } = require('../database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.post('/register', async (req, res) => {
  const { username, email, password, token } = req.body;
  
  let isInviteTokenValid = false;
  let inviteUserId = null;
  
  if (token) {
    try {
      const inviteTokenResult = await pool.query(
        'SELECT id FROM users WHERE invite_token = $1 AND invite_token_expires > NOW()',
        [token]
      );
      
      if (inviteTokenResult.rows.length > 0) {
        isInviteTokenValid = true;
        inviteUserId = inviteTokenResult.rows[0].id;
      }
    } catch (err) {
      console.error('Invite token validation error:', err);
    }
  }
  
  if (process.env.DISABLE_REGISTRATION === 'true' && !isInviteTokenValid) {
    return res.status(403).json({ error: 'Registration is disabled' });
  }

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email, and password are required' });
  }

  try {
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'Username or email already exists' });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    const result = await pool.query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email',
      [username, email, passwordHash]
    );

    const user = result.rows[0];
    const authToken = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: '7d' }
    );


    res.status(201).json({
      user: { id: user.id, username: user.username, email: user.email },
      token: authToken
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const result = await pool.query(
      'SELECT id, username, email, password_hash FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const isValidPassword = await bcrypt.compare(password, user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET || 'fallback-secret',
      { expiresIn: '7d' }
    );

    res.json({
      user: { id: user.id, username: user.username, email: user.email },
      token
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/generate-invite-token', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const existingUser = await pool.query(
      'SELECT invite_token FROM users WHERE id = $1',
      [userId]
    );
    
    if (existingUser.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    if (existingUser.rows[0].invite_token) {
      return res.json({
        token: existingUser.rows[0].invite_token,
        url: `${req.protocol}://${req.get('host')}/register?token=${existingUser.rows[0].invite_token}`
      });
    }
    
    const inviteToken = crypto.randomBytes(8).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    
    await pool.query(
      'UPDATE users SET invite_token = $1, invite_token_expires = $2 WHERE id = $3',
      [inviteToken, expiresAt, userId]
    );
    
    res.json({
      token: inviteToken,
      url: `${req.protocol}://${req.get('host')}/register?token=${inviteToken}`
    });
  } catch (err) {
    console.error('Generate invite token error:', err);
    res.status(500).json({ error: 'Failed to generate invite token' });
  }
});

router.post('/reset-invite-token', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const inviteToken = crypto.randomBytes(8).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    
    await pool.query(
      'UPDATE users SET invite_token = $1, invite_token_expires = $2 WHERE id = $3',
      [inviteToken, expiresAt, userId]
    );
    
    res.json({
      token: inviteToken,
      url: `${req.protocol}://${req.get('host')}/register?token=${inviteToken}`
    });
  } catch (err) {
    console.error('Reset invite token error:', err);
    res.status(500).json({ error: 'Failed to reset invite token' });
  }
});

module.exports = router;