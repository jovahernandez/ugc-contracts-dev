// src/routes/webhookRoutes.ts
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { getContact, updateContactProperties } from '../clients/hubspotClient';
import { buildContractDataFromContact } from '../services/templateService';
import { renderContractDocx } from '../services/docxContractService';
import { generateDocumentHash } from '../utils/requestMetadata';

const router = Router();

// Configuración
const HUBSPOT_WEBHOOK_SECRET = process.env.HUBSPOT_WEBHOOK_SECRET || '';
const SIGNATURE_EXPIRATION_DAYS = parseInt(process.env.SIGNATURE_EXPIRATION_DAYS || '5', 10);

// Paths de almacenamiento
const storageRoot = path.join(process.cwd(), 'storage');
const contractsDir = path.join(storageRoot, 'contracts');
const signaturesDir = path.join(storageRoot, 'signatures');

function ensureDirs() {
  [storageRoot, contractsDir, signaturesDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
}

interface SignatureRecord {
  token: string;
  contactId: string;
  docxPath: string;
  docxUrl: string;
  status: 'pending' | 'signed' | 'cancelled' | 'expired';
  createdAt: string;
  expiresAt: string;
  signed: boolean;
  documentHash?: string;
}

function getSignatureFilePath(token: string): string {
  return path.join(signaturesDir, `${token}.json`);
}

function saveSignature(record: SignatureRecord): void {
  const filePath = getSignatureFilePath(record.token);
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
}

/**
 * Valida la firma X-HubSpot-Signature-v3 del webhook
 * Docs: https://developers.hubspot.com/docs/api/webhooks/validating-requests
 */
function validateHubSpotSignature(req: Request): boolean {
  if (!HUBSPOT_WEBHOOK_SECRET) {
    console.warn('[Webhook] HUBSPOT_WEBHOOK_SECRET not set - skipping signature validation (INSECURE)');
    return true; // En desarrollo puedes permitir sin validación, pero NUNCA en producción
  }

  const signature = req.headers['x-hubspot-signature-v3'];
  const requestBody = JSON.stringify(req.body);
  const timestamp = req.headers['x-hubspot-request-timestamp'];

  if (!signature || !timestamp) {
    console.error('[Webhook] Missing signature or timestamp headers');
    return false;
  }

  // HubSpot v3 firma con: HMAC-SHA256(secret, timestamp + method + uri + body) en base64
  const sourceString = timestamp + req.method + req.originalUrl + requestBody;
  const hash = crypto.createHmac('sha256', HUBSPOT_WEBHOOK_SECRET).update(sourceString).digest('base64');

  const isValid = hash === signature;

  if (!isValid) {
    console.error('[Webhook] Invalid signature:', { expected: hash, received: signature });
  }

  return isValid;
}

/**
 * POST /webhook/hubspot
 *
 * Recibe webhooks de HubSpot cuando cambian propiedades de contactos.
 *
 * HubSpot enviará un array de eventos, ej:
 * [
 *   {
 *     "objectId": 12345,
 *     "propertyName": "ready_to_generate",
 *     "propertyValue": "true",
 *     "changeSource": "CRM",
 *     "eventId": 123456789,
 *     "subscriptionId": 987654,
 *     "portalId": 123456,
 *     "appId": 123456,
 *     "occurredAt": 1234567890123,
 *     "subscriptionType": "contact.propertyChange",
 *     "attemptNumber": 0
 *   }
 * ]
 */
router.post('/hubspot', async (req: Request, res: Response): Promise<void> => {
  try {
    console.log('[Webhook] Received HubSpot webhook');
    console.log('[Webhook] Headers:', JSON.stringify(req.headers, null, 2));
    console.log('[Webhook] Body:', JSON.stringify(req.body, null, 2));

    // 1. Validar firma de HubSpot
    if (!validateHubSpotSignature(req)) {
      res.status(401).json({
        status: 'error',
        message: 'Invalid webhook signature',
      });
      return;
    }

    // 2. Procesar eventos
    const events = Array.isArray(req.body) ? req.body : [req.body];

    for (const event of events) {
      const {
        objectId,
        propertyName,
        propertyValue,
        subscriptionType,
      } = event;

      console.log(`[Webhook] Processing event: ${subscriptionType} - ${propertyName} = ${propertyValue} for contact ${objectId}`);

      // Solo procesamos cambios de propiedades de contactos
      if (subscriptionType !== 'contact.propertyChange') {
        console.log(`[Webhook] Skipping event type: ${subscriptionType}`);
        continue;
      }

      // Procesamos cuando ready_to_generate cambia a "true"
      if (propertyName === 'ready_to_generate' && propertyValue === 'true') {
        await handleGenerateContract(objectId.toString(), req);
      }

      // Opcional: También podemos manejar ready_to_sign si lo necesitas
      if (propertyName === 'ready_to_sign' && propertyValue === 'true') {
        await handleSendForSignature(objectId.toString(), req);
      }
    }

    // 3. Responder 200 OK para que HubSpot no reintente
    res.status(200).json({
      status: 'ok',
      message: 'Webhook processed',
    });

  } catch (err: any) {
    console.error('[Webhook] Error processing webhook:', err);

    // Aún así respondemos 200 para evitar reintentos innecesarios
    // Solo deberías responder 4xx/5xx si quieres que HubSpot reintente
    res.status(200).json({
      status: 'error',
      message: err?.message || 'Unknown error',
    });
  }
});

/**
 * Genera el contrato DOCX y crea el token de firma
 */
async function handleGenerateContract(contactId: string, req: Request): Promise<void> {
  try {
    console.log(`[Webhook] Generating contract for contact ${contactId}`);

    // 1. Obtener contacto desde HubSpot
    const contact = await getContact(contactId);

    // 2. Construir datos del contrato
    const data = buildContractDataFromContact(contact);

    ensureDirs();

    const baseFileName = `contract_${contactId}`;

    // 3. Generar DOCX
    const docxBuffer = renderContractDocx(data);
    const docxPath = path.join(contractsDir, `${baseFileName}.docx`);
    fs.writeFileSync(docxPath, docxBuffer);

    // 4. Crear token de firma
    const token = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (SIGNATURE_EXPIRATION_DAYS * 24 * 60 * 60 * 1000));

    const documentHash = generateDocumentHash(docxBuffer);

    // Determinar la URL base (Railway, Render, etc.)
    const publicBaseUrl = process.env.PUBLIC_BASE_URL ||
                          process.env.RENDER_EXTERNAL_URL ||
                          `${req.protocol}://${req.get('host')}`;

    const docxUrl = `${publicBaseUrl}/storage/contracts/${baseFileName}.docx`;
    const signingUrl = `${publicBaseUrl}/contracts/sign/${token}`;

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

    // 5. Actualizar HubSpot con el link de firma
    await updateContactProperties(contactId, {
      contract_link: signingUrl,
      ready_to_generate: 'false', // Resetear para evitar loops
    });

    console.log(`[Webhook] Contract generated successfully for contact ${contactId}`);
    console.log(`[Webhook] Signing URL: ${signingUrl}`);

  } catch (err: any) {
    console.error(`[Webhook] Error generating contract for contact ${contactId}:`, err);
    throw err;
  }
}

/**
 * Opcional: Maneja el envío del link de firma cuando ready_to_sign = true
 * Esto podría usarse para re-enviar el link o para un flujo de dos pasos
 */
async function handleSendForSignature(contactId: string, req: Request): Promise<void> {
  try {
    console.log(`[Webhook] Sending signature link for contact ${contactId}`);

    // Aquí podrías implementar lógica adicional, como:
    // - Enviar email con el link de firma
    // - Enviar WhatsApp con el link
    // - Registrar en un log que se envió el link
    // - etc.

    // Por ahora solo reseteamos la propiedad
    await updateContactProperties(contactId, {
      ready_to_sign: 'false',
    });

    console.log(`[Webhook] Signature link sent for contact ${contactId}`);

  } catch (err: any) {
    console.error(`[Webhook] Error sending signature link for contact ${contactId}:`, err);
    throw err;
  }
}

/**
 * GET /webhook/test
 * Endpoint de prueba para verificar que el servidor de webhooks funciona
 */
router.get('/test', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    message: 'Webhook endpoint is working',
    config: {
      hasWebhookSecret: !!HUBSPOT_WEBHOOK_SECRET,
      signatureExpirationDays: SIGNATURE_EXPIRATION_DAYS,
    },
  });
});

export default router;
