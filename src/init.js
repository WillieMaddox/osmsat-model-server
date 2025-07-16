const { createTables } = require('./database');

const initializeDatabase = async () => {
  console.log('Initializing database...');
  await createTables();
  console.log('Database initialization complete');
};

if (require.main === module) {
  initializeDatabase().catch(console.error);
}

module.exports = { initializeDatabase };