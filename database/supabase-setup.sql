-- ============================================================
-- Coca-Cola F1 – Schema para Supabase (PostgreSQL)
-- Execute este script no SQL Editor do Supabase
-- ============================================================

-- Bases (cada filial + admin)
CREATE TABLE IF NOT EXISTS bases (
  id         SERIAL PRIMARY KEY,
  nome       TEXT NOT NULL,
  usuario    TEXT UNIQUE NOT NULL,
  senha      TEXT NOT NULL,
  cidade     TEXT,
  is_admin   INTEGER DEFAULT 0,
  ativo      INTEGER DEFAULT 1,
  criado_em  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Operadores vinculados a cada base
CREATE TABLE IF NOT EXISTS operadores (
  id         SERIAL PRIMARY KEY,
  base_id    INTEGER NOT NULL REFERENCES bases(id),
  nome       TEXT NOT NULL,
  usuario    TEXT UNIQUE NOT NULL,
  senha      TEXT NOT NULL,
  ativo      INTEGER DEFAULT 1,
  criado_em  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Funcionários (motoristas e ajudantes) de cada base
CREATE TABLE IF NOT EXISTS funcionarios (
  id         SERIAL PRIMARY KEY,
  base_id    INTEGER NOT NULL REFERENCES bases(id),
  nome       TEXT NOT NULL,
  cargo      TEXT NOT NULL CHECK(cargo IN ('motorista','ajudante')),
  cpf        TEXT,
  ativo      INTEGER DEFAULT 1,
  criado_em  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Relatórios diários
CREATE TABLE IF NOT EXISTS relatorios (
  id               SERIAL PRIMARY KEY,
  base_id          INTEGER NOT NULL REFERENCES bases(id),
  data_referencia  TEXT NOT NULL,
  postado_em       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status           TEXT DEFAULT 'enviado'
);

-- Rotas de entrega dentro de cada relatório
CREATE TABLE IF NOT EXISTS rotas (
  id                    SERIAL PRIMARY KEY,
  relatorio_id          INTEGER NOT NULL REFERENCES relatorios(id),
  numero_rota           TEXT NOT NULL,
  motorista_id          INTEGER REFERENCES funcionarios(id),
  ajudante_id           INTEGER REFERENCES funcionarios(id),
  qtd_saiu              INTEGER DEFAULT 0,
  qtd_entregou          INTEGER DEFAULT 0,
  qtd_devolveu          INTEGER DEFAULT 0,
  valor_recebido        NUMERIC(10,2) DEFAULT 0,
  valor_esperado        NUMERIC(10,2) DEFAULT 0,
  mercadorias_faltando  TEXT,
  desconto_equipe       INTEGER DEFAULT 0,
  motivo_desconto       TEXT,
  valor_desconto        NUMERIC(10,2) DEFAULT 0,
  observacoes           TEXT
);

-- Alertas de bases que não postaram
CREATE TABLE IF NOT EXISTS alertas (
  id               SERIAL PRIMARY KEY,
  base_id          INTEGER NOT NULL REFERENCES bases(id),
  data_referencia  TEXT NOT NULL,
  tipo             TEXT NOT NULL,
  mensagem         TEXT,
  lido             INTEGER DEFAULT 0,
  criado_em        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ── Usuário admin inicial (senha: admin123) ──────────────────────────────────
-- bcrypt hash de "admin123"
INSERT INTO bases (nome, usuario, senha, cidade, is_admin)
VALUES ('DIRETORIA', 'admin', '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Central', 1)
ON CONFLICT (usuario) DO NOTHING;
