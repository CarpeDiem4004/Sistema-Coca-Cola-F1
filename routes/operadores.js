const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const db      = require('../database/db');

function adminOnly(req, res, next) {
  if (!req.session.userId || !req.session.isAdmin)
    return res.status(403).json({ erro: 'Apenas administradores.' });
  next();
}

// Listar operadores
router.get('/', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ erro: 'Não autenticado.' });
  try {
    if (req.session.isAdmin) {
      const base_id = req.query.base_id || null;
      const rows = base_id
        ? await db.all('SELECT id, base_id, nome, usuario, ativo, criado_em FROM operadores WHERE base_id = ? ORDER BY nome', [base_id])
        : await db.all(`SELECT o.id, o.base_id, o.nome, o.usuario, o.ativo, o.criado_em, b.nome as base_nome
                        FROM operadores o JOIN bases b ON b.id = o.base_id ORDER BY b.nome, o.nome`);
      return res.json(rows);
    }
    const rows = await db.all(
      'SELECT id, base_id, nome, usuario, ativo, criado_em FROM operadores WHERE base_id = ? ORDER BY nome',
      [req.session.userId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ erro: 'Erro interno.' }); }
});

// Criar operador
router.post('/', adminOnly, async (req, res) => {
  try {
    const { base_id, nome, usuario, senha } = req.body;
    if (!base_id || !nome || !usuario || !senha)
      return res.status(400).json({ erro: 'base_id, nome, usuário e senha são obrigatórios.' });

    const conflitaBase = await db.get('SELECT id FROM bases WHERE usuario = ?', [usuario]);
    const conflitaOp   = await db.get('SELECT id FROM operadores WHERE usuario = ?', [usuario]);
    if (conflitaBase || conflitaOp)
      return res.status(409).json({ erro: 'Usuário já cadastrado.' });

    const hash = bcrypt.hashSync(senha, 10);
    const r    = await db.run(
      'INSERT INTO operadores (base_id, nome, usuario, senha) VALUES (?, ?, ?, ?)',
      [base_id, nome, usuario, hash]
    );
    res.json({ id: r.lastInsertRowid, nome, usuario });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro interno.' }); }
});

// Editar operador
router.put('/:id', adminOnly, async (req, res) => {
  try {
    const { nome, senha, ativo } = req.body;
    const op = await db.get('SELECT * FROM operadores WHERE id = ?', [req.params.id]);
    if (!op) return res.status(404).json({ erro: 'Operador não encontrado.' });

    const novaSenha = senha ? bcrypt.hashSync(senha, 10) : op.senha;
    await db.run(
      'UPDATE operadores SET nome=?, senha=?, ativo=? WHERE id=?',
      [nome ?? op.nome, novaSenha, ativo ?? op.ativo, op.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ erro: 'Erro interno.' }); }
});

// Excluir operador
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const op = await db.get('SELECT * FROM operadores WHERE id = ?', [req.params.id]);
    if (!op) return res.status(404).json({ erro: 'Operador não encontrado.' });
    await db.run('DELETE FROM operadores WHERE id = ?', [op.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ erro: 'Erro interno.' }); }
});

module.exports = router;
