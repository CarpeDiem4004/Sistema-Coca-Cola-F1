const express = require('express');
const router  = express.Router();
const db      = require('../database/db');

function auth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ erro: 'Não autenticado.' });
  next();
}

// ── Listar relatórios ────────────────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const { data, base_id } = req.query;
    const params = [];
    let where = 'WHERE 1=1';

    if (!req.session.isAdmin) {
      params.push(req.session.userId);
      where += ` AND r.base_id = $${params.length}`;
    } else if (base_id) {
      params.push(base_id);
      where += ` AND r.base_id = $${params.length}`;
    }

    if (data) {
      params.push(data);
      where += ` AND r.data_referencia = $${params.length}`;
    }

    const rows = await db.pool.query(`
      SELECT r.*, b.nome as base_nome, b.cidade,
             (SELECT COUNT(*) FROM rotas WHERE relatorio_id = r.id) as total_rotas
      FROM relatorios r
      JOIN bases b ON b.id = r.base_id
      ${where}
      ORDER BY r.data_referencia DESC, r.postado_em DESC
    `, params);

    res.json(rows.rows);
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro interno.' }); }
});

// ── Detalhe de um relatório (com rotas) ──────────────────────────────────────
router.get('/:id', auth, async (req, res) => {
  try {
    const rel = await db.get(`
      SELECT r.*, b.nome as base_nome, b.cidade
      FROM relatorios r JOIN bases b ON b.id = r.base_id
      WHERE r.id = ?
    `, [req.params.id]);

    if (!rel) return res.status(404).json({ erro: 'Relatório não encontrado.' });
    if (!req.session.isAdmin && rel.base_id !== req.session.userId)
      return res.status(403).json({ erro: 'Sem permissão.' });

    const rotas = await db.all(`
      SELECT rt.*, m.nome as motorista_nome, a.nome as ajudante_nome, a2.nome as ajudante2_nome
      FROM rotas rt
      LEFT JOIN funcionarios m ON m.id = rt.motorista_id
      LEFT JOIN funcionarios a ON a.id = rt.ajudante_id
      LEFT JOIN funcionarios a2 ON a2.id = rt.ajudante2_id
      WHERE rt.relatorio_id = ?
      ORDER BY rt.numero_rota
    `, [rel.id]);

    res.json({ ...rel, rotas });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro interno.' }); }
});

// ── Criar relatório + rotas ───────────────────────────────────────────────────
router.post('/', auth, async (req, res) => {
  try {
    const baseId = req.session.isAdmin ? (req.body.base_id || req.session.userId) : req.session.userId;
    const { data_referencia, rotas } = req.body;

    if (!data_referencia) return res.status(400).json({ erro: 'Data de referência obrigatória.' });
    if (!rotas || !Array.isArray(rotas) || rotas.length === 0)
      return res.status(400).json({ erro: 'Informe ao menos uma rota.' });

    const jaExiste = await db.get(
      'SELECT id FROM relatorios WHERE base_id = ? AND data_referencia = ?',
      [baseId, data_referencia]
    );
    if (jaExiste) return res.status(409).json({ erro: 'Já existe relatório para esta data.' });

    const relId = await db.transaction(async (client) => {
      const c = db.clientWrapper(client);
      const rel = await c.run(
        'INSERT INTO relatorios (base_id, data_referencia) VALUES (?, ?)',
        [baseId, data_referencia]
      );
      for (const r of rotas) {
        await c.run(`
          INSERT INTO rotas
            (relatorio_id, numero_rota, numero_f1,
             motorista_id, ajudante_id, ajudante2_id,
             mercadorias_faltando, nf_url,
             desconto_equipe, motivo_desconto, valor_desconto, observacoes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          rel.lastInsertRowid,
          r.numero_rota,
          r.numero_f1       || null,
          r.motorista_id    || null,
          r.ajudante_id     || null,
          r.ajudante2_id    || null,
          r.mercadorias_faltando || null,
          r.nf_url          || null,
          r.desconto_equipe ? 1 : 0,
          r.motivo_desconto || null,
          r.valor_desconto  || 0,
          r.observacoes     || null
        ]);
      }
      return rel.lastInsertRowid;
    });

    res.json({ id: relId, ok: true });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro interno.' }); }
});

// ── Dashboard resumido (admin) ────────────────────────────────────────────────
router.get('/dashboard/resumo', auth, async (req, res) => {
  if (!req.session.isAdmin) return res.status(403).json({ erro: 'Sem permissão.' });
  try {
    const { data } = req.query;
    const dataRef  = data || new Date().toISOString().slice(0, 10);

    const bases = await db.all(
      "SELECT * FROM bases WHERE (is_admin = 0 OR is_admin IS NULL) AND ativo = 1"
    );

    const resultado = await Promise.all(bases.map(async (b) => {
      const rel = await db.get(`
        SELECT r.*, COUNT(rt.id) as total_rotas,
               SUM(rt.qtd_saiu) as total_saiu,
               SUM(rt.qtd_entregou) as total_entregou,
               SUM(rt.qtd_devolveu) as total_devolveu,
               SUM(rt.valor_recebido) as total_recebido,
               SUM(rt.valor_esperado) as total_esperado,
               SUM(rt.desconto_equipe) as total_descontos
        FROM relatorios r
        LEFT JOIN rotas rt ON rt.relatorio_id = r.id
        WHERE r.base_id = ? AND r.data_referencia = ?
        GROUP BY r.id
      `, [b.id, dataRef]);

      return {
        base_id:    b.id,
        base_nome:  b.nome,
        cidade:     b.cidade,
        postou:     !!rel?.id,
        postado_em: rel?.postado_em || null,
        relatorio:  rel?.id ? rel : null
      };
    }));

    res.json({ data: dataRef, bases: resultado });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro interno.' }); }
});

// ── Alertas ───────────────────────────────────────────────────────────────────
router.get('/alertas/pendentes', auth, async (req, res) => {
  if (!req.session.isAdmin) return res.status(403).json({ erro: 'Sem permissão.' });
  try {
    const alertas = await db.all(`
      SELECT a.*, b.nome as base_nome, b.cidade
      FROM alertas a JOIN bases b ON b.id = a.base_id
      WHERE a.lido = 0
      ORDER BY a.criado_em DESC
    `);
    res.json(alertas);
  } catch (err) { res.status(500).json({ erro: 'Erro interno.' }); }
});

router.put('/alertas/:id/lido', auth, async (req, res) => {
  if (!req.session.isAdmin) return res.status(403).json({ erro: 'Sem permissão.' });
  try {
    await db.run('UPDATE alertas SET lido = 1 WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ erro: 'Erro interno.' }); }
});

module.exports = router;
