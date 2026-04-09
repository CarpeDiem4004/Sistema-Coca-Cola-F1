require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path    = require('path');
const cron    = require('node-cron');
const db      = require('./database/db');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'coca-cola-f1-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 } // 8 horas
}));

// ── Rotas da API ──────────────────────────────────────────────────────────────
app.use('/api/auth',         require('./routes/auth'));
app.use('/api/funcionarios', require('./routes/funcionarios'));
app.use('/api/relatorios',   require('./routes/relatorios'));
app.use('/api/bases',        require('./routes/bases'));
app.use('/api/operadores',   require('./routes/operadores'));

// ── Guards de página (server-side) ────────────────────────────────────────────
function requireLogin(req, res, next) {
  if (!req.session.userId) return res.redirect('/');
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.redirect('/');
  if (!req.session.isAdmin) return res.redirect('/base');
  next();
}
function requireOperador(req, res, next) {
  if (!req.session.userId) return res.redirect('/');
  if (req.session.isAdmin) return res.redirect('/admin');
  next();
}

// ── Servir páginas ────────────────────────────────────────────────────────────
app.get('/',      (_,   res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/base',  requireOperador, (_, res) => res.sendFile(path.join(__dirname, 'public', 'base.html')));
app.get('/admin', requireAdmin,    (_, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ── Cron: verificar bases sem relatório até 10h ───────────────────────────────
cron.schedule('0 10 * * 1-6', async () => {
  console.log('[CRON] Verificando bases que não postaram...');
  const hoje = new Date();
  hoje.setDate(hoje.getDate() - 1);
  const ontem = hoje.toISOString().slice(0, 10);

  try {
    const bases = await db.all(
      "SELECT * FROM bases WHERE (is_admin = 0 OR is_admin IS NULL) AND ativo = 1"
    );
    for (const base of bases) {
      const postou = await db.get(
        'SELECT id FROM relatorios WHERE base_id = ? AND data_referencia = ?',
        [base.id, ontem]
      );
      if (!postou) {
        const jaAlertou = await db.get(
          "SELECT id FROM alertas WHERE base_id = ? AND data_referencia = ? AND tipo = 'nao_postou'",
          [base.id, ontem]
        );
        if (!jaAlertou) {
          await db.run(
            "INSERT INTO alertas (base_id, data_referencia, tipo, mensagem) VALUES (?, ?, ?, ?)",
            [base.id, ontem, 'nao_postou', `${base.nome} não enviou o relatório F1 até as 10h para ${ontem}.`]
          );
          console.log(`[ALERTA] ${base.nome} - sem relatório para ${ontem}`);
        }
      }
    }
  } catch (err) {
    console.error('[CRON] Erro:', err.message);
  }
}, { timezone: 'America/Sao_Paulo' });

// ── Iniciar servidor ──────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Coca-Cola F1 rodando em http://localhost:${PORT}`);
  console.log(`   Banco: ${process.env.DATABASE_URL ? 'Supabase (PostgreSQL)' : 'não configurado!'}\n`);
});
