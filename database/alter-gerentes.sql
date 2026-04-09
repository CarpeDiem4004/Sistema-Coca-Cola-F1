CREATE TABLE IF NOT EXISTS gerentes (
  id         SERIAL PRIMARY KEY,
  nome       TEXT NOT NULL,
  usuario    TEXT UNIQUE NOT NULL,
  senha_hash TEXT NOT NULL,
  ativo      INTEGER DEFAULT 1,
  criado_em  TIMESTAMP DEFAULT NOW()
);
