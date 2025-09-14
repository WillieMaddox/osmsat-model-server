const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
require('dotenv').config();

const { initializeDatabase } = require('./init');
const authRoutes = require('./routes/auth');
const modelRoutes = require('./routes/models');
const userRoutes = require('./routes/users');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      // Remove upgrade-insecure-requests to prevent HTTP->HTTPS upgrades
    },
    useDefaults: false,  // Don't use default CSP which includes upgrade-insecure-requests
  },
  crossOriginOpenerPolicy: false,  // Disable COOP header that forces HTTPS
  originAgentCluster: false,       // Disable Origin-Agent-Cluster header
  hsts: false,                     // Disable HTTPS strict transport security
}));
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.get('/register', async (req, res) => {
  const token = req.query.token;
  
  if (token) {
    try {
      const { pool } = require('./database');
      const result = await pool.query(
        'SELECT id FROM users WHERE invite_token = $1 AND invite_token_expires > NOW()',
        [token]
      );
      
      if (result.rows.length === 0) {
        return res.status(400).send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Invalid Invite Link</title>
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
              .error { color: #721c24; background: #f8d7da; padding: 20px; border-radius: 5px; display: inline-block; }
            </style>
          </head>
          <body>
            <div class="error">
              <h2>Invalid or Expired Invite Link</h2>
              <p>This invite link is either invalid or has expired.</p>
              <p>Please request a new invite link from the person who invited you.</p>
            </div>
          </body>
          </html>
        `);
      }
    } catch (err) {
      console.error('Token validation error:', err);
      return res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Server Error</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
            .error { color: #721c24; background: #f8d7da; padding: 20px; border-radius: 5px; display: inline-block; }
          </style>
        </head>
        <body>
          <div class="error">
            <h2>Server Error</h2>
            <p>Unable to validate invite token. Please try again later.</p>
          </div>
        </body>
        </html>
      `);
    }
  }
  
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use(express.static(path.join(__dirname, '../public')));

app.use('/api/auth', authRoutes);
app.use('/api/models', modelRoutes);
app.use('/api/users', userRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.get('/api/auth/registration-enabled', (req, res) => {
  // Check new variable first, fall back to old for backward compatibility
  const disableRegistration = process.env.DISABLE_REGISTRATION_WITHOUT_LINK === 'true' || 
                               process.env.DISABLE_REGISTRATION === 'true';
  const registrationEnabled = !disableRegistration;
  res.json({ enabled: registrationEnabled });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`OSMSAT Model Server running on port ${PORT}`);
  await initializeDatabase();
});

module.exports = app;