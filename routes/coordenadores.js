const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const db      = require('../database/db');

function auth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ erro: 'Não autenticado.' });
  next();
}
function ceoOnly(req, res, next) {
  if (!req.session.isCeo) return res.status(403).json({ erro: 'Apenas o CEO pode gerenciar coordenadores.' });
  next();
}

// ── Listar coordenadores ──────────────────────────────────────────────────────
router.get('/', auth, ceoOnly, async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT c.id, c.nome, c.usuario, c.ativo, c.criado_em,
             COUNT(cb.base_id) AS total_bases
      FROM coordenadores c
      LEFT JOIN coordenador_bases cb ON cb.coordenador_id = c.id
      GROUP BY c.id, c.nome, c.usuario, c.ativo, c.criado_em
      ORDER BY c.nome
    `);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro interno.' }); }
});

// ── Criar coordenador ─────────────────────────────────────────────────────────
router.post('/', auth, ceoOnly, async (req, res) => {
  try {
    const { nome, usuario, senha, base_ids } = req.body;
    if (!nome || !usuario || !senha)
      return res.status(400).json({ erro: 'Nome, usuário e senha são obrigatórios.' });

    const existe = await db.get('SELECT id FROM coordenadores WHERE usuario = ?', [usuario]);
    if (existe) return res.status(409).json({ erro: 'Usuário já cadastrado.' });

    const hash   = bcrypt.hashSync(senha, 10);
    const result = await db.run(
      'INSERT INTO coordenadores (nome, usuario, senha_hash) VALUES (?, ?, ?)',
      [nome, usuario, hash]
    );
    const coordId = result.lastInsertRowid;

    // Vincular bases
    if (Array.isArray(base_ids) && base_ids.length > 0) {
      for (const bid of base_ids) {
        await db.run(
          'INSERT INTO coordenador_bases (coordenador_id, base_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
          [coordId, bid]
        );
      }
    }

    res.json({ id: coordId, ok: true });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro interno.' }); }
});

// ── Atualizar coordenador ─────────────────────────────────────────────────────
router.put('/:id', auth, ceoOnly, async (req, res) => {
  try {
    const { nome, senha, ativo } = req.body;
    if (nome)            await db.run('UPDATE coordenadores SET nome = ? WHERE id = ?', [nome, req.params.id]);
    if (senha)           await db.run('UPDATE coordenadores SET senha_hash = ? WHERE id = ?', [bcrypt.hashSync(senha, 10), req.params.id]);
    if (ativo !== undefined) await db.run('UPDATE coordenadores SET ativo = ? WHERE id = ?', [ativo, req.params.id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro interno.' }); }
});

// ── Excluir coordenador ───────────────────────────────────────────────────────
router.delete('/:id', auth, ceoOnly, async (req, res) => {
  try {
    await db.run('DELETE FROM coordenadores WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro interno.' }); }
});

// ── Listar bases do coordenador ───────────────────────────────────────────────
router.get('/:id/bases', auth, ceoOnly, async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT b.id, b.nome, b.cidade, b.ativo
      FROM coordenador_bases cb
      JOIN bases b ON b.id = cb.base_id
      WHERE cb.coordenador_id = ?
      ORDER BY b.nome
    `, [req.params.id]);
    res.json(rows);
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro interno.' }); }
});

// ── Salvar bases do coordenador (substitui tudo) ──────────────────────────────
router.put('/:id/bases', auth, ceoOnly, async (req, res) => {
  try {
    const { base_ids } = req.body;
    await db.run('DELETE FROM coordenador_bases WHERE coordenador_id = ?', [req.params.id]);
    if (Array.isArray(base_ids) && base_ids.length > 0) {
      for (const bid of base_ids) {
        await db.run(
          'INSERT INTO coordenador_bases (coordenador_id, base_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
          [req.params.id, bid]
        );
      }
    }
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro interno.' }); }
});

// ── Bases do coordenador logado ───────────────────────────────────────────────
router.get('/minhas-bases', auth, async (req, res) => {
  try {
    if (!req.session.isCoordinador)
      return res.status(403).json({ erro: 'Sem permissão.' });

    const ids = req.session.coordenadorBases || [];
    if (ids.length === 0) return res.json([]);

    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    const rows = await db.pool.query(
      `SELECT id, nome, cidade, ativo FROM bases WHERE id IN (${placeholders}) ORDER BY nome`,
      ids
    );
    res.json(rows.rows);
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro interno.' }); }
});

module.exports = router;
