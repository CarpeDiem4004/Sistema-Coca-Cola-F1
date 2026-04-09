const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const db      = require('../database/db');

function auth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ erro: 'Não autenticado.' });
  next();
}

function ceoOnly(req, res, next) {
  if (!req.session.isCeo) return res.status(403).json({ erro: 'Apenas o CEO/Admin pode gerenciar gerentes.' });
  next();
}

// ── Listar gerentes ───────────────────────────────────────────────────────────
router.get('/', auth, ceoOnly, async (req, res) => {
  try {
    const rows = await db.all('SELECT id, nome, usuario, ativo, criado_em FROM gerentes ORDER BY nome');
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro interno.' }); }
});

// ── Criar gerente ─────────────────────────────────────────────────────────────
router.post('/', auth, ceoOnly, async (req, res) => {
  try {
    const { nome, usuario, senha } = req.body;
    if (!nome || !usuario || !senha)
      return res.status(400).json({ erro: 'Nome, usuário e senha são obrigatórios.' });

    const existe = await db.get('SELECT id FROM gerentes WHERE usuario = ?', [usuario]);
    if (existe) return res.status(409).json({ erro: 'Usuário já cadastrado.' });

    const hash   = bcrypt.hashSync(senha, 10);
    const result = await db.run(
      'INSERT INTO gerentes (nome, usuario, senha_hash) VALUES (?, ?, ?)',
      [nome, usuario, hash]
    );
    res.json({ id: result.lastInsertRowid, ok: true });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro interno.' }); }
});

// ── Atualizar gerente (ativar/desativar ou nova senha) ────────────────────────
router.put('/:id', auth, ceoOnly, async (req, res) => {
  try {
    const { ativo, senha } = req.body;
    if (senha !== undefined && senha !== '') {
      const hash = bcrypt.hashSync(senha, 10);
      await db.run('UPDATE gerentes SET senha_hash = ? WHERE id = ?', [hash, req.params.id]);
    }
    if (ativo !== undefined) {
      await db.run('UPDATE gerentes SET ativo = ? WHERE id = ?', [ativo, req.params.id]);
    }
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro interno.' }); }
});

// ── Excluir gerente ───────────────────────────────────────────────────────────
router.delete('/:id', auth, ceoOnly, async (req, res) => {
  try {
    await db.run('DELETE FROM gerentes WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro interno.' }); }
});

module.exports = router;
