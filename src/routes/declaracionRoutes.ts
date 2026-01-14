// src/routes/declaracionRoutes.ts
// Flujo de Declaración de Ausencia de Conflicto de Interés para EFICENTA
import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import * as mammoth from 'mammoth';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import ImageModule from 'docxtemplater-image-module-free';
import { convertDocxToPdf } from '../services/docxToPdfService';
import {
  getClientIp,
  extractSignatureMetadata,
  generateDocumentHash,
  type SignatureMetadata,
} from '../utils/requestMetadata';
import {
  isGitHubStorageEnabled,
  saveDeclaracionToGitHub,
  loadDeclaracionFromGitHub,
  loadDeclaracionFromGitHubByToken,
  saveSignedDocxToGitHub,
  loadSignedDocxFromGitHub,
  saveSignedPdfToGitHub,
  loadSignedPdfFromGitHub,
} from '../services/githubStorageService';

const router = Router();

// Directorios de almacenamiento
const storageRoot = path.join(process.cwd(), 'storage');
const declaracionesDir = path.join(storageRoot, 'declaraciones');
const signaturesDir = path.join(storageRoot, 'declaraciones', 'signatures');
const signedDir = path.join(storageRoot, 'declaraciones', 'signed');

function ensureDirs() {
  [storageRoot, declaracionesDir, signaturesDir, signedDir].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

ensureDirs();

// Interfaz para los datos del proveedor
interface ProveedorData {
  nombre_proveedor_razon_social: string;
  nombre_representante_legal: string;
  email: string;
}

// Registro de declaración
interface DeclaracionRecord {
  uid: string;
  token: string;
  status: 'pending_form' | 'pending_signature' | 'signed';
  proveedorData?: ProveedorData;
  docxPath?: string;
  signedPdfPath?: string;
  signedPdfUrl?: string;
  signatureImagePath?: string;
  signatureMetadata?: SignatureMetadata;
  documentHash?: string;
  signedDocumentHash?: string;
  createdAt: string;
  signedAt?: string;
}

// Funciones de persistencia
function getRecordPath(uid: string): string {
  return path.join(declaracionesDir, `record_${uid}.json`);
}

function getRecordByToken(token: string): DeclaracionRecord | null {
  const files = fs.readdirSync(declaracionesDir).filter(f => f.startsWith('record_') && f.endsWith('.json'));
  for (const file of files) {
    try {
      const record = JSON.parse(fs.readFileSync(path.join(declaracionesDir, file), 'utf-8'));
      if (record.token === token) return record;
    } catch {}
  }
  return null;
}

/**
 * Busca un registro por token con fallback a GitHub
 * Versión async que soporta lookup en GitHub si el local no existe
 */
async function getRecordByTokenAsync(token: string): Promise<DeclaracionRecord | null> {
  // 1. Intentar buscar en local primero (rápido)
  try {
    ensureDirs();
    if (fs.existsSync(declaracionesDir)) {
      const files = fs.readdirSync(declaracionesDir).filter(f => f.startsWith('record_') && f.endsWith('.json'));
      for (const file of files) {
        try {
          const record = JSON.parse(fs.readFileSync(path.join(declaracionesDir, file), 'utf-8'));
          if (record.token === token) {
            return record;
          }
        } catch {}
      }
    }
  } catch (err) {
    console.error(`Error buscando token localmente:`, err);
  }

  // 2. Si no existe localmente, intentar desde GitHub (fallback)
  if (isGitHubStorageEnabled()) {
    try {
      console.log(`[GitHub Fallback] Buscando token ${token} en GitHub...`);
      const record = await loadDeclaracionFromGitHubByToken(token);

      if (record) {
        console.log(`✅ [GitHub Fallback] Token ${token} encontrado en GitHub`);

        // 3. Guardar en local para próximas consultas (cache)
        ensureDirs();
        const filePath = getRecordPath(record.uid);
        fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
        console.log(`✅ [GitHub Fallback] Token ${token} guardado en cache local`);

        return record as DeclaracionRecord;
      } else {
        console.log(`⚠️ [GitHub Fallback] Token ${token} no encontrado en GitHub`);
      }
    } catch (err) {
      console.error(`Error cargando token desde GitHub:`, err);
    }
  }

  // 3. No encontrado en ningún lado
  return null;
}

function loadRecord(uid: string): DeclaracionRecord | null {
  const filePath = getRecordPath(uid);
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }
  // Si no existe localmente, no podemos hacer await aquí
  // Esta función será reemplazada por loadRecordAsync
  return null;
}

/**
 * Carga un registro desde filesystem local o GitHub (con fallback)
 * Versión async que soporta lookup en GitHub si el local no existe
 */
async function loadRecordAsync(uid: string): Promise<DeclaracionRecord | null> {
  // 1. Intentar cargar desde local primero (rápido)
  const filePath = getRecordPath(uid);
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (err) {
      console.error(`Error leyendo archivo local para ${uid}:`, err);
    }
  }

  // 2. Si no existe localmente, intentar desde GitHub (fallback)
  if (isGitHubStorageEnabled()) {
    try {
      console.log(`[GitHub Fallback] Buscando ${uid} en GitHub...`);
      const record = await loadDeclaracionFromGitHub(uid);

      if (record) {
        console.log(`✅ [GitHub Fallback] Registro ${uid} encontrado en GitHub`);

        // 3. Guardar en local para próximas consultas (cache)
        ensureDirs();
        fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
        console.log(`✅ [GitHub Fallback] Registro ${uid} guardado en cache local`);

        return record as DeclaracionRecord;
      } else {
        console.log(`⚠️ [GitHub Fallback] Registro ${uid} no encontrado en GitHub`);
      }
    } catch (err) {
      console.error(`Error cargando desde GitHub para ${uid}:`, err);
    }
  }

  // 3. No encontrado en ningún lado
  return null;
}

