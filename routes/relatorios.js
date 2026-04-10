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

// ── Dashboard resumido (admin) ────────────────────────────────────────────────
// IMPORTANTE: rotas com segmentos fixos devem vir ANTES de /:id
router.get('/dashboard/resumo', auth, async (req, res) => {
  if (!req.session.isAdmin) return res.status(403).json({ erro: 'Sem permissão.' });
  try {
    const { data } = req.query;
    const dataRef  = data || new Date().toISOString().slice(0, 10);

    // Horário limite: 10h (Brasília)
    const horaLimite = 10;
    const agora = new Date();
    const horaAtual = agora.getHours();

    const bases = await db.all(
      "SELECT * FROM bases WHERE (is_admin = 0 OR is_admin IS NULL) AND ativo = 1"
    );

    // Buscar relatórios do dia
    const relatorios = await db.all(
      `SELECT r.*, b.nome as base_nome, b.cidade,
              (SELECT SUM(rt.valor_desconto) FROM rotas rt WHERE rt.relatorio_id = r.id) as valor_total,
              (SELECT COUNT(*) FROM rotas rt WHERE rt.relatorio_id = r.id AND rt.status_desconto NOT IN ('nenhum','abonar')) as ocorrencias
         FROM relatorios r
         JOIN bases b ON b.id = r.base_id
        WHERE r.data_referencia = ?`,
      [dataRef]
    );

    // Mapear relatórios por base
    const relPorBase = {};
    relatorios.forEach(r => { relPorBase[r.base_id] = r; });

    // Montar lista de status das bases
    const resultado = bases.map((b) => {
      const rel = relPorBase[b.id];
      return {
        base_id:    b.id,
        base_nome:  b.nome,
        cidade:     b.cidade,
        postou:     !!rel,
        postado_em: rel?.postado_em || null,
        valor_total: rel?.valor_total || 0,
        ocorrencias: rel?.ocorrencias || 0,
        relatorio:  rel || null
      };
    });

    // Bases pendentes após 10h
    const pendentes = (horaAtual >= horaLimite)
      ? resultado.filter(b => !b.postou)
      : [];

    // Ranking de ocorrências e valores
    const rankingOcorrencias = [...resultado]
      .filter(b => b.ocorrencias > 0)
      .sort((a, b) => b.ocorrencias - a.ocorrencias)
      .slice(0, 5);

    const rankingValores = [...resultado]
      .filter(b => b.valor_total > 0)
      .sort((a, b) => b.valor_total - a.valor_total)
      .slice(0, 5);

    res.json({
      data: dataRef,
      bases: resultado,
      pendentes,
      horaLimite,
      horaAtual,
      rankingOcorrencias,
      rankingValores
    });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro interno.' }); }
});

// ── Stats / Mini-dash da base ─────────────────────────────────────────────────
router.get('/stats/base', auth, async (req, res) => {
  try {
    const baseId = req.session.isAdmin ? (req.query.base_id || null) : req.session.userId;
    if (!baseId) return res.status(400).json({ erro: 'base_id obrigatório para admin.' });

    // Totais gerais
    const totais = await db.pool.query(`
      SELECT
        COUNT(DISTINCT r.id)                          AS total_relatorios,
        COUNT(rt.id)                                  AS total_rotas,
        COUNT(rt.id) FILTER (WHERE rt.status_desconto NOT IN ('nenhum','abonar')) AS total_descontos,
        COALESCE(SUM(rt.valor_desconto) FILTER (WHERE rt.status_desconto NOT IN ('nenhum','abonar')), 0) AS total_valor_desconto
      FROM relatorios r
      LEFT JOIN rotas rt ON rt.relatorio_id = r.id
      WHERE r.base_id = $1
    `, [baseId]);

    // Últimos 6 meses
    const porMes = await db.pool.query(`
      SELECT
        TO_CHAR(r.data_referencia, 'YYYY-MM') AS mes,
        COUNT(DISTINCT r.id)                  AS relatorios,
        COUNT(rt.id)                          AS rotas,
        COALESCE(SUM(rt.valor_desconto) FILTER (WHERE rt.status_desconto NOT IN ('nenhum','abonar')), 0) AS valor_desconto
      FROM relatorios r
      LEFT JOIN rotas rt ON rt.relatorio_id = r.id
      WHERE r.base_id = $1
        AND r.data_referencia >= CURRENT_DATE - INTERVAL '6 months'
      GROUP BY mes
      ORDER BY mes DESC
    `, [baseId]);

    // Ranking motoristas (top 10 por rotas)
    const rankMotoristas = await db.pool.query(`
      SELECT
        f.id,
        f.nome,
        f.cpf,
        COUNT(rt.id)                          AS total_rotas,
        COALESCE(SUM(rt.valor_desconto) FILTER (WHERE rt.status_desconto = 'motorista'), 0) AS total_desconto
      FROM rotas rt
      JOIN relatorios r ON r.id = rt.relatorio_id
      JOIN funcionarios f ON f.id = rt.motorista_id
      WHERE r.base_id = $1
      GROUP BY f.id, f.nome, f.cpf
      ORDER BY total_rotas DESC
      LIMIT 10
    `, [baseId]);

    // Ranking ajudantes (top 10 por rotas)
    const rankAjudantes = await db.pool.query(`
      SELECT
        f.id,
        f.nome,
        f.cpf,
        COUNT(rt.id) AS total_rotas
      FROM (
        SELECT ajudante_id AS fid, relatorio_id FROM rotas WHERE ajudante_id IS NOT NULL
        UNION ALL
        SELECT ajudante2_id AS fid, relatorio_id FROM rotas WHERE ajudante2_id IS NOT NULL
      ) aj
      JOIN relatorios r ON r.id = aj.relatorio_id
      JOIN funcionarios f ON f.id = aj.fid
      WHERE r.base_id = $1
      GROUP BY f.id, f.nome, f.cpf
      ORDER BY total_rotas DESC
      LIMIT 10
    `, [baseId]);

    // Breakdown por status de desconto
    const statusDescontos = await db.pool.query(`
      SELECT
        rt.status_desconto,
        COUNT(*)                            AS quantidade,
        COALESCE(SUM(rt.valor_desconto), 0) AS valor_total
      FROM rotas rt
      JOIN relatorios r ON r.id = rt.relatorio_id
      WHERE r.base_id = $1
      GROUP BY rt.status_desconto
    `, [baseId]);

    res.json({
      totais:         totais.rows[0],
      porMes:         porMes.rows,
      rankMotoristas: rankMotoristas.rows,
      rankAjudantes:  rankAjudantes.rows,
      statusDescontos: statusDescontos.rows
    });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro interno.' }); }
});

// ── Busca funcionário por nome ou CPF ─────────────────────────────────────────
router.get('/stats/funcionario', auth, async (req, res) => {
  try {
    const baseId = req.session.isAdmin ? (req.query.base_id || null) : req.session.userId;
    const { busca } = req.query;
    if (!busca) return res.status(400).json({ erro: 'Parâmetro busca obrigatório.' });

    const term = `%${busca}%`;
    const baseFilter = baseId ? 'AND r.base_id = $3' : '';
    const params = baseId ? [term, term, baseId] : [term, term];

    const funcResult = await db.pool.query(`
      SELECT DISTINCT f.id, f.nome, f.cpf, f.cargo
      FROM funcionarios f
      JOIN (
        SELECT motorista_id AS fid, relatorio_id FROM rotas WHERE motorista_id IS NOT NULL
        UNION
        SELECT ajudante_id  AS fid, relatorio_id FROM rotas WHERE ajudante_id  IS NOT NULL
        UNION
        SELECT ajudante2_id AS fid, relatorio_id FROM rotas WHERE ajudante2_id IS NOT NULL
      ) rel ON rel.fid = f.id
      JOIN relatorios r ON r.id = rel.relatorio_id
      WHERE (LOWER(f.nome) LIKE LOWER($1) OR f.cpf LIKE $2)
      ${baseFilter}
      LIMIT 20
    `, params);

    if (funcResult.rows.length === 0) return res.json({ funcionarios: [], rotas: [] });

    const ids = funcResult.rows.map(f => f.id);
    const ph  = ids.map((_, i) => `$${i + 1}`).join(',');
    const baseFilterRotas = baseId ? `AND r.base_id = $${ids.length + 1}` : '';
    const paramsRotas = baseId ? [...ids, baseId] : ids;

    const rotasResult = await db.pool.query(`
      SELECT
        rt.id, rt.numero_rota, rt.numero_f1,
        rt.status_desconto, rt.valor_desconto, rt.motivo_desconto,
        r.data_referencia, b.nome AS base_nome,
        m.id  AS mot_id,  m.nome  AS motorista_nome,
        a.id  AS aj1_id,  a.nome  AS ajudante_nome,
        a2.id AS aj2_id,  a2.nome AS ajudante2_nome
      FROM rotas rt
      JOIN relatorios r  ON r.id  = rt.relatorio_id
      JOIN bases b        ON b.id  = r.base_id
      LEFT JOIN funcionarios m  ON m.id  = rt.motorista_id
      LEFT JOIN funcionarios a  ON a.id  = rt.ajudante_id
      LEFT JOIN funcionarios a2 ON a2.id = rt.ajudante2_id
      WHERE (rt.motorista_id IN (${ph})
          OR rt.ajudante_id  IN (${ph})
          OR rt.ajudante2_id IN (${ph}))
      ${baseFilterRotas}
      ORDER BY r.data_referencia DESC
      LIMIT 100
    `, paramsRotas);

    res.json({ funcionarios: funcResult.rows, rotas: rotasResult.rows });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro interno.' }); }
});

// ── Alterar status do relatório (em_andamento ↔ finalizado) ──────────────────
router.put('/:id/status', auth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['em_andamento', 'finalizado'].includes(status))
      return res.status(400).json({ erro: 'Status inválido. Use "em_andamento" ou "finalizado".' });

    const rel = await db.get('SELECT * FROM relatorios WHERE id = ?', [req.params.id]);
    if (!rel) return res.status(404).json({ erro: 'Relatório não encontrado.' });
    if (!req.session.isAdmin && rel.base_id !== req.session.userId)
      return res.status(403).json({ erro: 'Sem permissão.' });
    if (rel.status === 'finalizado' && status === 'finalizado')
      return res.status(409).json({ erro: 'Relatório já está finalizado.' });

    await db.run('UPDATE relatorios SET status = ? WHERE id = ?', [status, req.params.id]);
    res.json({ ok: true, status });
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

// ── Detalhe de um relatório (com rotas) ── DEVE VIR POR ÚLTIMO ───────────────
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
      SELECT rt.*,
             m.nome  as motorista_nome,
             a.nome  as ajudante_nome,
             a2.nome as ajudante2_nome
      FROM rotas rt
      LEFT JOIN funcionarios m  ON m.id  = rt.motorista_id
      LEFT JOIN funcionarios a  ON a.id  = rt.ajudante_id
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
      'SELECT id, status FROM relatorios WHERE base_id = ? AND data_referencia = ?',
      [baseId, data_referencia]
    );
    if (jaExiste) {
      if (jaExiste.status === 'finalizado')
        return res.status(409).json({ erro: 'finalizado', msg: 'Este relatório está finalizado e não pode ser alterado.' });
      return res.status(409).json({ erro: 'Já existe relatório para esta data.' });
    }

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
             status_desconto, desconto_equipe,
             valor_desconto, motivo_desconto, comprovante_url)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          rel.lastInsertRowid,
          r.numero_rota,
          r.numero_f1            || null,
          r.motorista_id         || null,
          r.ajudante_id          || null,
          r.ajudante2_id         || null,
          r.mercadorias_faltando || null,
          r.nf_url               || null,
          r.status_desconto      || 'nenhum',
          r.desconto_equipe      || 0,
          r.valor_desconto       || 0,
          r.motivo_desconto      || null,
          r.comprovante_url      || null
        ]);
      }
      return rel.lastInsertRowid;
    });

    res.json({ id: relId, ok: true });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro interno.' }); }
});

module.exports = router;
