const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const db      = require('../database/db');

function adminOnly(req, res, next) {
  if (!req.session.userId || !req.session.isAdmin)
    return res.status(403).json({ erro: 'Apenas administradores.' });
  next();
}

// Listar todas as bases
router.get('/', adminOnly, async (req, res) => {
  try {
    const bases = await db.all(
      "SELECT id, nome, usuario, cidade, ativo, criado_em FROM bases WHERE is_admin = 0 OR is_admin IS NULL"
    );
    res.json(bases);
  } catch (err) { res.status(500).json({ erro: 'Erro interno.' }); }
});

// Criar base
router.post('/', adminOnly, async (req, res) => {
  try {
    const { nome, usuario, senha, cidade } = req.body;
    if (!nome || !usuario || !senha)
      return res.status(400).json({ erro: 'Nome, usuário e senha obrigatórios.' });

    const existe = await db.get('SELECT id FROM bases WHERE usuario = $1', [usuario]);
    if (existe) return res.status(409).json({ erro: 'Usuário já cadastrado.' });

    const hash = bcrypt.hashSync(senha, 10);
    const r    = await db.run(
      'INSERT INTO bases (nome, usuario, senha, cidade) VALUES (?, ?, ?, ?)',
      [nome, usuario, hash, cidade || null]
    );
    res.json({ id: r.lastInsertRowid, nome, usuario });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro interno.' }); }
});

// Editar base
router.put('/:id', adminOnly, async (req, res) => {
  try {
    const { nome, cidade, senha, ativo } = req.body;
    const base = await db.get('SELECT * FROM bases WHERE id = $1', [req.params.id]);
    if (!base) return res.status(404).json({ erro: 'Base não encontrada.' });

    const novaSenha = senha ? bcrypt.hashSync(senha, 10) : base.senha;
    await db.run(
      'UPDATE bases SET nome=?, cidade=?, senha=?, ativo=? WHERE id=?',
      [nome ?? base.nome, cidade ?? base.cidade, novaSenha, ativo ?? base.ativo, base.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ erro: 'Erro interno.' }); }
});

// Excluir base
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const base = await db.get('SELECT * FROM bases WHERE id = $1', [req.params.id]);
    if (!base) return res.status(404).json({ erro: 'Base não encontrada.' });
    if (base.is_admin) return res.status(403).json({ erro: 'Não é possível excluir um usuário master.' });

    await db.transaction(async (client) => {
      const c = require('../database/db').clientWrapper(client);
      const rels = await c.all('SELECT id FROM relatorios WHERE base_id = ?', [base.id]);
      for (const r of rels) {
        await c.run('DELETE FROM rotas WHERE relatorio_id = ?', [r.id]);
      }
      await c.run('DELETE FROM relatorios WHERE base_id = ?', [base.id]);
      await c.run('DELETE FROM funcionarios WHERE base_id = ?', [base.id]);
      await c.run('DELETE FROM operadores WHERE base_id = ?', [base.id]);
      await c.run('DELETE FROM alertas WHERE base_id = ?', [base.id]);
      await c.run('DELETE FROM bases WHERE id = ?', [base.id]);
    });

    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro interno.' }); }
});

module.exports = router;
