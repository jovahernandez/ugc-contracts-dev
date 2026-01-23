// src/routes/contractsRoutes.ts
import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import * as mammoth from 'mammoth';

import { authMiddleware } from '../middleware/authMiddleware';
import { getContact, updateContactProperties } from '../clients/hubspotClient';
import { buildContractDataFromContact } from '../services/templateService';
import { renderContractDocx } from '../services/docxContractService';
import { renderSignedContractDocx } from '../services/signedDocxService';
import { convertDocxToPdf } from '../services/docxToPdfService';
import { convertDocxToPdfWithCloudConvert } from '../services/cloudConvertService';
import {
  getClientIp,
  extractSignatureMetadata,
  generateDocumentHash,
  isTokenExpired,
  daysUntilExpiration,
  formatExpirationDate,
  type SignatureMetadata,
} from '../utils/requestMetadata';

const router = Router();

// Raíz de almacenamiento (coincide con server.ts)
const storageRoot = path.join(process.cwd(), 'storage');
const contractsDir = path.join(storageRoot, 'contracts');
const signaturesDir = path.join(storageRoot, 'signatures');
const declinedDir = path.join(contractsDir, 'declined');
const signedContractsDir = path.join(contractsDir, 'signed');

function ensureDirs() {
  if (!fs.existsSync(storageRoot)) {
    fs.mkdirSync(storageRoot, { recursive: true });
  }
  if (!fs.existsSync(contractsDir)) {
    fs.mkdirSync(contractsDir, { recursive: true });
  }
  if (!fs.existsSync(signaturesDir)) {
    fs.mkdirSync(signaturesDir, { recursive: true });
  }
  if (!fs.existsSync(declinedDir)) {
    fs.mkdirSync(declinedDir, { recursive: true });
  }
  if (!fs.existsSync(signedContractsDir)) {
    fs.mkdirSync(signedContractsDir, { recursive: true });
  }
}

ensureDirs();

// Días de vigencia del link de firma (configurable por env)
const SIGNATURE_EXPIRATION_DAYS = parseInt(process.env.SIGNATURE_EXPIRATION_DAYS || '5', 10);

interface SignatureRecord {
  token: string;
  contactId: string;
  docxPath: string;
  docxUrl: string;
  status: 'pending' | 'signed' | 'cancelled' | 'expired';
  createdAt: string;
  expiresAt: string;
  signed: boolean;
  signedAt?: string;
  signerName?: string;
  // Metadata extendida para auditoría legal
  signatureMetadata?: SignatureMetadata;
  documentHash?: string;
  signatureImagePath?: string;
  signatureImageUrl?: string;
  signedPdfPath?: string;
  signedPdfUrl?: string;
  signedDocumentHash?: string;
}

function getSignatureFilePath(token: string): string {
  return path.join(signaturesDir, `${token}.json`);
}

function loadSignature(token: string): SignatureRecord | null {
  const filePath = getSignatureFilePath(token);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as SignatureRecord;
}

function saveSignature(record: SignatureRecord): void {
  const filePath = getSignatureFilePath(record.token);
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
}

/**
 * Busca un registro de firma pendiente por contactId.
 */
function findPendingSignatureByContactId(contactId: string): SignatureRecord | null {
  if (!fs.existsSync(signaturesDir)) return null;

  const files = fs.readdirSync(signaturesDir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const fullPath = path.join(signaturesDir, file);
    try {
      const raw = fs.readFileSync(fullPath, 'utf-8');
      const record = JSON.parse(raw) as SignatureRecord;
      if (record.contactId === contactId && record.status === 'pending') {
        return record;
      }
    } catch (err) {
      console.error('Error parsing signature record:', file, err);
    }
  }
  return null;
}

/**
 * Convierte un DOCX a HTML para mostrarlo en la web (solo lectura).
 */
async function convertDocxToHtml(docxPath: string): Promise<string> {
  const buffer = fs.readFileSync(docxPath);
  const result = await mammoth.convertToHtml({ buffer });
  return result.value || '<p>No fue posible mostrar el contenido del contrato.</p>';
}

// ---------------------------------------------------------------------------
// Healthcheck básico del módulo de contratos
// ---------------------------------------------------------------------------
router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'contracts' });
});

