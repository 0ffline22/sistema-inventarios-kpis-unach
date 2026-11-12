const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'inventario_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
});

pool.on('connect', () => {
  console.log('Conexión exitosa a PostgreSQL en Windows (10.97.0.1:5432)');
});

pool.on('error', (err) => {
  console.error('Error en la conexión a la base de datos:', err);
});

module.exports = pool;