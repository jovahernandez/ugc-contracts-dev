// src/server.ts
import 'dotenv/config';

import express from 'express';
import cors from 'cors';
import path from 'path';

// IMPORTANTE: default import, NO llaves
import contractsRoutes from './routes/contractsRoutes';

const app = express();

// Trust proxy para obtener IP real detrás de Railway/Codespaces/Vercel
app.set('trust proxy', true);

const PORT = process.env.PORT || 3000;
const STORAGE_ROOT = process.env.STORAGE_ROOT || 'storage';
const storageRootPath = path.join(__dirname, '..', STORAGE_ROOT);

// Logs para verificar env
console.log(
  '[Env] HUBSPOT_PRIVATE_APP_TOKEN present:',
  !!process.env.HUBSPOT_PRIVATE_APP_TOKEN
);
console.log('[Env] HUBSPOT_BASE_URL:', process.env.HUBSPOT_BASE_URL);

// Middlewares globales
app.use(cors());

// Body parsers
app.use(express.json());
app.use(
  express.urlencoded({
    extended: true,
  })
);

// Archivos estáticos (DOCX, PDF, firmas, etc.)
app.use('/storage', express.static(storageRootPath));

// Healthcheck básico
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Rutas de contratos
// AQUÍ era donde se rompía: el segundo argumento debe ser una función/router
app.use('/contracts', contractsRoutes);

// Arranque del servidor
app.listen(PORT, () => {
  console.log(`Contracts service listening on port ${PORT}`);
  console.log('Storage root served from:', storageRootPath);
});
