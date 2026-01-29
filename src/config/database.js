const mysql = require('mysql2/promise');

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST || 'localhost',
      port: parseInt(process.env.MYSQL_PORT || '3306'),
      user: process.env.MYSQL_USER || 'abtest',
      password: process.env.MYSQL_PASSWORD || 'testpass',
      database: process.env.MYSQL_DATABASE || 'abtest_db',
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      // Azure MySQL Flexible Server requires SSL
      ssl: process.env.MYSQL_HOST?.includes('azure.com') 
        ? { rejectUnauthorized: false }
        : undefined
    });
  }
  return pool;
}

module.exports = {
  getPool,
  
  async query(sql, params = []) {
    const [rows] = await getPool().execute(sql, params);
    return rows;
  },
  
  async execute(sql, params = []) {
    const [result] = await getPool().execute(sql, params);
    return result;
  },
  
  async testConnection() {
    const conn = await getPool().getConnection();
    conn.release();
  },
  
  async close() {
    if (pool) {
      await pool.end();
      pool = null;
    }
  }
};
