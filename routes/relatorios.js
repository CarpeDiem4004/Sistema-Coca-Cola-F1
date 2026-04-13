const express = require('express');
const router  = express.Router();
const db      = require('../database/db');

function auth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ erro: 'Não autenticado.' });
  next();
}

/** Retorna o tipo do ator logado para auditoria */
function tipoAtor(session) {
  if (session.isCoordinador) return 'coordenador';
  if (session.isAdmin && session.isCeo) return 'ceo';
  if (session.isAdmin) return 'gerente';
  return 'base';
}

// ── Listar relatórios ────────────────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
  try {
    const { data, data_de, data_ate, base_id, status } = req.query;
    const params = [];
    let where = 'WHERE 1=1';

    if (req.session.isCoordinador) {
      // Coordenador: filtra pelas bases autorizadas
      const bases = req.session.coordenadorBases || [];
      if (bases.length === 0) return res.json([]);
      params.push(bases);
      where += ` AND r.base_id = ANY($${params.length}::int[])`;
      // Permite refinamento por base específica se estiver na lista
      if (base_id && bases.map(Number).includes(Number(base_id))) {
        params.push(base_id);
        where += ` AND r.base_id = $${params.length}`;
      }
    } else if (!req.session.isAdmin) {
      // Operador/Base: apenas a sua base
      params.push(req.session.userId);
      where += ` AND r.base_id = $${params.length}`;
    } else if (base_id) {
      // Admin/CEO: qualquer base
      params.push(base_id);
      where += ` AND r.base_id = $${params.length}`;
    }

    // Filtro de data única (compatibilidade)
    if (data) {
      params.push(data);
      where += ` AND r.data_referencia = $${params.length}`;
    }
    // Filtro de período
    if (data_de) {
      params.push(data_de);
      where += ` AND r.data_referencia >= $${params.length}`;
    }
    if (data_ate) {
      params.push(data_ate);
      where += ` AND r.data_referencia <= $${params.length}`;
    }
    // Filtro de status
    if (status) {
      params.push(status);
      where += ` AND r.status = $${params.length}`;
    }

    const rows = await db.pool.query(`
      SELECT r.*,
             b.nome  AS base_nome,
             b.cidade,
             COALESCE((SELECT COUNT(*) FROM rotas WHERE relatorio_id = r.id), 0) AS total_rotas,
             COALESCE((SELECT COUNT(*) FROM rotas WHERE relatorio_id = r.id AND status_desconto NOT IN ('nenhum','abonar')), 0) AS total_ocorrencias,
             COALESCE((SELECT SUM(valor_desconto) FROM rotas WHERE relatorio_id = r.id AND status_desconto NOT IN ('nenhum','abonar')), 0) AS total_valor_f1
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
  if (!req.session.isAdmin && !req.session.isCoordinador)
    return res.status(403).json({ erro: 'Sem permissão.' });
  try {
    const { data } = req.query;
    const dataRef  = data || new Date().toISOString().slice(0, 10);

    // Horário limite: 10h (Brasília = UTC-3)
    const horaLimite = 10;
    const agora = new Date();
    // Calcular hora e data em Brasília (UTC-3)
    const brasilia = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
    const hojeStr       = brasilia.toISOString().slice(0, 10);
    const horaAtual     = brasilia.getUTCHours(); // hora atual em Brasília

    let bases;
    if (req.session.isCoordinador) {
      const ids = req.session.coordenadorBases || [];
      if (ids.length === 0) return res.json({ data: dataRef, bases: [], pendentes: [], rankingOcorrencias: [], rankingValores: [] });
      const ph = ids.map((_, i) => `$${i + 1}`).join(',');
      const r  = await db.pool.query(`SELECT * FROM bases WHERE id IN (${ph}) AND ativo = 1`, ids);
      bases = r.rows;
    } else {
      bases = await db.all("SELECT * FROM bases WHERE (is_admin = 0 OR is_admin IS NULL) AND ativo = 1");
    }

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

    // Bases pendentes:
    //  - Se a data consultada é anterior a hoje (Brasília) → sempre mostra pendentes
    //  - Se é hoje → só mostra após 10h (horário de Brasília)
    const isPastDate = dataRef < hojeStr;
    const pendentes = (isPastDate || horaAtual >= horaLimite)
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

    // Permissão: admin, coordenador da base, ou a própria base
    const coordBases = (req.session.coordenadorBases || []).map(Number);
    if (!req.session.isAdmin &&
        !coordBases.includes(Number(rel.base_id)) &&
        Number(rel.base_id) !== Number(req.session.userId))
      return res.status(403).json({ erro: 'Sem permissão.' });

    if (rel.status === 'finalizado' && status === 'finalizado')
      return res.status(409).json({ erro: 'Relatório já está finalizado.' });

    // Auditoria: gravar quem finalizou
    if (status === 'finalizado') {
      const tipo = tipoAtor(req.session);
      const nome = req.session.nome || req.session.usuario;
      await db.run(
        `UPDATE relatorios
            SET status = ?,
                finalizado_por_tipo = ?,
                finalizado_por_nome = ?,
                finalizado_em       = NOW()
          WHERE id = ?`,
        [status, tipo, nome, req.params.id]
      );
    } else {
      await db.run('UPDATE relatorios SET status = ? WHERE id = ?', [status, req.params.id]);
    }

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

// ── Editar anexos de uma rota (só relatórios em_andamento) ───────────────────
router.put('/rotas/:rotaId/anexos', auth, async (req, res) => {
  try {
    const { nf_url, comprovante_url } = req.body;

    // Busca a rota e o status do relatório pai
    const rota = await db.get(`
      SELECT rt.id, r.status, r.base_id
      FROM rotas rt
      JOIN relatorios r ON r.id = rt.relatorio_id
      WHERE rt.id = ?
    `, [req.params.rotaId]);

    if (!rota) return res.status(404).json({ erro: 'Rota não encontrada.' });

    // Verifica permissão (base dona, coordenador ou admin)
    const coordBases = (req.session.coordenadorBases || []).map(Number);
    const temPermissao = req.session.isAdmin
      || coordBases.includes(Number(rota.base_id))
      || Number(rota.base_id) === Number(req.session.userId);
    if (!temPermissao) return res.status(403).json({ erro: 'Sem permissão.' });

    // Bloqueia APENAS se explicitamente finalizado (NULL = em andamento)
    if (rota.status === 'finalizado')
      return res.status(409).json({ erro: 'Relatório finalizado não pode ser alterado.' });

    // Monta apenas os campos enviados
    const campos = [];
    const valores = [];
    if (nf_url !== undefined)         { campos.push('nf_url = ?');          valores.push(nf_url || null); }
    if (comprovante_url !== undefined) { campos.push('comprovante_url = ?'); valores.push(comprovante_url || null); }

    if (campos.length === 0)
      return res.status(400).json({ erro: 'Nenhum campo para atualizar.' });

    valores.push(req.params.rotaId);
    await db.run(`UPDATE rotas SET ${campos.join(', ')} WHERE id = ?`, valores);

    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro interno.' }); }
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
    const coordBases = (req.session.coordenadorBases || []).map(Number);
    if (!req.session.isAdmin &&
        !coordBases.includes(Number(rel.base_id)) &&
        Number(rel.base_id) !== Number(req.session.userId))
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
    // Determinar base_id conforme tipo de usuário
    let baseId;
    if (req.session.isAdmin) {
      baseId = req.body.base_id || req.session.userId;
    } else if (req.session.isCoordinador) {
      baseId = req.body.base_id;
      if (!baseId)
        return res.status(400).json({ erro: 'Informe a base para o relatório.' });
      const coordBases = (req.session.coordenadorBases || []).map(Number);
      if (!coordBases.includes(Number(baseId)))
        return res.status(403).json({ erro: 'Você não tem acesso a esta base.' });
    } else {
      baseId = req.session.userId;
    }

    const { data_referencia, rotas } = req.body;

    if (!data_referencia) return res.status(400).json({ erro: 'Data de referência obrigatória.' });
    if (!rotas || !Array.isArray(rotas) || rotas.length === 0)
      return res.status(400).json({ erro: 'Informe ao menos uma rota.' });

    const jaExiste = await db.get(
      'SELECT id, status FROM relatorios WHERE base_id = ? AND data_referencia = ?',
      [baseId, data_referencia]
    );

    // ── Relatório finalizado → bloquear ───────────────────────────────────────
    if (jaExiste && jaExiste.status === 'finalizado')
      return res.status(409).json({ erro: 'finalizado', msg: 'Este relatório está finalizado e não pode ser alterado.' });

    // Helper para inserir rotas (reutilizado nos dois casos abaixo)
    async function inserirRotas(client, relatorioId) {
      const c = db.clientWrapper(client);
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
          relatorioId,
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
    }

    // ── Relatório em andamento → ADICIONAR rotas ao existente ─────────────────
    if (jaExiste) {
      await db.transaction(async (client) => {
        await inserirRotas(client, jaExiste.id);
      });
      return res.json({ id: jaExiste.id, ok: true, adicionado: true });
    }

    // ── Sem relatório → criar novo ────────────────────────────────────────────
    const criadoPorTipo = tipoAtor(req.session);
    const criadoPorNome = req.session.nome || req.session.usuario;

    const relId = await db.transaction(async (client) => {
      const c = db.clientWrapper(client);
      const rel = await c.run(
        'INSERT INTO relatorios (base_id, data_referencia, criado_por_tipo, criado_por_nome) VALUES (?, ?, ?, ?)',
        [baseId, data_referencia, criadoPorTipo, criadoPorNome]
      );
      await inserirRotas(client, rel.lastInsertRowid);
      return rel.lastInsertRowid;
    });

    res.json({ id: relId, ok: true, adicionado: false });
  } catch (err) { console.error(err); res.status(500).json({ erro: 'Erro interno.' }); }
});

module.exports = router;
