const { Pool } = require('pg');

const pool = new Pool({
  user: process.env.DB_USER || 'osmsat',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'osmsat_models',
  password: process.env.DB_PASSWORD || 'osmsat123',
  port: process.env.DB_PORT || 5432,
});

const createTables = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS models (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        task_type VARCHAR(20) NOT NULL CHECK (task_type IN ('detect', 'obb', 'pose')),
        zoom_level INTEGER DEFAULT 19 CHECK (zoom_level BETWEEN 8 AND 21),
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        is_public BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS model_versions (
        id SERIAL PRIMARY KEY,
        model_id INTEGER REFERENCES models(id) ON DELETE CASCADE,
        version VARCHAR(20) NOT NULL,
        file_path VARCHAR(255) NOT NULL,
        file_size BIGINT,
        metadata JSONB,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_models_task_type ON models(task_type);
      CREATE INDEX IF NOT EXISTS idx_models_public ON models(is_public);
      CREATE INDEX IF NOT EXISTS idx_model_versions_active ON model_versions(is_active);
    `);

    // Add zoom_level column if it doesn't exist (migration)
    try {
      await client.query(`
        ALTER TABLE models ADD COLUMN IF NOT EXISTS zoom_level INTEGER DEFAULT 19 CHECK (zoom_level BETWEEN 8 AND 21);
      `);
      console.log('Migration: zoom_level column added/verified');
    } catch (err) {
      console.log('Migration note: zoom_level column may already exist');
    }

    console.log('Database tables created successfully');
  } catch (err) {
    console.error('Error creating tables:', err);
  } finally {
    client.release();
  }
};

module.exports = {
  pool,
  createTables
};