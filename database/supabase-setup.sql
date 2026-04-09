-- ================================================================
-- Coca-Cola F1 – Setup COMPLETO para Supabase
-- Cole TUDO isso no SQL Editor do Supabase e clique em RUN
-- ================================================================

-- 1. Remover tabelas antigas (se existirem) na ordem correta
DROP TABLE IF EXISTS alertas CASCADE;
DROP TABLE IF EXISTS rotas CASCADE;
DROP TABLE IF EXISTS relatorios CASCADE;
DROP TABLE IF EXISTS funcionarios CASCADE;
DROP TABLE IF EXISTS operadores CASCADE;
DROP TABLE IF EXISTS bases CASCADE;

-- 2. Criar tabelas
CREATE TABLE bases (
  id         SERIAL PRIMARY KEY,
  nome       TEXT NOT NULL,
  usuario    TEXT UNIQUE NOT NULL,
  senha      TEXT NOT NULL,
  cidade     TEXT,
  is_admin   INTEGER DEFAULT 0,
  ativo      INTEGER DEFAULT 1,
  criado_em  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE operadores (
  id         SERIAL PRIMARY KEY,
  base_id    INTEGER NOT NULL REFERENCES bases(id),
  nome       TEXT NOT NULL,
  usuario    TEXT UNIQUE NOT NULL,
  senha      TEXT NOT NULL,
  ativo      INTEGER DEFAULT 1,
  criado_em  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE funcionarios (
  id         SERIAL PRIMARY KEY,
  base_id    INTEGER NOT NULL REFERENCES bases(id),
  nome       TEXT NOT NULL,
  cargo      TEXT NOT NULL CHECK(cargo IN ('motorista','ajudante')),
  cpf        TEXT,
  ativo      INTEGER DEFAULT 1,
  criado_em  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE relatorios (
  id               SERIAL PRIMARY KEY,
  base_id          INTEGER NOT NULL REFERENCES bases(id),
  data_referencia  TEXT NOT NULL,
  postado_em       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status           TEXT DEFAULT 'enviado'
);

CREATE TABLE rotas (
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

CREATE TABLE alertas (
  id               SERIAL PRIMARY KEY,
  base_id          INTEGER NOT NULL REFERENCES bases(id),
  data_referencia  TEXT NOT NULL,
  tipo             TEXT NOT NULL,
  mensagem         TEXT,
  lido             INTEGER DEFAULT 0,
  criado_em        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Inserir usuários com senhas corretas
INSERT INTO bases (nome, usuario, senha, cidade, is_admin) VALUES
  ('DIRETORIA',              'admin',                               '$2b$10$f0GVRoXsjXbk0Ki9T2Dq9eJPkDpjckL4RdDfi2awdpNAQvhSM.Ebu', 'Central',         1),
  ('João Paulo – Master',    'joao.paulo@timingtransportes.com.br', '$2b$10$VMQyfzyfmd681B7hOSc6AuqVYzLP1ARWXNowxE3RsgaATzEj67f5S', 'Central',         1),
  ('Base São Paulo',         'base_sp',                             '$2b$10$cVPUp9tveDrzJV7.tYtXyev3NfhClzSij2p0nDRrwZb7iae1OgkeO', 'São Paulo',        0),
  ('Base Rio de Janeiro',    'base_rj',                             '$2b$10$Kj8zy9/.pj9MQa2jGB7j5eeouSvWHkA9Hqeo/Zit3s1DbtGXPEpnW', 'Rio de Janeiro',   0),
  ('Base Belo Horizonte',    'base_bh',                             '$2b$10$s2xT4xEiwqpvIitQ4TPsbOGlvhd8c3n8JVQPAIXDysbwX3sDzXzXW', 'Belo Horizonte',   0),
  ('Base Brasília',          'base_bsb',                            '$2b$10$rOh4efQdn/Scp7StAcJq0e3BgRHkCuQYRXC6LX3EcwnDIN4c3SQI.', 'Brasília',         0),
  ('Base Salvador',          'base_ssa',                            '$2b$10$zqOhBj3HumznxZF1maj96.7vKJndY1PujZrkVALfYiMktIkLAx9cy', 'Salvador',         0);

-- Verificar
SELECT id, nome, usuario, is_admin, ativo FROM bases ORDER BY id;
