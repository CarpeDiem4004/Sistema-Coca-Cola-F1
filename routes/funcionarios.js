const express = require('express');
const router  = express.Router();
const db      = require('../database/db');

function auth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ erro: 'Não autenticado.' });
  next();
}

// Listar funcionários
router.get('/', auth, async (req, res) => {
  try {
    const baseId = req.session.isAdmin ? (req.query.base_id || null) : req.session.userId;

    const rows = baseId
      ? await db.all('SELECT * FROM funcionarios WHERE base_id = ? AND ativo = 1 ORDER BY cargo, nome', [baseId])
      : await db.all(`SELECT f.*, b.nome as base_nome FROM funcionarios f JOIN bases b ON b.id = f.base_id WHERE f.ativo = 1 ORDER BY b.nome, f.cargo, f.nome`);

    res.json(rows);
  } catch (err) { res.status(500).json({ erro: 'Erro interno.' }); }
});

// Cadastrar funcionário
router.post('/', auth, async (req, res) => {
  try {
    const baseId = req.session.isAdmin ? (req.body.base_id || req.session.userId) : req.session.userId;
    const { nome, cargo, cpf } = req.body;

    if (!nome || !cargo) return res.status(400).json({ erro: 'Nome e cargo obrigatórios.' });
    if (!['motorista', 'ajudante'].includes(cargo)) return res.status(400).json({ erro: 'Cargo inválido.' });

    const r = await db.run(
      'INSERT INTO funcionarios (base_id, nome, cargo, cpf) VALUES (?, ?, ?, ?)',
      [baseId, nome, cargo, cpf || null]
    );
    res.json({ id: r.lastInsertRowid, nome, cargo });
  } catch (err) { res.status(500).json({ erro: 'Erro interno.' }); }
});

// Editar funcionário
router.put('/:id', auth, async (req, res) => {
  try {
    const { nome, cargo, cpf, ativo } = req.body;
    const func = await db.get('SELECT * FROM funcionarios WHERE id = ?', [req.params.id]);
    if (!func) return res.status(404).json({ erro: 'Funcionário não encontrado.' });
    if (!req.session.isAdmin && func.base_id !== req.session.userId)
      return res.status(403).json({ erro: 'Sem permissão.' });

    await db.run(
      'UPDATE funcionarios SET nome=?, cargo=?, cpf=?, ativo=? WHERE id=?',
      [nome ?? func.nome, cargo ?? func.cargo, cpf ?? func.cpf, ativo ?? func.ativo, func.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ erro: 'Erro interno.' }); }
});

// Desativar funcionário
router.delete('/:id', auth, async (req, res) => {
  try {
    const func = await db.get('SELECT * FROM funcionarios WHERE id = ?', [req.params.id]);
    if (!func) return res.status(404).json({ erro: 'Funcionário não encontrado.' });
    if (!req.session.isAdmin && func.base_id !== req.session.userId)
      return res.status(403).json({ erro: 'Sem permissão.' });

    await db.run('UPDATE funcionarios SET ativo = 0 WHERE id = ?', [func.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ erro: 'Erro interno.' }); }
});

module.exports = router;
