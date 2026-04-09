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

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_KEY não configurados.');
  return createClient(url, key);
}

// POST /api/upload/nf — faz upload da NF para o Supabase Storage
router.post('/nf', auth, upload.single('nf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado.' });

    const supabase  = getSupabase();
    const ext       = path.extname(req.file.originalname).toLowerCase();
    const filename  = `nf_${req.session.userId}_${Date.now()}${ext}`;
    const bucket    = 'nf-arquivos';

    // Criar bucket se não existir
    await supabase.storage.createBucket(bucket, { public: true }).catch(() => {});

    const { error } = await supabase.storage
      .from(bucket)
      .upload(filename, req.file.buffer, { contentType: req.file.mimetype, upsert: false });

    if (error) throw error;

    const { data } = supabase.storage.from(bucket).getPublicUrl(filename);
    res.json({ url: data.publicUrl, nome: req.file.originalname });

  } catch (err) {
    console.error('[upload/nf]', err.message);
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
