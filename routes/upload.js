const express   = require('express');
const router    = express.Router();
const multer    = require('multer');
const { createClient } = require('@supabase/supabase-js');
const path      = require('path');

const storage = multer.memoryStorage();
const upload  = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Apenas PDF, JPG ou PNG são permitidos.'));
  }
});

function auth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ erro: 'Não autenticado.' });
  next();
}

/**
 * Tenta derivar SUPABASE_URL a partir do DATABASE_URL.
 * DATABASE_URL formato: postgresql://postgres.[ref]:senha@...pooler.supabase.com/postgres
 */
function getSupabaseUrl() {
  if (process.env.SUPABASE_URL) return process.env.SUPABASE_URL;
  const dbUrl = process.env.DATABASE_URL || '';
  const match = dbUrl.match(/postgres\.([a-zA-Z0-9]+)[:@]/);
  if (match) return `https://${match[1]}.supabase.co`;
  return null;
}

/**
 * Retorna a chave de API disponível (service_role preferida, depois anon).
 */
function getSupabaseKey() {
  return process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || null;
}

function getSupabase() {
  const url = getSupabaseUrl();
  const key = getSupabaseKey();
  if (!url) throw new Error('SUPABASE_URL não configurado. Adicione no Railway: SUPABASE_URL = https://[ref].supabase.co');
  if (!key) throw new Error('Chave Supabase não configurada. Adicione no Railway: SUPABASE_SERVICE_KEY ou SUPABASE_ANON_KEY');
  return createClient(url, key);
}

// ── GET /api/upload/status — diagnóstico de configuração ─────────────────────
router.get('/status', auth, (req, res) => {
  const url = getSupabaseUrl();
  const key = getSupabaseKey();
  const keyTipo = process.env.SUPABASE_SERVICE_KEY ? 'service_role'
    : process.env.SUPABASE_ANON_KEY ? 'anon'
    : null;
  res.json({
    configurado: !!(url && key),
    supabase_url: url ? url.replace(/\/\/(.{4}).*\.supabase/, '//$1***.supabase') : null,
    chave_tipo:  keyTipo,
    derivado_de_database_url: !process.env.SUPABASE_URL && !!url,
    instrucoes: (!url || !key) ? [
      'Acesse o Railway → seu serviço → Variables',
      'Adicione: SUPABASE_URL = https://[seu-ref].supabase.co',
      'Adicione: SUPABASE_SERVICE_KEY = (Supabase → Settings → API → service_role)',
      'O [ref] está no DATABASE_URL após "postgres."'
    ] : []
  });
});

// ── POST /api/upload/nf — faz upload do arquivo para o Supabase Storage ──────
router.post('/nf', auth, upload.single('nf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado.' });

    const supabase  = getSupabase();
    const ext       = path.extname(req.file.originalname).toLowerCase();
    const filename  = `nf_${req.session.userId}_${Date.now()}${ext}`;
    const bucket    = 'nf-arquivos';

    // Criar bucket público se não existir (ignora erro se já existe)
    await supabase.storage.createBucket(bucket, { public: true }).catch(() => {});

    const { error } = await supabase.storage
      .from(bucket)
      .upload(filename, req.file.buffer, { contentType: req.file.mimetype, upsert: false });

    if (error) {
      console.error('[upload/nf] Supabase Storage error:', error);
      return res.status(500).json({
        erro: `Falha no armazenamento: ${error.message}`,
        dica: 'Verifique se SUPABASE_SERVICE_KEY está configurado no Railway e se o bucket "nf-arquivos" existe.'
      });
    }

    const { data } = supabase.storage.from(bucket).getPublicUrl(filename);
    res.json({ url: data.publicUrl, nome: req.file.originalname });

  } catch (err) {
    console.error('[upload/nf]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
