CREATE TABLE IF NOT EXISTS coordenadores (
  id         SERIAL PRIMARY KEY,
  nome       TEXT NOT NULL,
  usuario    TEXT UNIQUE NOT NULL,
  senha_hash TEXT NOT NULL,
  ativo      INTEGER DEFAULT 1,
  criado_em  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS coordenador_bases (
  id             SERIAL PRIMARY KEY,
  coordenador_id INTEGER NOT NULL REFERENCES coordenadores(id) ON DELETE CASCADE,
  base_id        INTEGER NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  UNIQUE(coordenador_id, base_id)
);
