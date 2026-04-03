import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 8889,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASS || 'root',
  database: process.env.DB_NAME || 'botline',
  waitForConnections: true,
  connectionLimit: 10,
});

// Test connection on startup
pool.query('SELECT 1')
  .then(() => console.log('✅ MySQL connected'))
  .catch(err => console.error('❌ MySQL error:', err.message));

export default pool;
