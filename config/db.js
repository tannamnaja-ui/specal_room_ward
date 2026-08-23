const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const mysql = require('mysql2/promise');

// เมื่อรันจาก pkg exe ต้องเก็บ connection.json ไว้นอก snapshot (เขียนไฟล์ไม่ได้)
// จึงเก็บไว้ในโฟลเดอร์ config/ ข้าง .exe จริงแทน
const CONFIG_DIR = process.pkg
  ? path.join(path.dirname(process.execPath), 'config')
  : __dirname;
if (process.pkg && !fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
const SETTINGS_FILE = path.join(CONFIG_DIR, 'connection.json');

function loadSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch { return null; }
}

function saveSettings(settings) {
  const dir = path.dirname(SETTINGS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

// --- Shared pool cache ---
let _pgPool = null;
let _pgPoolKey = '';
let _mysqlPool = null;
let _mysqlPoolKey = '';

function pgPoolKey(cfg) {
  return `${cfg.host}:${cfg.port}:${cfg.database}:${cfg.username}`;
}

function getSharedPgPool(cfg) {
  const key = pgPoolKey(cfg);
  if (!_pgPool || _pgPoolKey !== key) {
    if (_pgPool) _pgPool.end().catch(() => {});
    _pgPool = new Pool({
      host: cfg.host, port: parseInt(cfg.port) || 5432,
      database: cfg.database, user: cfg.username, password: cfg.password,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      query_timeout: 15000
    });
    _pgPool.on('error', (err) => console.error('PG pool error:', err.message));
    _pgPoolKey = key;
  }
  return _pgPool;
}

function getSharedMysqlPool(cfg) {
  const key = `${cfg.host}:${cfg.port}:${cfg.database}:${cfg.username}`;
  if (!_mysqlPool || _mysqlPoolKey !== key) {
    _mysqlPool = mysql.createPool({
      host: cfg.host, port: parseInt(cfg.port) || 3306,
      database: cfg.database, user: cfg.username, password: cfg.password,
      waitForConnections: true, connectionLimit: 5, idleTimeout: 30000,
      connectTimeout: 10000
    });
    _mysqlPoolKey = key;
  }
  return _mysqlPool;
}

async function testConnection(cfg) {
  if (cfg.db_type === 'postgresql') {
    const pool = new Pool({
      host: cfg.host, port: parseInt(cfg.port) || 5432,
      database: cfg.database, user: cfg.username, password: cfg.password,
      max: 1, connectionTimeoutMillis: 5000
    });
    try {
      const client = await pool.connect();
      await client.query('SELECT 1');
      client.release();
    } finally {
      await pool.end();
    }
  } else {
    const conn = await mysql.createConnection({
      host: cfg.host, port: parseInt(cfg.port) || 3306,
      database: cfg.database, user: cfg.username, password: cfg.password,
      connectTimeout: 5000
    });
    await conn.query('SELECT 1');
    await conn.end();
  }
}

async function query(sql, params = [], cfg = null) {
  if (!cfg) cfg = loadSettings();
  if (!cfg) throw new Error('ไม่พบการตั้งค่าการเชื่อมต่อ กรุณาตั้งค่าก่อนใช้งาน');

  if (cfg.db_type === 'postgresql') {
    const pool = getSharedPgPool(cfg);
    const result = await pool.query(sql, params);
    return result.rows;
  } else {
    const pool = getSharedMysqlPool(cfg);
    const mysqlSql = sql.replace(/\$\d+/g, '?');
    const [rows] = await pool.query({ sql: mysqlSql, timeout: 15000 }, params);
    return rows;
  }
}

module.exports = { loadSettings, saveSettings, testConnection, query };
