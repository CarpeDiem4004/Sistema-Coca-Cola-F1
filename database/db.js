require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('supabase')
    ? { rejectUnauthorized: false }
    : false
});

pool.on('error', (err) => console.error('[DB] Erro inesperado no pool:', err));

// ── Converte placeholders ? → $1 $2 $3 ... ──────────────────────────────────
function convertSQL(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// ── Helpers async com a mesma API do better-sqlite3 ──────────────────────────

/** Retorna uma linha (ou null) */
async function get(sql, params = []) {
  const { rows } = await pool.query(convertSQL(sql), params);
  return rows[0] ?? null;
}

/** Retorna todas as linhas */
async function all(sql, params = []) {
  const { rows } = await pool.query(convertSQL(sql), params);
  return rows;
}

/** Executa INSERT/UPDATE/DELETE. Para INSERT usa RETURNING id. */
async function run(sql, params = []) {
  const isInsert = /^\s*INSERT/i.test(sql);
  const finalSQL = isInsert
    ? convertSQL(sql) + ' RETURNING id'
    : convertSQL(sql);
  const result = await pool.query(finalSQL, params);
  return {
    lastInsertRowid: result.rows[0]?.id ?? null,
    rowCount: result.rowCount
  };
}

/** Executa SQL direto (DDL, migrations, etc.) */
async function exec(sql) {
  await pool.query(sql);
}

/** Transação: recebe função async que usa client */
async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Wrapper de cliente para uso em transações */
function clientWrapper(client) {
  return {
    async get(sql, params = []) {
      const { rows } = await client.query(convertSQL(sql), params);
      return rows[0] ?? null;
    },
    async all(sql, params = []) {
      const { rows } = await client.query(convertSQL(sql), params);
      return rows;
    },
    async run(sql, params = []) {
      const isInsert = /^\s*INSERT/i.test(sql);
      const finalSQL = isInsert ? convertSQL(sql) + ' RETURNING id' : convertSQL(sql);
      const result = await client.query(finalSQL, params);
      return { lastInsertRowid: result.rows[0]?.id ?? null, rowCount: result.rowCount };
    }
  };
}

module.exports = { get, all, run, exec, transaction, clientWrapper, pool };
