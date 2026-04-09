const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const db      = require('../database/db');

router.post('/login', async (req, res) => {
  try {
    const { usuario, senha } = req.body;
    if (!usuario || !senha)
      return res.status(400).json({ erro: 'Usuário e senha obrigatórios.' });

    // 1. Tentar como base ou admin
    const base = await db.get('SELECT * FROM bases WHERE usuario = $1 AND ativo = 1', [usuario]);
    if (base && bcrypt.compareSync(senha, base.senha)) {
      req.session.userId     = base.id;
      req.session.usuario    = base.usuario;
      req.session.nome       = base.nome;
      req.session.isAdmin    = !!base.is_admin;
      req.session.operadorId = null;

      return res.json({
        id:      base.id,
        nome:    base.nome,
        usuario: base.usuario,
        isAdmin: !!base.is_admin
      });
    }

    // 2. Tentar como operador
    const op = await db.get(`
      SELECT o.*, b.nome as base_nome, b.ativo as base_ativa
      FROM operadores o JOIN bases b ON b.id = o.base_id
      WHERE o.usuario = $1 AND o.ativo = 1
    `, [usuario]);

    if (op && bcrypt.compareSync(senha, op.senha)) {
      if (!op.base_ativa)
        return res.status(403).json({ erro: 'A base deste operador está desativada.' });

      req.session.userId     = op.base_id;
      req.session.usuario    = op.usuario;
      req.session.nome       = `${op.nome} (${op.base_nome})`;
      req.session.isAdmin    = false;
      req.session.operadorId = op.id;

      return res.json({
        id:      op.base_id,
        nome:    `${op.nome} (${op.base_nome})`,
        usuario: op.usuario,
        isAdmin: false
      });
    }

    return res.status(401).json({ erro: 'Usuário ou senha inválidos.' });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ erro: 'Erro interno.' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ erro: 'Não autenticado.' });
  res.json({
    id:         req.session.userId,
    nome:       req.session.nome,
    usuario:    req.session.usuario,
    isAdmin:    !!req.session.isAdmin,
    operadorId: req.session.operadorId || null
  });
});

module.exports = router;
