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
        visibility VARCHAR(10) DEFAULT 'private' CHECK (visibility IN ('private', 'members', 'public')),
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

    // Migrate from is_public to visibility column (migration)
    try {
      // Check if is_public column still exists
      const columnCheck = await client.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'models' AND column_name = 'is_public';
      `);
      
      if (columnCheck.rows.length > 0) {
        console.log('Migration: Converting is_public to visibility column...');
        
        // Add visibility column if it doesn't exist
        await client.query(`
          ALTER TABLE models ADD COLUMN IF NOT EXISTS visibility VARCHAR(10);
        `);
        
        // Migrate existing data
        await client.query(`
          UPDATE models SET visibility = CASE 
            WHEN is_public = true THEN 'public'
            WHEN is_public = false THEN 'private'
            ELSE 'private'
          END
          WHERE visibility IS NULL;
        `);
        
        // Set constraints
        await client.query(`
          ALTER TABLE models ALTER COLUMN visibility SET NOT NULL;
        `);
        await client.query(`
          ALTER TABLE models ALTER COLUMN visibility SET DEFAULT 'private';
        `);
        await client.query(`
          ALTER TABLE models ADD CONSTRAINT models_visibility_check 
          CHECK (visibility IN ('private', 'members', 'public'));
        `);
        
        // Create new index
        await client.query(`
          CREATE INDEX IF NOT EXISTS idx_models_visibility ON models(visibility);
        `);
        
        // Drop old column and index
        await client.query(`DROP INDEX IF EXISTS idx_models_public;`);
        await client.query(`ALTER TABLE models DROP COLUMN is_public;`);
        
        console.log('Migration: Successfully migrated from is_public to visibility');
      } else {
        console.log('Migration: visibility column already exists, skipping is_public migration');
      }
      
      // Ensure visibility index exists after migration
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_models_visibility ON models(visibility);
      `);
      
    } catch (err) {
      console.error('Migration error for visibility column:', err);
    }

    // Add invite token columns for issue #5 (migration)
    try {
      await client.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_token VARCHAR(16) DEFAULT NULL;
      `);
      await client.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_token_expires TIMESTAMP DEFAULT NULL;
      `);
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_users_invite_token ON users(invite_token);
      `);
      console.log('Migration: invite token columns added/verified');
    } catch (err) {
      console.error('Migration error for invite token columns:', err);
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