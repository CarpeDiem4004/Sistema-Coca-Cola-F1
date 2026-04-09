require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../database/db');

async function main() {
  const nome    = 'Andre Rosa';
  const usuario = 'andrerosa';
  const senha   = 'Murici@2010';

  // Verifica se já existe
  const existe = await db.get('SELECT id FROM bases WHERE usuario = $1', [usuario]);
  if (existe) {
    console.log('Usuário já cadastrado. ID:', existe.id);
    process.exit(0);
  }

  const hash = bcrypt.hashSync(senha, 10);
  const r = await db.run(
    'INSERT INTO bases (nome, usuario, senha, is_admin, ativo) VALUES ($1, $2, $3, 1, 1)',
    [nome, usuario, hash]
  );

  console.log('CEO cadastrado com sucesso! ID:', r.lastInsertRowid);
  process.exit(0);
}

main().catch(err => {
  console.error('Erro:', err.message);
  process.exit(1);
});
