/**
 * Executa todas as migrações necessárias no banco de dados.
 * Usa IF NOT EXISTS / ADD COLUMN IF NOT EXISTS para ser seguro sempre.
 * Chamado automaticamente no startup do servidor.
 */
const db = require('./db');

async function runMigrations() {
  console.log('[MIGRAÇÃO] Verificando estrutura do banco...');

  const migrações = [
    // ── Tabela: relatorios ──────────────────────────────────────────────────
    `ALTER TABLE relatorios ADD COLUMN IF NOT EXISTS status              TEXT DEFAULT 'em_andamento'`,
    // Corrige registros antigos que ficaram com status NULL
    `UPDATE relatorios SET status = 'em_andamento' WHERE status IS NULL`,
    `ALTER TABLE relatorios ADD COLUMN IF NOT EXISTS criado_por_tipo     TEXT DEFAULT 'base'`,
    `ALTER TABLE relatorios ADD COLUMN IF NOT EXISTS criado_por_nome     TEXT`,
    `ALTER TABLE relatorios ADD COLUMN IF NOT EXISTS finalizado_por_tipo TEXT`,
    `ALTER TABLE relatorios ADD COLUMN IF NOT EXISTS finalizado_por_nome TEXT`,
    `ALTER TABLE relatorios ADD COLUMN IF NOT EXISTS finalizado_em       TIMESTAMP`,

    // ── Tabela: rotas ───────────────────────────────────────────────────────
    `ALTER TABLE rotas ADD COLUMN IF NOT EXISTS numero_f1        TEXT`,
    `ALTER TABLE rotas ADD COLUMN IF NOT EXISTS ajudante2_id     INTEGER REFERENCES funcionarios(id)`,
    `ALTER TABLE rotas ADD COLUMN IF NOT EXISTS nf_url           TEXT`,
    `ALTER TABLE rotas ADD COLUMN IF NOT EXISTS status_desconto  TEXT DEFAULT 'nenhum'`,
    `ALTER TABLE rotas ADD COLUMN IF NOT EXISTS comprovante_url  TEXT`,
    `ALTER TABLE rotas ADD COLUMN IF NOT EXISTS situacao         TEXT DEFAULT 'em_andamento'`,
    `UPDATE rotas SET situacao = 'em_andamento' WHERE situacao IS NULL`,

    // ── Tabela: gerentes ────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS gerentes (
      id         SERIAL PRIMARY KEY,
      nome       TEXT NOT NULL,
      usuario    TEXT UNIQUE NOT NULL,
      senha_hash TEXT NOT NULL,
      ativo      INTEGER DEFAULT 1,
      criado_em  TIMESTAMP DEFAULT NOW()
    )`,

    // ── Tabela: coordenadores ───────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS coordenadores (
      id         SERIAL PRIMARY KEY,
      nome       TEXT NOT NULL,
      usuario    TEXT UNIQUE NOT NULL,
      senha_hash TEXT NOT NULL,
      ativo      INTEGER DEFAULT 1,
      criado_em  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,

    // ── Tabela: coordenador_bases ───────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS coordenador_bases (
      id             SERIAL PRIMARY KEY,
      coordenador_id INTEGER NOT NULL REFERENCES coordenadores(id) ON DELETE CASCADE,
      base_id        INTEGER NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
      UNIQUE(coordenador_id, base_id)
    )`,

    // ── Tabela: alertas (caso não exista ainda) ─────────────────────────────
    `CREATE TABLE IF NOT EXISTS alertas (
      id               SERIAL PRIMARY KEY,
      base_id          INTEGER NOT NULL REFERENCES bases(id),
      data_referencia  TEXT NOT NULL,
      tipo             TEXT NOT NULL,
      mensagem         TEXT,
      lido             INTEGER DEFAULT 0,
      criado_em        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
  ];

  for (const sql of migrações) {
    try {
      await db.pool.query(sql);
    } catch (err) {
      // Erros não-críticos (ex: coluna já existe de outra forma) — apenas loga
      console.warn('[MIGRAÇÃO] Aviso:', err.message);
    }
  }

  console.log('[MIGRAÇÃO] Concluída com sucesso.');
}

module.exports = { runMigrations };