// ---------------------------------------------------------------------------
// GET /contracts/demo
// Genera un contrato de PRUEBA con datos ficticios (no requiere HubSpot)
// ---------------------------------------------------------------------------
router.get(
  '/demo',
  async (req: Request, res: Response): Promise<void> => {
    try {
      ensureDirs();

      // Datos ficticios para prueba
      const demoContactId = `demo_${Date.now()}`;
      const demoData = {
        nombre_completo: 'Juan Pérez García',
        email: 'juan.perez@ejemplo.com',
        rfc: 'PEGJ900101ABC',
        domicilio: 'Av. Reforma 123, Col. Centro, CDMX',
        razon_social: 'Creador Demo S.A. de C.V.',
        marca_a_promocionar: 'Another Co.',
        monto_total: '15,000.00',
        monto_total_letra: 'Quince mil pesos 00/100 M.N.',
        fecha_de_inicio_de_servicio: '01/01/2026',
        fecha_de_fin_de_servicio: '31/01/2026',
        sow__acciones: '3 videos para TikTok, 2 historias para Instagram',
        exclusividad: 'No aplica',
        dias_de_pago: '30',
        campana: 'Campaña Demo 2026',
        cliente_ugc: 'Another Co.',
        fecha_actual: new Date().toLocaleDateString('es-MX'),
        fecha_de_la_firma: '',
        firma_creador: '',
      };

      // Crear un DOCX simple de prueba (sin template real)
      const baseFileName = `contract_${demoContactId}`;
      const docxPath = path.join(contractsDir, `${baseFileName}.docx`);

      // Intentar generar con template real, si no existe crear uno básico
      try {
        const { renderContractDocx } = await import('../services/docxContractService');
        const docxBuffer = renderContractDocx(demoData as any);
        fs.writeFileSync(docxPath, docxBuffer);
      } catch (templateErr) {
        // Si no hay template, crear archivo placeholder
        fs.writeFileSync(docxPath, Buffer.from('Demo contract placeholder'));
      }

      const publicBaseUrl =
        process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
      const docxUrl = `${publicBaseUrl}/storage/contracts/${baseFileName}.docx`;

      // Crear registro de firma
      const token = randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + (SIGNATURE_EXPIRATION_DAYS * 24 * 60 * 60 * 1000));

      const record: SignatureRecord = {
        token,
        contactId: demoContactId,
        docxPath,
        docxUrl,
        status: 'pending',
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        signed: false,
        documentHash: 'demo-hash-' + Date.now(),
      };

      saveSignature(record);

      const signingUrl = `${publicBaseUrl}/contracts/sign/${token}`;
      const previewUrl = `${publicBaseUrl}/contracts/preview/${demoContactId}`;

      // Responder con HTML amigable
      const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Demo de Contrato UGC</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
    .container { max-width: 600px; margin: 0 auto; background: #fff; padding: 24px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { color: #16a34a; font-size: 24px; }
    .info { background: #f0fdf4; border: 1px solid #86efac; padding: 16px; border-radius: 6px; margin: 16px 0; }
    .info p { margin: 8px 0; }
    a.btn { display: inline-block; padding: 12px 24px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 6px; margin: 8px 8px 8px 0; }
    a.btn.green { background: #16a34a; }
    code { background: #e5e7eb; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
    .metadata { font-size: 12px; color: #6b7280; margin-top: 20px; padding-top: 16px; border-top: 1px solid #e5e7eb; }
  </style>
</head>
<body>
  <div class="container">
    <h1>✅ Contrato de Prueba Generado</h1>
    
    <div class="info">
      <p><strong>Contacto:</strong> ${demoData.nombre_completo}</p>
      <p><strong>Email:</strong> ${demoData.email}</p>
      <p><strong>Monto:</strong> $${demoData.monto_total} MXN</p>
      <p><strong>Vigencia del link:</strong> ${SIGNATURE_EXPIRATION_DAYS} días</p>
    </div>

    <h2>Prueba el flujo:</h2>
    <p>
      <a href="${signingUrl}" class="btn green">🖊️ Ir a Firmar Contrato</a>
    </p>

    <h2>Datos técnicos:</h2>
    <div class="metadata">
      <p><strong>Token:</strong> <code>${token}</code></p>
      <p><strong>Contact ID:</strong> <code>${demoContactId}</code></p>
      <p><strong>Expira:</strong> ${expiresAt.toLocaleString('es-MX')}</p>
      <p><strong>URL de firma:</strong><br/><code>${signingUrl}</code></p>
    </div>
  </div>
</body>
</html>`;

      res.status(200).send(html);
    } catch (err: any) {
      console.error('Error generating demo contract:', err);
      res.status(500).json({
        status: 'error',
        message: 'Failed to generate demo contract',
        detail: err?.message || 'Unknown error',
      });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /contracts/generate
// Genera el contrato DOCX a partir de un contacto de HubSpot
// ---------------------------------------------------------------------------
router.post(
  '/generate',
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { contactId, source, event } = req.body || {};

      if (!contactId) {
        res.status(400).json({
          status: 'error',
          message: 'contactId is required',
        });
        return;
      }

      // 1) Obtener contacto desde HubSpot
      const contact = await getContact(contactId);

      // 2) Construir ContractData
      const data = buildContractDataFromContact(contact);

      console.log('ContractData snippet:', {
        rfc: data.rfc,
        sow__acciones: data.sow__acciones,
        email_rl: data.email_rl,
        monto_total: data.monto_total,
        monto_total_letra: data.monto_total_letra,
        fecha_de_inicio_de_servicio: data.fecha_de_inicio_de_servicio,
        fecha_de_fin_de_servicio: data.fecha_de_fin_de_servicio,
      });

      ensureDirs();

      const baseFileName = `contract_${contactId}`;

      // Base pública para URLs (por ejemplo Codespaces)
      const publicBaseUrl =
        process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;

      // 3) Generar DOCX
      const docxBuffer = renderContractDocx(data);
      const docxPath = path.join(contractsDir, `${baseFileName}.docx`);
      fs.writeFileSync(docxPath, docxBuffer);

      const docxUrl = `${publicBaseUrl}/storage/contracts/${baseFileName}.docx`;

      // 4) Responder
      res.json({
        status: 'ok',
        message: 'Contract DOCX draft generated',
        contactId,
        source: source || null,
        event: event || null,
        docxUrl,
        pdfUrl: null,
      });
    } catch (err: any) {
      console.error('Error generating contract DOCX:', err);

      res.status(500).json({
        status: 'error',
        message: 'Failed to generate contract DOCX',
        detail: err?.message || 'Unknown error',
      });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /contracts/send-for-signature
// (Opcional: para flujos internos) Crea un token y registro de firma.
// ---------------------------------------------------------------------------
router.post(
  '/send-for-signature',
  authMiddleware,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { contactId } = req.body || {};

      if (!contactId) {
        res.status(400).json({
          status: 'error',
          message: 'contactId is required',
        });
        return;
      }

      ensureDirs();

      const baseFileName = `contract_${contactId}`;
      const docxPath = path.join(contractsDir, `${baseFileName}.docx`);

      if (!fs.existsSync(docxPath)) {
        res.status(400).json({
          status: 'error',
          message: `Contract DOCX not found for contactId ${contactId}. Generate it first.`,
        });
        return;
      }

      const publicBaseUrl =
        process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;

      const docxUrl = `${publicBaseUrl}/storage/contracts/${baseFileName}.docx`;

      const token = randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + (SIGNATURE_EXPIRATION_DAYS * 24 * 60 * 60 * 1000));

      // Generar hash del documento para auditoría
      const docxBuffer = fs.readFileSync(docxPath);
      const documentHash = generateDocumentHash(docxBuffer);

      const record: SignatureRecord = {
        token,
        contactId,
        docxPath,
        docxUrl,
        status: 'pending',
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        signed: false,
        documentHash,
      };

      saveSignature(record);

      const signingUrl = `${publicBaseUrl}/contracts/sign/${token}`;

      res.json({
        status: 'ok',
        message: 'Signature link created',
        contactId,
        token,
        signingUrl,
      });
    } catch (err: any) {
      console.error('Error creating signature link:', err);

      res.status(500).json({
        status: 'error',
        message: 'Failed to create signature link',
        detail: err?.message || 'Unknown error',
      });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /contracts/decline/:contactId
// Rechaza el contrato: mueve el DOCX a carpeta "Declined" y marca firma cancelada.
// ---------------------------------------------------------------------------
router.post(
  '/decline/:contactId',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { contactId } = req.params;

      if (!contactId) {
        res.status(400).json({
          status: 'error',
          message: 'contactId is required',
        });
        return;
      }

      ensureDirs();

      const baseFileName = `contract_${contactId}`;
      const docxPath = path.join(contractsDir, `${baseFileName}.docx`);

      if (!fs.existsSync(docxPath)) {
        res.status(404).json({
          status: 'error',
          message: `No se encontró contrato para el contacto ${contactId}`,
        });
        return;
      }

      // Mover el contrato a la carpeta Declined
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const declinedDocxPath = path.join(
        declinedDir,
        `${baseFileName}_${timestamp}.docx`
      );
      fs.renameSync(docxPath, declinedDocxPath);

      // Si hay un registro de firma pendiente, marcarlo como cancelado
      const existingRecord = findPendingSignatureByContactId(contactId);
      if (existingRecord) {
        existingRecord.status = 'cancelled';
        existingRecord.signed = false;
        saveSignature(existingRecord);
      }

      // Guardar un pequeño marcador de "declinado"
      const declinedInfoPath = path.join(
        declinedDir,
        `declined_${contactId}.json`
      );
      const declinedInfo = {
        contactId,
        declinedAt: new Date().toISOString(),
        originalPath: docxPath,
        declinedPath: declinedDocxPath,
      };
      fs.writeFileSync(
        declinedInfoPath,
        JSON.stringify(declinedInfo, null, 2),
        'utf-8'
      );

      res.json({
        status: 'ok',
        message: 'Contract declined and moved to Declined folder',
      });
    } catch (err: any) {
      console.error('Error declining contract:', err);
      res.status(500).json({
        status: 'error',
        message: 'Failed to decline contract',
        detail: err?.message || 'Unknown error',
      });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /contracts/preview/:contactId
// Vista de contrato en solo lectura + botones Rechazar / Aceptar y firmar
// ---------------------------------------------------------------------------
router.get(
  '/preview/:contactId',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { contactId } = req.params;

      if (!contactId) {
        res
          .status(400)
          .send('<h1>Error</h1><p>Falta el contactId en la URL.</p>');
        return;
      }

      ensureDirs();

      const baseFileName = `contract_${contactId}`;
      const docxPath = path.join(contractsDir, `${baseFileName}.docx`);

      // Si el contrato ya fue movido a Declined, mostrar mensaje claro
      if (!fs.existsSync(docxPath)) {
        const declinedInfoPath = path.join(
          declinedDir,
          `declined_${contactId}.json`
        );
        if (fs.existsSync(declinedInfoPath)) {
          res
            .status(410)
            .send(
              `<h1>Contrato rechazado</h1><p>Gracias, este contrato fue rechazado y ya no está disponible.</p>`
            );
          return;
        }

        res
          .status(404)
          .send(
            `<h1>Contrato no encontrado</h1><p>No existe un contrato generado para el contacto ${contactId}. Primero hay que generarlo.</p>`
          );
        return;
      }

      const contractHtml = await convertDocxToHtml(docxPath);

      const publicBaseUrl =
        process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
      const docxUrl = `${publicBaseUrl}/storage/contracts/${baseFileName}.docx`;

      // Aseguramos un registro de firma "pending" para este contactId (o reutilizamos uno existente)
      let signatureRecord = findPendingSignatureByContactId(contactId);

      if (!signatureRecord) {
        const token = randomUUID();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + (SIGNATURE_EXPIRATION_DAYS * 24 * 60 * 60 * 1000));
        
        // Generar hash del documento para auditoría
        const docxBuffer = fs.readFileSync(docxPath);
        const documentHash = generateDocumentHash(docxBuffer);

        signatureRecord = {
          token,
          contactId,
          docxPath,
          docxUrl,
          status: 'pending',
          createdAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          signed: false,
          documentHash,
        };
        saveSignature(signatureRecord);
      }

      const signingUrl = `${publicBaseUrl}/contracts/sign/${signatureRecord.token}`;
      const safeSigningUrl = signingUrl.replace(/"/g, '\\"');
      const safeContactIdJs = contactId.replace(/'/g, "\\'");

      const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Vista de contrato UGC</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      margin: 0;
      padding: 16px;
      background: #f5f5f5;
    }
    .container {
      max-width: 960px;
      margin: 0 auto;
      background: #ffffff;
      padding: 24px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    h1 {
      font-size: 20px;
      margin-bottom: 8px;
    }
    h2 {
      font-size: 16px;
      margin-top: 24px;
      margin-bottom: 8px;
    }
    p {
      margin: 4px 0;
    }
    .contract-body {
      margin-top: 16px;
      padding: 16px;
      border-radius: 8px;
      border: 1px solid #e5e7eb;
      max-height: 60vh;
      overflow: auto;
    }
    .contract-body table {
      border-collapse: collapse;
      width: 100%;
    }
    .contract-body table, 
    .contract-body th, 
    .contract-body td {
      border: 1px solid #d1d5db;
    }
    .contract-body th, 
    .contract-body td {
      padding: 6px 8px;
      font-size: 13px;
    }
    .actions {
      display: flex;
      gap: 12px;
      margin-top: 16px;
    }
    button {
      padding: 10px 14px;
      border-radius: 4px;
      border: none;
      font-size: 14px;
      cursor: pointer;
    }
    button.primary {
      background: #16a34a;
      color: #fff;
    }
    button.secondary {
      background: #ef4444;
      color: #fff;
    }
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.45);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
    .modal {
      background: #ffffff;
      padding: 24px;
      border-radius: 8px;
      max-width: 420px;
      text-align: center;
      box-shadow: 0 10px 25px rgba(0,0,0,0.15);
    }
    .modal h2 {
      margin-top: 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Vista de contrato UGC</h1>
    <p>Contrato asociado al contacto: <strong>${contactId}</strong></p>

    <p>Este contrato es de solo lectura, no puede ser editado por el creador.</p>

    <div class="contract-body">
      ${contractHtml}
    </div>

    <h2>Acciones</h2>
    <p>Por favor revisa el contenido. Después puedes rechazarlo o aceptarlo para proceder con la firma electrónica.</p>

    <div class="actions">
      <button id="declineButton" class="secondary">Rechazar contrato</button>
      <button id="acceptButton" class="primary">Aceptar y firmar</button>
    </div>
  </div>

  <div id="modalBackdrop" class="modal-backdrop">
    <div class="modal">
      <h2>Contrato rechazado</h2>
      <p id="modalMessage">Gracias, el contrato fue eliminado.</p>
    </div>
  </div>

  <script>
    (function() {
      var contactId = '${safeContactIdJs}';
      var signingUrl = "${safeSigningUrl}";
      var declineButton = document.getElementById('declineButton');
      var acceptButton = document.getElementById('acceptButton');
      var modalBackdrop = document.getElementById('modalBackdrop');
      var modalMessage = document.getElementById('modalMessage');

      // Rechazar contrato
      declineButton.addEventListener('click', function() {
        var confirmed = window.confirm('¿Estás seguro de que quieres rechazar este contrato?');
        if (!confirmed) return;

        fetch('/contracts/decline/' + encodeURIComponent(contactId), {
          method: 'POST'
        })
          .then(function(response) {
            if (!response.ok) {
              throw new Error('Respuesta no OK');
            }
            return response.json();
          })
          .then(function(data) {
            console.log('Contrato rechazado:', data);
            modalMessage.textContent = 'Gracias, el contrato fue eliminado.';
            modalBackdrop.style.display = 'flex';
            acceptButton.disabled = true;
            declineButton.disabled = true;
          })
          .catch(function(err) {
            console.error('Error al rechazar contrato:', err);
            window.alert('No fue posible rechazar el contrato. Intenta de nuevo más tarde.');
          });
      });

      // Aceptar y pasar a firma
      acceptButton.addEventListener('click', function() {
        window.location.href = signingUrl;
      });
    })();
  </script>
</body>
</html>`;

      res.status(200).send(html);
    } catch (err: any) {
      console.error('Error rendering contract preview:', err);
      res
        .status(500)
        .send('<h1>Error</h1><p>No fue posible mostrar la vista del contrato.</p>');
    }
  }
);

// ---------------------------------------------------------------------------
// GET /contracts/sign/:token
// Revisión + firma manuscrita, renderizando el contrato como HTML.
// ---------------------------------------------------------------------------
router.get(
  '/sign/:token',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { token } = req.params;
      const record = loadSignature(token);

      if (!record) {
        res
          .status(404)
          .send('<h1>Enlace no válido</h1><p>El enlace de firma no existe.</p>');
        return;
      }

      // Verificar si el token expiró
      if (record.expiresAt && isTokenExpired(record.createdAt, SIGNATURE_EXPIRATION_DAYS)) {
        // Marcar como expirado si aún no lo estaba
        if (record.status === 'pending') {
          record.status = 'expired';
          saveSignature(record);
        }
        res
          .status(410)
          .send(
            `<h1>Enlace expirado</h1><p>El plazo para firmar este contrato ha vencido. Por favor contacta a Another Co. para solicitar un nuevo enlace.</p>`
          );
        return;
      }

      if (record.status !== 'pending') {
        const statusMessages: Record<string, string> = {
          signed: 'Este contrato ya fue firmado.',
          cancelled: 'Este contrato fue rechazado.',
          expired: 'El plazo para firmar este contrato ha vencido.',
        };
        res
          .status(400)
          .send(
            `<h1>Enlace no disponible</h1><p>${statusMessages[record.status] || 'El enlace está inactivo.'}</p>`
          );
        return;
      }

      // Calcular días restantes para mostrar al usuario
      const daysLeft = daysUntilExpiration(record.createdAt, SIGNATURE_EXPIRATION_DAYS);
      const expirationDateFormatted = formatExpirationDate(record.createdAt, SIGNATURE_EXPIRATION_DAYS);

      const contractHtml = await convertDocxToHtml(record.docxPath);

      const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Revisión y firma de contrato UGC</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      margin: 0;
      padding: 16px;
      background: #f5f5f5;
    }
    .container {
      max-width: 960px;
      margin: 0 auto;
      background: #ffffff;
      padding: 24px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    h1 {
      font-size: 20px;
      margin-bottom: 8px;
    }
    h2 {
      font-size: 16px;
      margin-top: 24px;
      margin-bottom: 8px;
    }
    p {
      margin: 4px 0;
    }
    label {
      display: block;
      margin-top: 12px;
      font-size: 14px;
    }
    input[type="text"] {
      width: 100%;
      padding: 8px;
      margin-top: 4px;
      border-radius: 4px;
      border: 1px solid #d1d5db;
      font-size: 14px;
    }
    .checkbox-row {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-top: 12px;
      font-size: 14px;
    }
    .signature-box {
      margin-top: 16px;
    }
    canvas {
      border: 1px solid #9ca3af;
      border-radius: 4px;
      width: 100%;
      max-width: 100%;
      touch-action: none;
    }
    .actions {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      margin-top: 16px;
    }
    button {
      padding: 10px 14px;
      border-radius: 4px;
      border: none;
      font-size: 14px;
      cursor: pointer;
    }
    button.primary {
      background: #16a34a;
      color: #fff;
    }
    button.secondary {
      background: #e5e7eb;
      color: #111827;
    }
    .note {
      font-size: 12px;
      color: #6b7280;
      margin-top: 8px;
    }
    .contract-body {
      margin-top: 16px;
      padding: 16px;
      border-radius: 8px;
      border: 1px solid #e5e7eb;
      max-height: 60vh;
      overflow: auto;
    }
    .contract-body table {
      border-collapse: collapse;
      width: 100%;
    }
    .contract-body table,
    .contract-body th,
    .contract-body td {
      border: 1px solid #d1d5db;
    }
    .contract-body th,
    .contract-body td {
      padding: 6px 8px;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Revisión y firma de contrato UGC</h1>
    <p>Contrato asociado al contacto: <strong>${record.contactId}</strong></p>
    
    <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px; padding: 12px; margin: 16px 0;">
      <p style="margin: 0; font-size: 14px; color: #92400e;">
        <strong>⏰ Vigencia del enlace:</strong> Tienes hasta el <strong>${expirationDateFormatted}</strong> para firmar este contrato (${daysLeft} día${daysLeft !== 1 ? 's' : ''} restante${daysLeft !== 1 ? 's' : ''}).
      </p>
    </div>

    <h2>1. Revisa tu contrato</h2>
    <p>Este contrato es de solo lectura, no puede ser modificado.</p>
    <div class="contract-body">
      ${contractHtml}
    </div>

    <h2>2. Confirma y firma electrónicamente</h2>
    <form method="POST">
      <label>
        Nombre completo para la firma
        <input type="text" name="signerName" required />
      </label>

      <div class="checkbox-row">
        <input type="checkbox" id="accepted" name="accepted" value="yes" required />
        <label for="accepted">
          Confirmo que he leído y acepto el contenido del contrato y autorizo el uso de mi firma electrónica manuscrita.
        </label>
      </div>

      <div class="signature-box">
        <p>Firma manuscrita digital (usa tu dedo o mouse):</p>
        <canvas id="signatureCanvas" width="800" height="220"></canvas>
        <div class="actions">
          <button type="button" class="secondary" id="clearButton">Borrar firma</button>
          <button type="submit" class="primary">Firmar electrónicamente</button>
        </div>
        <p class="note">
          Al firmar, se almacenará tu firma, nombre, fecha, IP y dispositivo como respaldo de esta aceptación.
        </p>
      </div>

      <input type="hidden" name="signatureData" id="signatureData" />
      <input type="hidden" name="timezoneOffset" id="timezoneOffset" />
    </form>
  </div>

  <script>
    (function() {
      // Capturar timezone del cliente
      document.getElementById('timezoneOffset').value = new Date().getTimezoneOffset();
      
      var canvas = document.getElementById('signatureCanvas');
      var ctx = canvas.getContext('2d');
      var drawing = false;
      var hasDrawing = false;

      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#111827';

      function getPos(e) {
        var rect = canvas.getBoundingClientRect();
        if (e.touches && e.touches.length > 0) {
          return {
            x: e.touches[0].clientX - rect.left,
            y: e.touches[0].clientY - rect.top
          };
        } else {
          return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
          };
        }
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

      // Eventos mouse
      canvas.addEventListener('mousedown', startDrawing);
      canvas.addEventListener('mousemove', draw);
      canvas.addEventListener('mouseup', stopDrawing);
      canvas.addEventListener('mouseleave', stopDrawing);

      // Eventos touch
      canvas.addEventListener('touchstart', startDrawing, { passive: false });
      canvas.addEventListener('touchmove', draw, { passive: false });
      canvas.addEventListener('touchend', stopDrawing, { passive: false });
      canvas.addEventListener('touchcancel', stopDrawing, { passive: false });

      // Botón borrar
      var clearButton = document.getElementById('clearButton');
      clearButton.addEventListener('click', function() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        hasDrawing = false;
      });

      // Función para contar píxeles de la firma (no transparentes)
      function getSignaturePixelCount() {
        var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        var pixels = imageData.data;
        var count = 0;
        // Cada píxel tiene 4 valores: R, G, B, A
        for (var i = 3; i < pixels.length; i += 4) {
          // Si el canal alpha es mayor a 0, el píxel tiene contenido
          if (pixels[i] > 0) {
            count++;
          }
        }
        return count;
      }

      // Mínimo de píxeles requeridos para una firma válida
      var MIN_SIGNATURE_PIXELS = 500;

      // Submit del formulario
      var form = document.querySelector('form');
      var signatureInput = document.getElementById('signatureData');

      form.addEventListener('submit', function(e) {
        if (!hasDrawing) {
          e.preventDefault();
          alert('Por favor realiza tu firma en el recuadro antes de continuar.');
          return;
        }

        var pixelCount = getSignaturePixelCount();
        if (pixelCount < MIN_SIGNATURE_PIXELS) {
          e.preventDefault();
          alert('La firma es muy pequeña. Por favor dibuja una firma más completa y legible.');
          return;
        }

        var dataUrl = canvas.toDataURL('image/png');
        signatureInput.value = dataUrl;
      });
    })();
  </script>
</body>
</html>`;

      res.status(200).send(html);
    } catch (err: any) {
      console.error('Error rendering signature page:', err);
      res
        .status(500)
        .send('<h1>Error</h1><p>No fue posible mostrar la página de firma.</p>');
    }
  }
);

// ---------------------------------------------------------------------------
// POST /contracts/sign/:token
// Procesa la firma: guarda PNG, genera DOCX firmado, convierte a PDF (stub) y actualiza HubSpot.
// ---------------------------------------------------------------------------
router.post(
  '/sign/:token',
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { token } = req.params;
      const record = loadSignature(token);

      if (!record) {
        res
          .status(404)
          .send('<h1>Enlace no válido</h1><p>El enlace de firma no existe.</p>');
        return;
      }

      // Verificar expiración también en POST
      if (record.expiresAt && isTokenExpired(record.createdAt, SIGNATURE_EXPIRATION_DAYS)) {
        if (record.status === 'pending') {
          record.status = 'expired';
          saveSignature(record);
        }
        res
          .status(410)
          .send(
            `<h1>Enlace expirado</h1><p>El plazo para firmar este contrato ha vencido. Por favor contacta a Another Co. para solicitar un nuevo enlace.</p>`
          );
        return;
      }

      if (record.status !== 'pending') {
        res
          .status(400)
          .send(
            '<h1>Enlace no disponible</h1><p>Este contrato ya fue firmado o el enlace está inactivo.</p>'
          );
        return;
      }

      const signerName = (req.body?.signerName || '').toString().trim();
      const accepted = req.body?.accepted;
      const signatureData = req.body?.signatureData;
      const timezoneOffset = parseInt(req.body?.timezoneOffset || '0', 10);

      if (!signerName) {
        res
          .status(400)
          .send(
            '<h1>Datos incompletos</h1><p>El nombre para la firma es obligatorio.</p>'
          );
        return;
      }

      if (accepted !== 'yes') {
        res
          .status(400)
          .send(
            '<h1>Confirmación requerida</h1><p>Debes confirmar que aceptas el contenido del contrato para poder firmar.</p>'
          );
        return;
      }

      if (
        !signatureData ||
        typeof signatureData !== 'string' ||
        !signatureData.startsWith('data:image/')
      ) {
        res
          .status(400)
          .send(
            '<h1>Firma requerida</h1><p>No se recibió una firma válida. Por favor vuelve a intentarlo.</p>'
          );
        return;
      }

      ensureDirs();

      // 1) Guardar la imagen PNG de la firma
      const base64Part = signatureData.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Part, 'base64');

      const signatureImageFileName = `signature_${token}.png`;
      const signatureImagePath = path.join(signaturesDir, signatureImageFileName);

      fs.writeFileSync(signatureImagePath, buffer);

      const publicBaseUrl =
        process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;

      const signatureImageUrl = `${publicBaseUrl}/storage/signatures/${signatureImageFileName}`;

      // 2) Fecha de firma (para documento y para HubSpot)
      const signedAtDate = new Date();
      const dd = String(signedAtDate.getDate()).padStart(2, '0');
      const mm = String(signedAtDate.getMonth() + 1).padStart(2, '0');
      const yyyy = signedAtDate.getFullYear();
      const signedAtDisplay = `${dd}/${mm}/${yyyy}`; // para documento (DD/MM/AAAA)
      const signedAtIsoDate = `${yyyy}-${mm}-${dd}`; // para HubSpot (YYYY-MM-DD)

      // 3) Regenerar DOCX FIRMAdo con fecha y firma en la plantilla

      // 3.1 Traer de nuevo el contacto desde HubSpot
      const contact = await getContact(record.contactId);
      let contractData = buildContractDataFromContact(contact);

      // 3.2 Sobrescribir fecha_de_la_firma y firma_creador
      contractData = {
        ...contractData,
        fecha_de_la_firma: signedAtDisplay,    // DD/MM/AAAA en el documento
        firma_creador: signatureImagePath,     // se usará en {%firma_creador} en Word
      };

      // 3.3 Generar DOCX FIRMAdo
      const signedDocxFileName = `contract_${record.contactId}_signed.docx`;
      const signedDocxPath = path.join(signedContractsDir, signedDocxFileName);

      const signedDocxBuffer = renderSignedContractDocx(
        contractData,
        signatureImagePath
      );
      fs.writeFileSync(signedDocxPath, signedDocxBuffer);

      // 3.4 Convertir DOCX a PDF usando CloudConvert (con Puppeteer como fallback)
      let pdfPath: string;
      let conversionMethod = 'none';

      try {
        console.log(`[PDF] Convirtiendo contrato DOCX a PDF para ${record.contactId}...`);

        // Intentar primero con CloudConvert (más confiable)
        const cloudConvertApiKey = process.env.CLOUDCONVERT_API_KEY;
        if (cloudConvertApiKey) {
          try {
            console.log(`[PDF] Intentando conversión con CloudConvert...`);
            pdfPath = await convertDocxToPdfWithCloudConvert(signedDocxPath, signedContractsDir);
            conversionMethod = 'cloudconvert';
            console.log(`[PDF] ✅ Conversión exitosa con CloudConvert: ${pdfPath}`);
          } catch (cloudConvertErr: any) {
            console.error(`[PDF] ⚠️ CloudConvert falló: ${cloudConvertErr.message}`);
            console.log(`[PDF] Intentando con Puppeteer como fallback...`);

            // Fallback a Puppeteer si CloudConvert falla
            pdfPath = await convertDocxToPdf(signedDocxPath, signedContractsDir);
            conversionMethod = 'puppeteer';
            console.log(`[PDF] ✅ Conversión exitosa con Puppeteer (fallback): ${pdfPath}`);
          }
        } else {
          // Si no hay CloudConvert configurado, usar Puppeteer directamente
          console.log(`[PDF] CloudConvert no configurado, usando Puppeteer...`);
          pdfPath = await convertDocxToPdf(signedDocxPath, signedContractsDir);
          conversionMethod = 'puppeteer';
          console.log(`[PDF] ✅ Conversión exitosa con Puppeteer: ${pdfPath}`);
        }
      } catch (pdfErr: any) {
        console.error(`[PDF] ❌ Error en todas las conversiones: ${pdfErr.message}`);
        throw new Error(`Error al convertir contrato a PDF: ${pdfErr.message}`);
      }

      console.log(`[PDF] Método de conversión usado: ${conversionMethod}`);

      const pdfRelative = path
        .relative(storageRoot, pdfPath)
        .replace(/\\/g, '/');
      const signedPdfUrl = `${publicBaseUrl}/storage/${pdfRelative}`;

      // Generar hash del documento firmado para auditoría
      const signedDocBuffer = fs.readFileSync(pdfPath);
      const signedDocumentHash = generateDocumentHash(signedDocBuffer);

      // 4) Extraer metadata completa para auditoría legal
      const signatureMetadata = extractSignatureMetadata(req, timezoneOffset);

      // 5) Actualizar registro local con toda la información
      record.signed = true;
      record.status = 'signed';
      record.signedAt = signedAtDate.toISOString();
      record.signerName = signerName;
      record.signatureMetadata = signatureMetadata;
      record.signatureImagePath = signatureImagePath;
      record.signatureImageUrl = signatureImageUrl;
      record.signedPdfPath = pdfPath;
      record.signedPdfUrl = signedPdfUrl;
      record.signedDocumentHash = signedDocumentHash;

      saveSignature(record);

      // 6) Actualizar HubSpot (no rompe si falla)
      try {
        await updateContactProperties(record.contactId, {
          // Fecha en formato YYYY-MM-DD (para propiedad de fecha en HubSpot)
          fecha_de_la_firma: signedAtIsoDate,

          // Link al PDF final firmado (o DOCX si CloudConvert fallara)
          contract_signed_link: signedPdfUrl,

          // Marcar contrato como firmado en HubSpot (propiedad booleana)
          signed: true, // Si tu propiedad es boolean "de sistema"; si fuera sí/no texto, se cambiaría por 'si'
        });
      } catch (err) {
        console.warn(
          'Failed to update HubSpot on signed:',
          (err as any)?.message || err
        );
      }


      // 7) Responder al creador con opción de descarga
      const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Contrato firmado</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      margin: 0;
      padding: 16px;
      background: #f5f5f5;
    }
    .container {
      max-width: 640px;
      margin: 0 auto;
      background: #ffffff;
      padding: 24px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    h1 {
      font-size: 20px;
      margin-bottom: 8px;
      color: #16a34a;
    }
    p {
      margin: 4px 0;
    }
    .success-icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    .note {
      font-size: 13px;
      color: #6b7280;
      margin-top: 16px;
      padding: 12px;
      background: #f9fafb;
      border-radius: 6px;
    }
    img {
      max-width: 200px;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      margin-top: 12px;
    }
    .download-section {
      margin-top: 24px;
      padding: 16px;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 8px;
    }
    .download-section h2 {
      font-size: 16px;
      margin: 0 0 12px 0;
      color: #1e40af;
    }
    a.button-link {
      display: inline-block;
      margin-top: 8px;
      margin-right: 8px;
      padding: 10px 16px;
      background: #2563eb;
      color: #fff;
      text-decoration: none;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 500;
    }
    a.button-link:hover {
      background: #1d4ed8;
    }
    a.button-secondary {
      background: #6b7280;
    }
    a.button-secondary:hover {
      background: #4b5563;
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
    <div class="success-icon">✅</div>
    <h1>¡Contrato firmado correctamente!</h1>
    <p>Gracias, <strong>${signerName}</strong>. Hemos registrado tu firma electrónica manuscrita.</p>

    <div class="download-section">
      <h2>📄 Descarga tu copia</h2>
      <p>Guarda una copia del contrato firmado para tus registros:</p>
      <a href="${signedPdfUrl}" class="button-link" download>Descargar PDF firmado</a>
    </div>

    <div class="note">
      <p><strong>Fecha de firma:</strong> ${signedAtDisplay}</p>
      <p><strong>Firmante:</strong> ${signerName}</p>
      ${
        signatureImageUrl
          ? `<p><strong>Tu firma registrada:</strong></p><img src="${signatureImageUrl}" alt="Firma electrónica" />`
          : ''
      }
      <p style="margin-top: 12px;">Another Co. conservará en sus sistemas el contrato firmado en formato electrónico para cualquier aclaración futura.</p>
    </div>
    
    <div class="metadata">
      <p>ID de transacción: ${token}</p>
      <p>IP registrada: ${signatureMetadata.ip}</p>
      <p>Hora UTC: ${signatureMetadata.signedAtUtc}</p>
    </div>
  </div>
</body>
</html>`;

      res.status(200).send(html);
    } catch (err: any) {
      console.error('Error processing signature:', err);
      const msg = (err && (err as any).message) || 'Unknown error';
      res
        .status(500)
        .send(
          `<h1>Error</h1><p>No fue posible procesar la firma: ${msg}</p>`
        );
    }
  }
);

export default router;