function saveRecord(record: DeclaracionRecord): void {
  const filePath = getRecordPath(record.uid);
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
}

// Convertir DOCX a HTML
async function convertDocxToHtml(docxPath: string): Promise<string> {
  const buffer = fs.readFileSync(docxPath);
  const result = await mammoth.convertToHtml({ buffer });
  return result.value || '<p>No fue posible mostrar el contenido del documento.</p>';
}

// ---------------------------------------------------------------------------
// GET /declaracion?uid=XXX
// Muestra formulario para que el proveedor llene sus datos
// ---------------------------------------------------------------------------
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const uid = req.query.uid as string;

    if (!uid) {
      res.status(400).send(`
        <!DOCTYPE html>
        <html lang="es">
        <head><meta charset="UTF-8"><title>Error</title></head>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1>⚠️ Enlace inválido</h1>
          <p>El enlace no contiene el identificador del proveedor (uid).</p>
          <p>Por favor contacte a EFICENTA para obtener el enlace correcto.</p>
        </body>
        </html>
      `);
      return;
    }

    ensureDirs();

    // Verificar si ya existe un registro
    let record = loadRecord(uid);

    if (record && record.status === 'signed') {
      res.send(`
        <!DOCTYPE html>
        <html lang="es">
        <head><meta charset="UTF-8"><title>Declaración Completada</title></head>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1>✅ Declaración ya firmada</h1>
          <p>La declaración para este proveedor ya fue completada y firmada.</p>
          <p>Fecha de firma: ${record.signedAt ? new Date(record.signedAt).toLocaleDateString('es-MX') : 'N/A'}</p>
        </body>
        </html>
      `);
      return;
    }

    // Si ya tiene datos y está pendiente de firma, redirigir
    if (record && record.status === 'pending_signature' && record.token) {
      res.redirect(`/declaracion/firmar/${record.token}`);
      return;
    }

    // Mostrar formulario
    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Declaración de Ausencia de Conflicto de Interés</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      margin: 0;
      padding: 16px;
      background: #f5f5f5;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background: #fff;
      padding: 24px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .logo-container {
      text-align: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid #e5e7eb;
    }
    .logo-container img {
      max-width: 180px;
      height: auto;
    }
    h1 {
      font-size: 20px;
      color: #1e40af;
      margin-bottom: 8px;
    }
    .subtitle {
      color: #6b7280;
      margin-bottom: 24px;
    }
    label {
      display: block;
      margin-top: 16px;
      font-weight: 500;
      font-size: 14px;
    }
    input {
      width: 100%;
      padding: 10px 12px;
      margin-top: 4px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      font-size: 14px;
    }
    input:focus {
      outline: none;
      border-color: #2563eb;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
    }
    button {
      margin-top: 24px;
      width: 100%;
      padding: 12px;
      background: #2563eb;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 16px;
      font-weight: 500;
      cursor: pointer;
    }
    button:hover {
      background: #1d4ed8;
    }
    .info {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      padding: 12px;
      border-radius: 6px;
      margin-bottom: 16px;
      font-size: 13px;
      color: #1e40af;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo-container">
      <img src="https://raw.githubusercontent.com/jovahernandez/ugc-contracts-dev/main/src/assets/another-logo.svg" alt="Another">
    </div>
    
    <h1>📋 Declaración de Ausencia de Conflicto de Interés</h1>
    <p class="subtitle">Complete los siguientes datos para generar su declaración</p>
    
    <div class="info">
      <strong>ID del Proveedor:</strong> ${uid}
    </div>

    <form action="/declaracion/generar" method="POST">
      <input type="hidden" name="uid" value="${uid}">
      
      <label for="nombre_proveedor_razon_social">Nombre o Razón Social del Proveedor *</label>
      <input type="text" id="nombre_proveedor_razon_social" name="nombre_proveedor_razon_social" required placeholder="Ej: Empresa ABC S.A. de C.V.">
      
      <label for="nombre_representante_legal">Nombre del Representante Legal *</label>
      <input type="text" id="nombre_representante_legal" name="nombre_representante_legal" required placeholder="Ej: Juan Pérez García">
      
      <label for="email">Correo Electrónico *</label>
      <input type="email" id="email" name="email" required placeholder="Ej: contacto@empresa.com">
      
      <button type="submit">Generar Documento →</button>
    </form>
  </div>
</body>
</html>`;

    res.status(200).send(html);
  } catch (err: any) {
    console.error('Error en GET /declaracion:', err);
    res.status(500).send('<h1>Error</h1><p>No fue posible cargar el formulario.</p>');
  }
});

// ---------------------------------------------------------------------------
// POST /declaracion/generar
// Genera el DOCX con los datos del proveedor
// ---------------------------------------------------------------------------
router.post('/generar', async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      uid,
      nombre_proveedor_razon_social,
      nombre_representante_legal,
      email,
    } = req.body;

    if (!uid || !nombre_proveedor_razon_social || !nombre_representante_legal || !email) {
      res.status(400).send('<h1>Error</h1><p>Todos los campos son obligatorios.</p>');
      return;
    }

    ensureDirs();

    const proveedorData: ProveedorData = {
      nombre_proveedor_razon_social,
      nombre_representante_legal,
      email,
    };

    // Cargar template
    const templatePath = path.join(__dirname, '..', 'templates', 'declaracion-conflicto.docx');
    if (!fs.existsSync(templatePath)) {
      res.status(500).send('<h1>Error</h1><p>Template de declaración no encontrado.</p>');
      return;
    }

    const templateContent = fs.readFileSync(templatePath, 'binary');
    const zip = new PizZip(templateContent);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
    });

    // Renderizar con datos (sin firma aún)
    doc.render({
      nombre_proveedor_razon_social,
      nombre_representante_legal,
      email,
      domicilio: '',
      telefono: '',
      fecha_de_la_firma: '',
    });

    const docxBuffer = doc.getZip().generate({ type: 'nodebuffer' });
    const docxFileName = `declaracion_${uid}.docx`;
    const docxPath = path.join(declaracionesDir, docxFileName);
    fs.writeFileSync(docxPath, docxBuffer);

    // Generar hash del documento
    const documentHash = generateDocumentHash(docxBuffer);

    // Crear token para firma
    const token = randomUUID();

    // Guardar registro
    const record: DeclaracionRecord = {
      uid,
      token,
      status: 'pending_signature',
      proveedorData,
      docxPath,
      documentHash,
      createdAt: new Date().toISOString(),
    };
    saveRecord(record);

    // ✅ Persistir en GitHub inmediatamente (evita pérdida de datos en restart)
    if (isGitHubStorageEnabled()) {
      try {
        const gitResult = await saveDeclaracionToGitHub(record.uid, {
          uid: record.uid,
          status: record.status,
          proveedor: record.proveedorData,
          signedAt: null,
          signedPdfUrl: null,
          signatureMetadata: null,
          documentHash: record.documentHash,
        });
        if (gitResult.success) {
          console.log(`✅ Declaración ${record.uid} (pending_signature) guardada en GitHub: ${gitResult.url}`);
        } else {
          console.warn(`⚠️ No se pudo guardar en GitHub: ${gitResult.message}`);
        }
      } catch (gitErr) {
        console.warn('⚠️ Error al guardar en GitHub (no crítico):', gitErr);
      }
    }

    // Redirigir a página de firma
    res.redirect(`/declaracion/firmar/${token}`);
  } catch (err: any) {
    console.error('Error en POST /declaracion/generar:', err);
    res.status(500).send(`<h1>Error</h1><p>No fue posible generar el documento: ${err.message}</p>`);
  }
});

// ---------------------------------------------------------------------------
// GET /declaracion/firmar/:token
// Muestra el documento y el canvas para firma
// ---------------------------------------------------------------------------
router.get('/firmar/:token', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params;
    const record = await getRecordByTokenAsync(token);

    if (!record) {
      res.status(404).send('<h1>Enlace no válido</h1><p>El enlace de firma no existe o ha expirado.</p>');
      return;
    }

    if (record.status === 'signed') {
      res.send(`
        <!DOCTYPE html>
        <html lang="es">
        <head><meta charset="UTF-8"><title>Declaración Completada</title></head>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1>✅ Declaración ya firmada</h1>
          <p>Esta declaración ya fue firmada el ${record.signedAt ? new Date(record.signedAt).toLocaleDateString('es-MX') : 'N/A'}.</p>
        </body>
        </html>
      `);
      return;
    }

    if (!record.docxPath || !fs.existsSync(record.docxPath)) {
      res.status(404).send('<h1>Error</h1><p>Documento no encontrado.</p>');
      return;
    }

    let documentHtml = await convertDocxToHtml(record.docxPath);
    // Limpiar líneas de Domicilio y Teléfono vacíos
    documentHtml = documentHtml
      .replace(/<p[^>]*>\s*Domicilio:\s*<\/p>/gi, '')
      .replace(/<p[^>]*>\s*Tel[ée]fono:\s*<\/p>/gi, '')
      .replace(/Domicilio:\s*(<br\s*\/?>|\n|\r|<\/p>)/gi, '')
      .replace(/Tel[ée]fono:\s*(<br\s*\/?>|\n|\r|<\/p>)/gi, '');

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Firmar Declaración</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      margin: 0;
      padding: 16px;
      background: #f5f5f5;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
      background: #fff;
      padding: 24px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .logo-container {
      text-align: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid #e5e7eb;
    }
    .logo-container img {
      max-width: 180px;
      height: auto;
    }
    h1 { font-size: 20px; color: #1e40af; }
    h2 { font-size: 16px; margin-top: 24px; }
    .document-preview {
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 16px;
      max-height: 400px;
      overflow-y: auto;
      background: #fafafa;
      margin: 16px 0;
    }
    .signature-section {
      background: #f0fdf4;
      border: 1px solid #86efac;
      border-radius: 8px;
      padding: 16px;
      margin-top: 24px;
    }
    canvas {
      border: 2px solid #d1d5db;
      border-radius: 6px;
      width: 100%;
      max-width: 600px;
      background: #fff;
      touch-action: none;
    }
    .checkbox-row {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin: 16px 0;
    }
    .actions {
      display: flex;
      gap: 12px;
      margin-top: 16px;
    }
    button {
      padding: 12px 24px;
      border-radius: 6px;
      border: none;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
    }
    button.primary {
      background: #16a34a;
      color: #fff;
    }
    button.secondary {
      background: #e5e7eb;
      color: #374151;
    }
    .info-box {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      padding: 12px;
      border-radius: 6px;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo-container">
      <img src="https://raw.githubusercontent.com/jovahernandez/ugc-contracts-dev/main/src/assets/another-logo.svg" alt="Another">
    </div>
    
    <h1>📋 Declaración de Ausencia de Conflicto de Interés</h1>
    
    <div class="info-box">
      <strong>Proveedor:</strong> ${record.proveedorData?.nombre_proveedor_razon_social || 'N/A'}<br>
      <strong>Representante Legal:</strong> ${record.proveedorData?.nombre_representante_legal || 'N/A'}
    </div>

    <h2>1. Revise el documento</h2>
    <div class="document-preview">
      ${documentHtml}
    </div>

    <div class="signature-section">
      <h2>2. Firme electrónicamente</h2>
      <form method="POST">
        <p>Dibuje su firma en el recuadro (use su dedo en móvil o mouse en computadora):</p>
        <canvas id="signatureCanvas" width="600" height="200"></canvas>
        
        <div class="checkbox-row">
          <input type="checkbox" id="accepted" name="accepted" value="yes" required>
          <label for="accepted">
            Declaro bajo protesta de decir verdad que no tengo conflicto de interés alguno con EFICENTA, y autorizo el uso de mi firma electrónica manuscrita.
          </label>
        </div>

        <div class="actions">
          <button type="button" class="secondary" id="clearBtn">Borrar firma</button>
          <button type="submit" class="primary">✍️ Firmar Declaración</button>
        </div>

        <input type="hidden" name="signatureData" id="signatureData">
        <input type="hidden" name="timezoneOffset" id="timezoneOffset">
      </form>
    </div>
  </div>

  <script>
    document.getElementById('timezoneOffset').value = new Date().getTimezoneOffset();
    
    var canvas = document.getElementById('signatureCanvas');
    var ctx = canvas.getContext('2d');
    var drawing = false;
    var hasDrawing = false;

    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1e3a8a';

    function getPos(e) {
      var rect = canvas.getBoundingClientRect();
      var scaleX = canvas.width / rect.width;
      var scaleY = canvas.height / rect.height;
      if (e.touches && e.touches.length > 0) {
        return {
          x: (e.touches[0].clientX - rect.left) * scaleX,
          y: (e.touches[0].clientY - rect.top) * scaleY
        };
      }
      return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
      };
    }

    function startDrawing(e) {
      e.preventDefault();
      drawing = true;
      hasDrawing = true;
      var pos = getPos(e);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
    }

    function draw(e) {
      if (!drawing) return;
      e.preventDefault();
      var pos = getPos(e);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    }

    function stopDrawing(e) {
      if (!drawing) return;
      e.preventDefault();
      drawing = false;
    }

    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseleave', stopDrawing);
    canvas.addEventListener('touchstart', startDrawing, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stopDrawing, { passive: false });

    document.getElementById('clearBtn').addEventListener('click', function() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasDrawing = false;
    });

    document.querySelector('form').addEventListener('submit', function(e) {
      if (!hasDrawing) {
        e.preventDefault();
        alert('Por favor dibuje su firma antes de continuar.');
        return;
      }
      document.getElementById('signatureData').value = canvas.toDataURL('image/png');
    });
  </script>
</body>
</html>`;

    res.status(200).send(html);
  } catch (err: any) {
    console.error('Error en GET /declaracion/firmar:', err);
    res.status(500).send('<h1>Error</h1><p>No fue posible cargar la página de firma.</p>');
  }
});

// ---------------------------------------------------------------------------
// POST /declaracion/firmar/:token
// Procesa la firma y genera el PDF final
// ---------------------------------------------------------------------------
router.post('/firmar/:token', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params;
    const { accepted, signatureData, timezoneOffset } = req.body;

    const record = await getRecordByTokenAsync(token);

    if (!record) {
      res.status(404).send('<h1>Enlace no válido</h1>');
      return;
    }

    if (record.status === 'signed') {
      res.status(400).send('<h1>Esta declaración ya fue firmada</h1>');
      return;
    }

    if (accepted !== 'yes') {
      res.status(400).send('<h1>Error</h1><p>Debe aceptar la declaración para continuar.</p>');
      return;
    }

    if (!signatureData || !signatureData.startsWith('data:image/')) {
      res.status(400).send('<h1>Error</h1><p>No se recibió una firma válida.</p>');
      return;
    }

    ensureDirs();

    // Guardar imagen de firma
    const base64Data = signatureData.replace(/^data:image\/\w+;base64,/, '');
    const signatureBuffer = Buffer.from(base64Data, 'base64');
    const signatureFileName = `signature_${record.uid}.png`;
    const signatureImagePath = path.join(signaturesDir, signatureFileName);
    fs.writeFileSync(signatureImagePath, signatureBuffer);

    // Fecha de firma (ajustada a la zona horaria del usuario)
    const signedAt = new Date();

    // Ajustar fecha según timezone del usuario
    // timezoneOffset viene del navegador en minutos (ej: 360 para UTC-6 México)
    const userOffset = parseInt(timezoneOffset || '0', 10);
    const serverOffset = signedAt.getTimezoneOffset();
    const offsetDiff = userOffset - serverOffset;

    // Crear fecha ajustada a la zona horaria local del usuario
    const localSignedAt = new Date(signedAt.getTime() - (offsetDiff * 60 * 1000));

    const fechaFirma = localSignedAt.toLocaleDateString('es-MX', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });

    // Regenerar DOCX con firma
    const templatePath = path.join(__dirname, '..', 'templates', 'declaracion-conflicto.docx');
    const templateContent = fs.readFileSync(templatePath, 'binary');
    const zip = new PizZip(templateContent);

    const imageModule = new ImageModule({
      centered: false,
      getImage: (tagValue: string) => fs.readFileSync(tagValue),
      getSize: () => [150, 60],
    });

    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      modules: [imageModule],
    });

    doc.render({
      ...record.proveedorData,
      domicilio: '',
      telefono: '',
      fecha_de_la_firma: fechaFirma,
      firma_proveedor: signatureImagePath,
    });

    const signedDocxBuffer = doc.getZip().generate({ type: 'nodebuffer' });
    const signedDocxPath = path.join(signedDir, `declaracion_${record.uid}_signed.docx`);
    fs.writeFileSync(signedDocxPath, signedDocxBuffer);

    // Convertir DOCX a PDF usando Puppeteer
    let finalFilePath = signedDocxPath;
    try {
      console.log(`[PDF] Convirtiendo DOCX a PDF para ${record.uid}...`);
      const pdfPath = await convertDocxToPdf(signedDocxPath, signedDir);
      finalFilePath = pdfPath;
      console.log(`[PDF] ✅ Conversión exitosa: ${pdfPath}`);
    } catch (pdfErr: any) {
      console.error(`[PDF] ⚠️ Error en conversión, usando DOCX: ${pdfErr.message}`);
      // Si falla la conversión, continuamos con DOCX (fallback)
    }

    const publicBaseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;

    // Usar endpoint con fallback a GitHub en lugar de /storage directo
    const finalFileUrl = `${publicBaseUrl}/declaracion/download/${record.uid}`;

    // Generar hash del documento firmado
    const signedDocBuffer = fs.readFileSync(finalFilePath);
    const signedDocumentHash = generateDocumentHash(signedDocBuffer);

    // Metadata de firma
    const signatureMetadata = extractSignatureMetadata(req, parseInt(timezoneOffset || '0', 10));

    // Actualizar registro
    record.status = 'signed';
    record.signedAt = localSignedAt.toISOString(); // ✅ Usar fecha ajustada al timezone del usuario
    record.signatureImagePath = signatureImagePath;
    record.signedPdfPath = finalFilePath;
    record.signedPdfUrl = finalFileUrl;
    record.signedDocumentHash = signedDocumentHash;
    record.signatureMetadata = signatureMetadata;
    saveRecord(record);

    // ✅ Persistir en GitHub automáticamente (si está configurado)
    if (isGitHubStorageEnabled()) {
      try {
        // 1. Guardar metadata JSON
        const gitResult = await saveDeclaracionToGitHub(record.uid, {
          uid: record.uid,
          status: record.status,
          proveedor: record.proveedorData,
          signedAt: record.signedAt,
          signedPdfUrl: record.signedPdfUrl,
          signatureMetadata: {
            ip: signatureMetadata.ip,
            userAgent: signatureMetadata.userAgent,
            signedAtUtc: signatureMetadata.signedAtUtc,
            signedAtLocal: signatureMetadata.signedAtLocal,
          },
          documentHash: record.signedDocumentHash,
        });
        if (gitResult.success) {
          console.log(`✅ Declaración ${record.uid} metadata guardada en GitHub: ${gitResult.url}`);
        } else {
          console.warn(`⚠️ No se pudo guardar metadata en GitHub: ${gitResult.message}`);
        }

        // 2. Guardar archivo firmado (DOCX como backup y PDF como archivo principal)
        const docxResult = await saveSignedDocxToGitHub(record.uid, signedDocxBuffer);
        if (docxResult.success) {
          console.log(`✅ DOCX firmado ${record.uid} guardado en GitHub (backup)`);
        } else {
          console.warn(`⚠️ No se pudo guardar DOCX en GitHub: ${docxResult.message}`);
        }

        // 3. Si se generó PDF, también guardarlo en GitHub
        if (finalFilePath.endsWith('.pdf') && fs.existsSync(finalFilePath)) {
          const pdfBuffer = fs.readFileSync(finalFilePath);
          const pdfResult = await saveSignedPdfToGitHub(record.uid, pdfBuffer);
          if (pdfResult.success) {
            console.log(`✅ PDF firmado ${record.uid} guardado en GitHub`);
          } else {
            console.warn(`⚠️ No se pudo guardar PDF en GitHub: ${pdfResult.message}`);
          }
        }
      } catch (gitErr) {
        console.warn('⚠️ Error al guardar en GitHub (no crítico):', gitErr);
      }
    }

    // Convertir documento a base64 para descarga directa (evita problema de storage efímero)
    const docBase64 = signedDocBuffer.toString('base64');
    const isDocx = finalFilePath.endsWith('.docx');
    const mimeType = isDocx ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf';
    const fileExt = isDocx ? 'docx' : 'pdf';
    const dataUrl = `data:${mimeType};base64,${docBase64}`;
    const downloadFileName = `declaracion_${record.uid}_firmada.${fileExt}`;

    // Respuesta exitosa
    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Declaración Firmada</title>
  <style>
    body {
      font-family: system-ui, sans-serif;
      margin: 0;
      padding: 16px;
      background: #f5f5f5;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background: #fff;
      padding: 24px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      text-align: center;
    }
    .logo-container {
      text-align: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid #e5e7eb;
    }
    .logo-container img {
      max-width: 180px;
      height: auto;
    }
    .success-icon { font-size: 64px; margin-bottom: 16px; }
    h1 { color: #16a34a; }
    .download-btn {
      display: inline-block;
      margin-top: 24px;
      padding: 14px 28px;
      background: #2563eb;
      color: #fff;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 500;
    }
    .info {
      background: #f0fdf4;
      border: 1px solid #86efac;
      padding: 16px;
      border-radius: 6px;
      margin-top: 24px;
      text-align: left;
      font-size: 14px;
    }
    .metadata {
      font-size: 11px;
      color: #9ca3af;
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid #e5e7eb;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo-container">
      <img src="https://raw.githubusercontent.com/jovahernandez/ugc-contracts-dev/main/src/assets/another-logo.svg" alt="Another">
    </div>
    
    <div class="success-icon">✅</div>
    <h1>¡Declaración Firmada Exitosamente!</h1>
    <p>Su declaración de ausencia de conflicto de interés ha sido registrada.</p>
    
    <a href="${dataUrl}" class="download-btn" download="${downloadFileName}">📄 Descargar Documento Firmado</a>
    
    <div class="info">
      <p><strong>Proveedor:</strong> ${record.proveedorData?.nombre_proveedor_razon_social}</p>
      <p><strong>Representante Legal:</strong> ${record.proveedorData?.nombre_representante_legal}</p>
      <p><strong>Fecha de firma:</strong> ${fechaFirma}</p>
    </div>
    
    <div class="metadata">
      <p>ID: ${record.uid} | IP: ${signatureMetadata.ip}</p>
      <p>Hora UTC: ${signatureMetadata.signedAtUtc}</p>
    </div>
  </div>
</body>
</html>`;

    res.status(200).send(html);
  } catch (err: any) {
    console.error('Error en POST /declaracion/firmar:', err);
    res.status(500).send(`<h1>Error</h1><p>No fue posible procesar la firma: ${err.message}</p>`);
  }
});

// ---------------------------------------------------------------------------
// GET /declaracion/download/:uid
// Descarga el archivo firmado (PDF preferido, DOCX fallback) con fallback a GitHub
// ---------------------------------------------------------------------------
router.get('/download/:uid', async (req: Request, res: Response): Promise<void> => {
  try {
    const { uid } = req.params;

    if (!uid) {
      res.status(400).send('<h1>Error</h1><p>UID es requerido</p>');
      return;
    }

    let fileBuffer: Buffer | null = null;
    let source = 'unknown';
    let fileType: 'pdf' | 'docx' = 'pdf';

    // 1. Intentar cargar PDF primero (local o GitHub)
    const localPdfPath = path.join(signedDir, `declaracion_${uid}_signed.pdf`);

    if (fs.existsSync(localPdfPath)) {
      fileBuffer = fs.readFileSync(localPdfPath);
      source = 'local-pdf';
      fileType = 'pdf';
      console.log(`[Download] PDF ${uid} cargado desde local`);
    } else if (isGitHubStorageEnabled()) {
      // Intentar PDF desde GitHub
      console.log(`[Download] PDF ${uid} no encontrado en local, buscando en GitHub...`);
      fileBuffer = await loadSignedPdfFromGitHub(uid);

      if (fileBuffer) {
        source = 'github-pdf';
        fileType = 'pdf';
        console.log(`✅ [Download] PDF ${uid} recuperado desde GitHub`);

        // Auto-cachear en local
        try {
          ensureDirs();
          fs.writeFileSync(localPdfPath, fileBuffer);
          console.log(`✅ [Download] PDF ${uid} cacheado en local`);
        } catch (cacheErr) {
          console.warn(`⚠️ No se pudo cachear PDF localmente:`, cacheErr);
        }
      }
    }

    // 2. Si no hay PDF, intentar DOCX (backward compatibility con registros antiguos)
    if (!fileBuffer) {
      const localDocxPath = path.join(signedDir, `declaracion_${uid}_signed.docx`);

      if (fs.existsSync(localDocxPath)) {
        fileBuffer = fs.readFileSync(localDocxPath);
        source = 'local-docx';
        fileType = 'docx';
        console.log(`[Download] DOCX ${uid} cargado desde local (fallback)`);
      } else if (isGitHubStorageEnabled()) {
        console.log(`[Download] DOCX ${uid} no encontrado en local, buscando en GitHub...`);
        fileBuffer = await loadSignedDocxFromGitHub(uid);

        if (fileBuffer) {
          source = 'github-docx';
          fileType = 'docx';
          console.log(`✅ [Download] DOCX ${uid} recuperado desde GitHub (fallback)`);

          // Auto-cachear en local
          try {
            ensureDirs();
            fs.writeFileSync(localDocxPath, fileBuffer);
            console.log(`✅ [Download] DOCX ${uid} cacheado en local`);
          } catch (cacheErr) {
            console.warn(`⚠️ No se pudo cachear DOCX localmente:`, cacheErr);
          }
        }
      }
    }

    // 3. Si no se encontró en ningún lado
    if (!fileBuffer) {
      res.status(404).send(`
        <h1>Archivo no encontrado</h1>
        <p>El archivo firmado para ${uid} no está disponible.</p>
        <p>Es posible que la declaración aún no haya sido firmada o que el archivo haya expirado.</p>
      `);
      return;
    }

    // 4. Enviar archivo con el MIME type correcto
    const fileName = `declaracion_${uid}_firmada.${fileType}`;
    const mimeType = fileType === 'pdf'
      ? 'application/pdf'
      : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    res.setHeader('Content-Type', mimeType);
    // Usar 'inline' para que el navegador muestre el PDF, no lo descargue automáticamente
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.setHeader('X-File-Source', source); // Header para debugging
    res.setHeader('X-File-Type', fileType); // Header para debugging
    res.send(fileBuffer);

    console.log(`✅ [Download] Archivo ${uid} (${fileType.toUpperCase()}) descargado exitosamente (source: ${source})`);
  } catch (err: any) {
    console.error('Error en GET /declaracion/download/:uid:', err);
    res.status(500).send(`<h1>Error</h1><p>No fue posible descargar el archivo: ${err.message}</p>`);
  }
});

// ---------------------------------------------------------------------------
// GET /declaracion/all
// Lista todas las declaraciones (requiere API key)
// ---------------------------------------------------------------------------
router.get('/all', (req: Request, res: Response): void => {
  try {
    const apiKey = req.query.api_key as string || req.headers['x-api-key'] as string;
    const expectedApiKey = process.env.EFICENTA_API_KEY || 'eficenta-secret-key';
    
    if (apiKey !== expectedApiKey) {
      res.status(401).json({ error: 'API key inválida' });
      return;
    }

    ensureDirs();
    
    const files = fs.readdirSync(declaracionesDir)
      .filter(f => f.startsWith('record_') && f.endsWith('.json'));
    
    const records = files.map(file => {
      try {
        const record = JSON.parse(fs.readFileSync(path.join(declaracionesDir, file), 'utf-8'));
        return {
          uid: record.uid,
          status: record.status,
          proveedor: record.proveedorData?.nombre_proveedor_razon_social || null,
          representante_legal: record.proveedorData?.nombre_representante_legal || null,
          email: record.proveedorData?.email || null,
          createdAt: record.createdAt,
          signedAt: record.signedAt || null,
          signedPdfUrl: record.signedPdfUrl || null,
        };
      } catch {
        return null;
      }
    }).filter(Boolean);

    // Estadísticas
    const stats = {
      total: records.length,
      signed: records.filter(r => r?.status === 'signed').length,
      pending_form: records.filter(r => r?.status === 'pending_form').length,
      pending_signature: records.filter(r => r?.status === 'pending_signature').length,
    };

    res.json({
      success: true,
      stats,
      records,
    });
  } catch (err: any) {
    console.error('Error en GET /declaracion/all:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /declaracion/status?uid=XXX
// API JSON para que EFICENTA consulte el status
// ---------------------------------------------------------------------------
router.get('/status', async (req: Request, res: Response): Promise<void> => {
  try {
    const uid = req.query.uid as string;

    if (!uid) {
      res.status(400).json({ error: 'uid is required' });
      return;
    }

    // ✅ Usar loadRecordAsync para buscar en GitHub si no existe localmente
    const record = await loadRecordAsync(uid);

    if (!record) {
      res.json({
        uid,
        status: 'not_found',
        message: 'No se ha iniciado el proceso de declaración para este proveedor',
      });
      return;
    }

    res.json({
      uid: record.uid,
      status: record.status,
      proveedor: record.proveedorData?.nombre_proveedor_razon_social || null,
      representante_legal: record.proveedorData?.nombre_representante_legal || null,
      createdAt: record.createdAt,
      signedAt: record.signedAt || null,
      signedPdfUrl: record.signedPdfUrl || null,
    });
  } catch (err: any) {
    console.error('Error en GET /declaracion/status:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /declaracion/webhook/crear
// Webhook para que EFICENTA cree un link de declaración dinámicamente
// ---------------------------------------------------------------------------
router.post('/webhook/crear', async (req: Request, res: Response): Promise<void> => {
  try {
    const { uid, api_key } = req.body || {};

    // Validar API key (configurable por env)
    const expectedApiKey = process.env.EFICENTA_API_KEY || 'eficenta-secret-key';
    if (api_key !== expectedApiKey) {
      res.status(401).json({
        success: false,
        error: 'API key inválida',
      });
      return;
    }

    // Validar uid
    if (!uid || typeof uid !== 'string' || uid.trim() === '') {
      res.status(400).json({
        success: false,
        error: 'uid es requerido',
      });
      return;
    }

    const cleanUid = uid.trim();
    ensureDirs();

    // Verificar si ya existe un registro para este uid
    let record = loadRecord(cleanUid);
    const publicBaseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;

    if (record) {
      // Si ya existe y está firmado, devolver info
      if (record.status === 'signed') {
        res.json({
          success: true,
          uid: cleanUid,
          status: 'already_signed',
          message: 'Este proveedor ya firmó la declaración',
          signedAt: record.signedAt,
          signedPdfUrl: record.signedPdfUrl,
        });
        return;
      }

      // Si existe pero no está firmado, devolver el link existente
      const formUrl = `${publicBaseUrl}/declaracion?uid=${encodeURIComponent(cleanUid)}`;
      res.json({
        success: true,
        uid: cleanUid,
        status: record.status,
        message: 'Registro existente, link disponible',
        formUrl,
        statusUrl: `${publicBaseUrl}/declaracion/status?uid=${encodeURIComponent(cleanUid)}`,
        createdAt: record.createdAt,
      });
      return;
    }

    // Crear nuevo registro
    const token = randomUUID();
    const now = new Date();

    record = {
      uid: cleanUid,
      token,
      status: 'pending_form',
      createdAt: now.toISOString(),
    };

    saveRecord(record);

    // ✅ Persistir en GitHub inmediatamente (evita pérdida de datos en restart)
    if (isGitHubStorageEnabled()) {
      try {
        const gitResult = await saveDeclaracionToGitHub(record.uid, {
          uid: record.uid,
          status: record.status,
          proveedor: null, // Aún no tiene datos del proveedor
          signedAt: null,
          signedPdfUrl: null,
          signatureMetadata: null,
          documentHash: null,
        });
        if (gitResult.success) {
          console.log(`✅ Declaración ${record.uid} (pending_form) guardada en GitHub: ${gitResult.url}`);
        } else {
          console.warn(`⚠️ No se pudo guardar en GitHub: ${gitResult.message}`);
        }
      } catch (gitErr) {
        console.warn('⚠️ Error al guardar en GitHub (no crítico):', gitErr);
      }
    }

    const formUrl = `${publicBaseUrl}/declaracion?uid=${encodeURIComponent(cleanUid)}`;
    const statusUrl = `${publicBaseUrl}/declaracion/status?uid=${encodeURIComponent(cleanUid)}`;

    res.json({
      success: true,
      uid: cleanUid,
      status: 'pending_form',
      message: 'Link creado exitosamente',
      formUrl,
      statusUrl,
      createdAt: record.createdAt,
    });

  } catch (err: any) {
    console.error('Error en POST /declaracion/webhook/crear:', err);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
    });
  }
});

// ---------------------------------------------------------------------------
// POST /declaracion/webhook/bulk
// Webhook para crear múltiples links en una sola llamada
// ---------------------------------------------------------------------------
router.post('/webhook/bulk', (req: Request, res: Response): void => {
  try {
    const { uids, api_key } = req.body || {};

    // Validar API key
    const expectedApiKey = process.env.EFICENTA_API_KEY || 'eficenta-secret-key';
    if (api_key !== expectedApiKey) {
      res.status(401).json({
        success: false,
        error: 'API key inválida',
      });
      return;
    }

    // Validar uids
    if (!Array.isArray(uids) || uids.length === 0) {
      res.status(400).json({
        success: false,
        error: 'uids debe ser un array no vacío',
      });
      return;
    }

    if (uids.length > 100) {
      res.status(400).json({
        success: false,
        error: 'Máximo 100 uids por llamada',
      });
      return;
    }

    ensureDirs();
    const publicBaseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const results: any[] = [];

    for (const uid of uids) {
      if (!uid || typeof uid !== 'string' || uid.trim() === '') {
        results.push({
          uid,
          success: false,
          error: 'uid inválido',
        });
        continue;
      }

      const cleanUid = uid.trim();
      let record = loadRecord(cleanUid);

      if (record) {
        // Ya existe
        results.push({
          uid: cleanUid,
          success: true,
          status: record.status,
          formUrl: `${publicBaseUrl}/declaracion?uid=${encodeURIComponent(cleanUid)}`,
          signedPdfUrl: record.signedPdfUrl || null,
          existing: true,
        });
      } else {
        // Crear nuevo
        const token = randomUUID();
        record = {
          uid: cleanUid,
          token,
          status: 'pending_form',
          createdAt: new Date().toISOString(),
        };
        saveRecord(record);

        results.push({
          uid: cleanUid,
          success: true,
          status: 'pending_form',
          formUrl: `${publicBaseUrl}/declaracion?uid=${encodeURIComponent(cleanUid)}`,
          existing: false,
        });
      }
    }

    res.json({
      success: true,
      total: uids.length,
      created: results.filter(r => r.success && !r.existing).length,
      existing: results.filter(r => r.success && r.existing).length,
      failed: results.filter(r => !r.success).length,
      results,
    });

  } catch (err: any) {
    console.error('Error en POST /declaracion/webhook/bulk:', err);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
    });
  }
});

export default router;
