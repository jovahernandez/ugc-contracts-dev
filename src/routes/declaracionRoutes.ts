// src/routes/declaracionRoutes.ts
// Flujo de Declaración de Ausencia de Conflicto de Interés para EFFICENTA
import { Router, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import * as mammoth from 'mammoth';
import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import ImageModule from 'docxtemplater-image-module-free';
import { convertDocxToPdf } from '../services/docxToPdfService';
import { convertDocxToPdfWithCloudConvert } from '../services/cloudConvertService';
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

// ============================================================================
// SISTEMA DE INTERNACIONALIZACIÓN (i18n)
// ============================================================================
type SupportedLanguage = 'es' | 'en' | 'pt';

const translations: Record<SupportedLanguage, Record<string, string>> = {
  es: {
    // Language selector
    lang_title: 'Seleccione su idioma',
    lang_subtitle: 'Por favor seleccione el idioma en el que desea ver el documento',
    lang_spanish: 'Español',
    lang_english: 'English',
    lang_portuguese: 'Português',
    lang_continue: 'Continuar',
    lang_select_required: 'Debe seleccionar un idioma para continuar',

    // Form page
    form_title: 'Declaración de Ausencia de Conflicto de Interés',
    form_subtitle_prefilled: 'Verifique que los siguientes datos sean correctos',
    form_subtitle_empty: 'Complete los siguientes datos para generar su declaración',
    form_provider_id: 'ID del Proveedor',
    form_prefilled_notice: 'Datos Pre-llenados',
    form_prefilled_msg: 'Los datos han sido pre-llenados por EFFICENTA. Si encuentra algún error, haga clic en "Datos incorrectos" para contactarnos.',
    form_company_name: 'Nombre o Razón Social del Proveedor',
    form_company_placeholder: 'Ej: Empresa ABC S.A. de C.V.',
    form_legal_rep: 'Nombre del Representante Legal',
    form_legal_rep_placeholder: 'Ej: Juan Pérez García',
    form_email: 'Correo Electrónico',
    form_email_placeholder: 'Ej: contacto@empresa.com',
    form_submit: 'Generar Documento',
    form_back_btn: 'Regresar a EFFICENTA',
    form_required: '*',

    // Signature page
    sign_title: 'Declaración de Ausencia de Conflicto de Interés',
    sign_provider: 'Proveedor',
    sign_legal_rep: 'Representante Legal',
    sign_review_doc: '1. Revise el documento',
    sign_section_title: '2. Firme electrónicamente',
    sign_instructions: 'Dibuje su firma en el recuadro (use su dedo en móvil o mouse en computadora):',
    sign_checkbox: 'Declaro bajo protesta de decir verdad que no tengo conflicto de interés alguno con EFFICENTA, y autorizo el uso de mi firma electrónica manuscrita.',
    sign_clear_btn: 'Borrar firma',
    sign_submit_btn: 'Firmar Declaración',
    sign_no_signature: 'Por favor dibuje su firma antes de continuar.',
    sign_too_small: 'La firma es muy pequeña. Por favor dibuje una firma más completa y legible.',
    sign_authorized_note: 'Indique el nombre completo de la persona autorizada para firmar legalmente en nombre de su empresa.',

    // Success page
    success_title: '¡Declaración Firmada Exitosamente!',
    success_message: 'Su declaración de ausencia de conflicto de interés ha sido registrada.',
    success_download: 'Descargar Documento Firmado',
    success_provider: 'Proveedor',
    success_legal_rep: 'Representante Legal',
    success_date: 'Fecha de firma',

    // Errors
    error_invalid_link: 'Enlace inválido',
    error_no_uid: 'El enlace no contiene el identificador del proveedor (uid).',
    error_contact: 'Por favor contacte a EFFICENTA para obtener el enlace correcto.',
    error_already_signed: 'Declaración ya firmada',
    error_already_signed_msg: 'La declaración para este proveedor ya fue completada y firmada.',
    error_sign_date: 'Fecha de firma',
    error_link_invalid: 'Enlace no válido',
    error_link_expired: 'El enlace de firma no existe o ha expirado.',
    error_doc_not_found: 'Documento no encontrado.',
    error_generic: 'Error',
    error_accept_required: 'Debe aceptar la declaración para continuar.',
    error_no_signature: 'No se recibió una firma válida.',
    error_already_signed_simple: 'Esta declaración ya fue firmada',
  },
  en: {
    // Language selector
    lang_title: 'Select your language',
    lang_subtitle: 'Please select the language in which you want to view the document',
    lang_spanish: 'Español',
    lang_english: 'English',
    lang_portuguese: 'Português',
    lang_continue: 'Continue',
    lang_select_required: 'You must select a language to continue',

    // Form page
    form_title: 'Statement of No Conflict of Interest',
    form_subtitle_prefilled: 'Verify that the following information is correct',
    form_subtitle_empty: 'Complete the following information to generate your statement',
    form_provider_id: 'Supplier ID',
    form_prefilled_notice: 'Pre-filled Data',
    form_prefilled_msg: 'The data has been pre-filled by EFFICENTA. If you find any errors, click "Incorrect Data" to contact us.',
    form_company_name: 'Name of Supplier or Company Name',
    form_company_placeholder: 'Ex: ABC Company Inc.',
    form_legal_rep: 'Name of Legal Representative',
    form_legal_rep_placeholder: 'Ex: John Smith',
    form_email: 'Email Address',
    form_email_placeholder: 'Ex: contact@company.com',
    form_submit: 'Generate Document',
    form_back_btn: 'Return to EFFICENTA',
    form_required: '*',

    // Signature page
    sign_title: 'Statement of No Conflict of Interest',
    sign_provider: 'Supplier',
    sign_legal_rep: 'Legal Representative',
    sign_review_doc: '1. Review the document',
    sign_section_title: '2. Sign electronically',
    sign_instructions: 'Draw your signature in the box (use your finger on mobile or mouse on computer):',
    sign_checkbox: 'I declare under penalty of perjury that I have no conflict of interest with EFFICENTA, and I authorize the use of my handwritten electronic signature.',
    sign_clear_btn: 'Clear signature',
    sign_submit_btn: 'Sign Statement',
    sign_no_signature: 'Please draw your signature before continuing.',
    sign_too_small: 'The signature is too small. Please draw a more complete and legible signature.',
    sign_authorized_note: 'Please indicate the full name of the person authorized to legally sign on behalf of your company.',

    // Success page
    success_title: 'Statement Successfully Signed!',
    success_message: 'Your statement of no conflict of interest has been recorded.',
    success_download: 'Download Signed Document',
    success_provider: 'Supplier',
    success_legal_rep: 'Legal Representative',
    success_date: 'Signature date',

    // Errors
    error_invalid_link: 'Invalid link',
    error_no_uid: 'The link does not contain the supplier identifier (uid).',
    error_contact: 'Please contact EFFICENTA to obtain the correct link.',
    error_already_signed: 'Statement already signed',
    error_already_signed_msg: 'The statement for this supplier has already been completed and signed.',
    error_sign_date: 'Signature date',
    error_link_invalid: 'Invalid link',
    error_link_expired: 'The signature link does not exist or has expired.',
    error_doc_not_found: 'Document not found.',
    error_generic: 'Error',
    error_accept_required: 'You must accept the statement to continue.',
    error_no_signature: 'No valid signature received.',
    error_already_signed_simple: 'This statement has already been signed',
  },
  pt: {
    // Language selector
    lang_title: 'Selecione seu idioma',
    lang_subtitle: 'Por favor selecione o idioma em que deseja ver o documento',
    lang_spanish: 'Español',
    lang_english: 'English',
    lang_portuguese: 'Português',
    lang_continue: 'Continuar',
    lang_select_required: 'Você deve selecionar um idioma para continuar',

    // Form page
    form_title: 'Declaração de Ausência de Conflito de Interesses',
    form_subtitle_prefilled: 'Verifique se as seguintes informações estão corretas',
    form_subtitle_empty: 'Preencha as seguintes informações para gerar sua declaração',
    form_provider_id: 'ID do Fornecedor',
    form_prefilled_notice: 'Dados Pré-preenchidos',
    form_prefilled_msg: 'Os dados foram pré-preenchidos pela EFFICENTA. Se encontrar algum erro, clique em "Dados incorretos" para nos contatar.',
    form_company_name: 'Nome do Fornecedor ou Razão Social',
    form_company_placeholder: 'Ex: Empresa ABC Ltda.',
    form_legal_rep: 'Nome do Representante Legal',
    form_legal_rep_placeholder: 'Ex: João Silva',
    form_email: 'Endereço de E-mail',
    form_email_placeholder: 'Ex: contato@empresa.com',
    form_submit: 'Gerar Documento',
    form_back_btn: 'Voltar para EFFICENTA',
    form_required: '*',

    // Signature page
    sign_title: 'Declaração de Ausência de Conflito de Interesses',
    sign_provider: 'Fornecedor',
    sign_legal_rep: 'Representante Legal',
    sign_review_doc: '1. Revise o documento',
    sign_section_title: '2. Assine eletronicamente',
    sign_instructions: 'Desenhe sua assinatura na caixa (use seu dedo no celular ou mouse no computador):',
    sign_checkbox: 'Declaro sob pena de perjúrio que não tenho conflito de interesses com a EFFICENTA, e autorizo o uso da minha assinatura eletrônica manuscrita.',
    sign_clear_btn: 'Limpar assinatura',
    sign_submit_btn: 'Assinar Declaração',
    sign_no_signature: 'Por favor desenhe sua assinatura antes de continuar.',
    sign_too_small: 'A assinatura é muito pequena. Por favor desenhe uma assinatura mais completa e legível.',
    sign_authorized_note: 'Indique o nome completo da pessoa autorizada a assinar legalmente em nome da sua empresa.',

    // Success page
    success_title: 'Declaração Assinada com Sucesso!',
    success_message: 'Sua declaração de ausência de conflito de interesses foi registrada.',
    success_download: 'Baixar Documento Assinado',
    success_provider: 'Fornecedor',
    success_legal_rep: 'Representante Legal',
    success_date: 'Data da assinatura',

    // Errors
    error_invalid_link: 'Link inválido',
    error_no_uid: 'O link não contém o identificador do fornecedor (uid).',
    error_contact: 'Por favor entre em contato com a EFFICENTA para obter o link correto.',
    error_already_signed: 'Declaração já assinada',
    error_already_signed_msg: 'A declaração para este fornecedor já foi completada e assinada.',
    error_sign_date: 'Data da assinatura',
    error_link_invalid: 'Link inválido',
    error_link_expired: 'O link de assinatura não existe ou expirou.',
    error_doc_not_found: 'Documento não encontrado.',
    error_generic: 'Erro',
    error_accept_required: 'Você deve aceitar a declaração para continuar.',
    error_no_signature: 'Nenhuma assinatura válida recebida.',
    error_already_signed_simple: 'Esta declaração já foi assinada',
  },
};

// Helper function to get translation
function t(lang: SupportedLanguage, key: string): string {
  return translations[lang]?.[key] || translations['es'][key] || key;
}

// Get template path by language
function getTemplatePath(lang: SupportedLanguage): string {
  const templateFiles: Record<SupportedLanguage, string> = {
    es: 'declaracion-conflicto-es.docx',
    en: 'declaracion-conflicto-en.docx',
    pt: 'declaracion-conflicto-pt.docx',
  };
  return path.join(__dirname, '..', 'templates', templateFiles[lang]);
}

// Get locale for date formatting
function getLocale(lang: SupportedLanguage): string {
  const locales: Record<SupportedLanguage, string> = {
    es: 'es-MX',
    en: 'en-US',
    pt: 'pt-BR',
  };
  return locales[lang];
}

// ============================================================================

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
  status: 'pending_language' | 'pending_form' | 'pending_signature' | 'signed';
  language?: SupportedLanguage; // Idioma seleccionado por el usuario
  proveedorData?: ProveedorData;
  expectedProveedorData?: ProveedorData; // Datos esperados para validación (enviados por EFFICENTA)
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
// Muestra página de selección de idioma (primer paso)
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
          <p>Por favor contacte a EFFICENTA para obtener el enlace correcto.</p>
        </body>
        </html>
      `);
      return;
    }

    ensureDirs();

    // Leer parámetros del URL (si EFFICENTA los envió)
    const nombreFromUrl = req.query.nombre_proveedor_razon_social as string || req.query.nombre as string;
    const representanteFromUrl = req.query.nombre_representante_legal as string || req.query.representante as string;
    const emailFromUrl = req.query.email as string;

    // Verificar si ya existe un registro
    let record = await loadRecordAsync(uid);

    if (record && record.status === 'signed') {
      const lang = record.language || 'es';
      res.send(`
        <!DOCTYPE html>
        <html lang="${lang}">
        <head><meta charset="UTF-8"><title>${t(lang, 'error_already_signed')}</title></head>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1>✅ ${t(lang, 'error_already_signed')}</h1>
          <p>${t(lang, 'error_already_signed_msg')}</p>
          <p>${t(lang, 'error_sign_date')}: ${record.signedAt ? new Date(record.signedAt).toLocaleDateString(getLocale(lang)) : 'N/A'}</p>
        </body>
        </html>
      `);
      return;
    }

    // Si ya tiene idioma seleccionado y está pendiente de formulario, redirigir
    if (record && record.status === 'pending_form' && record.language) {
      res.redirect(`/declaracion/formulario?uid=${encodeURIComponent(uid)}`);
      return;
    }

    // Si ya tiene datos y está pendiente de firma, redirigir
    if (record && record.status === 'pending_signature' && record.token) {
      res.redirect(`/declaracion/firmar/${record.token}`);
      return;
    }

    // Si vienen datos en el URL y NO hay registro, crear uno con esos datos
    if (!record && nombreFromUrl && representanteFromUrl && emailFromUrl) {
      const token = randomUUID();
      const expectedProveedorData: ProveedorData = {
        nombre_proveedor_razon_social: nombreFromUrl.trim(),
        nombre_representante_legal: representanteFromUrl.trim(),
        email: emailFromUrl.trim(),
      };

      record = {
        uid,
        token,
        status: 'pending_language',
        createdAt: new Date().toISOString(),
        expectedProveedorData,
      };

      saveRecord(record);

      // Persistir en GitHub si está habilitado
      if (isGitHubStorageEnabled()) {
        try {
          const gitResult = await saveDeclaracionToGitHub(record.uid, {
            uid: record.uid,
            status: record.status,
            proveedor: null,
            expectedProveedor: expectedProveedorData,
            signedAt: null,
            signedPdfUrl: null,
            signatureMetadata: null,
            documentHash: null,
          });
          if (gitResult.success) {
            console.log(`✅ Declaración ${record.uid} guardada desde URL params en GitHub`);
          }
        } catch (gitErr) {
          console.warn('⚠️ Error al guardar en GitHub:', gitErr);
        }
      }
    } else if (!record) {
      // Crear registro nuevo sin datos esperados
      const token = randomUUID();
      record = {
        uid,
        token,
        status: 'pending_language',
        createdAt: new Date().toISOString(),
      };
      saveRecord(record);
    }

    // Mostrar página de selección de idioma
    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Seleccione su idioma / Select your language</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      margin: 0;
      padding: 16px;
      background: #f5f5f5;
    }
    .container {
      max-width: 500px;
      margin: 0 auto;
      background: #fff;
      padding: 32px;
      border-radius: 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }
    .logo-container {
      text-align: center;
      margin-bottom: 32px;
      padding-bottom: 24px;
      border-bottom: 1px solid #e5e7eb;
    }
    .logo-container img {
      max-width: 180px;
      height: auto;
    }
    h1 {
      font-size: 24px;
      color: #1e40af;
      margin-bottom: 8px;
      text-align: center;
    }
    .subtitle {
      color: #6b7280;
      text-align: center;
      margin-bottom: 32px;
      font-size: 14px;
    }
    .language-options {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .language-option {
      display: flex;
      align-items: center;
      padding: 16px 20px;
      border: 2px solid #e5e7eb;
      border-radius: 10px;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .language-option:hover {
      border-color: #2563eb;
      background: #eff6ff;
    }
    .language-option.selected {
      border-color: #2563eb;
      background: #eff6ff;
    }
    .language-option input[type="radio"] {
      margin-right: 16px;
      width: 20px;
      height: 20px;
      accent-color: #2563eb;
    }
    .language-info {
      flex: 1;
    }
    .language-name {
      font-size: 18px;
      font-weight: 600;
      color: #1f2937;
    }
    .language-native {
      font-size: 14px;
      color: #6b7280;
      margin-top: 2px;
    }
    .flag {
      font-size: 32px;
      margin-left: 12px;
    }
    button {
      margin-top: 32px;
      width: 100%;
      padding: 14px;
      background: #2563eb;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:hover {
      background: #1d4ed8;
    }
    button:disabled {
      background: #9ca3af;
      cursor: not-allowed;
    }
    .info-box {
      background: #f0fdf4;
      border: 1px solid #86efac;
      padding: 12px 16px;
      border-radius: 8px;
      margin-top: 24px;
      font-size: 13px;
      color: #166534;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo-container">
      <img src="https://raw.githubusercontent.com/jovahernandez/ugc-contracts-dev/main/src/assets/another-logo.svg" alt="Another">
    </div>

    <h1>🌐 Seleccione su idioma</h1>
    <p class="subtitle">Please select the language in which you want to view the document<br>Por favor seleccione el idioma en el que desea ver el documento</p>

    <form action="/declaracion/seleccionar-idioma" method="POST" id="language-form">
      <input type="hidden" name="uid" value="${uid}">

      <div class="language-options">
        <label class="language-option" for="lang-es">
          <input type="radio" name="language" id="lang-es" value="es" required>
          <div class="language-info">
            <div class="language-name">Español</div>
            <div class="language-native">Spanish</div>
          </div>
          <span class="flag">🇲🇽</span>
        </label>

        <label class="language-option" for="lang-en">
          <input type="radio" name="language" id="lang-en" value="en">
          <div class="language-info">
            <div class="language-name">English</div>
            <div class="language-native">Inglés</div>
          </div>
          <span class="flag">🇺🇸</span>
        </label>

        <label class="language-option" for="lang-pt">
          <input type="radio" name="language" id="lang-pt" value="pt">
          <div class="language-info">
            <div class="language-name">Português</div>
            <div class="language-native">Portuguese</div>
          </div>
          <span class="flag">🇧🇷</span>
        </label>
      </div>

      <button type="submit" id="continue-btn">Continuar / Continue →</button>
    </form>

    <div class="info-box">
      <strong>ID:</strong> ${uid}
    </div>
  </div>

  <script>
    const form = document.getElementById('language-form');
    const options = document.querySelectorAll('.language-option');

    options.forEach(option => {
      option.addEventListener('click', function() {
        options.forEach(o => o.classList.remove('selected'));
        this.classList.add('selected');
      });
    });

    form.addEventListener('submit', function(e) {
      const selected = document.querySelector('input[name="language"]:checked');
      if (!selected) {
        e.preventDefault();
        alert('Please select a language / Por favor seleccione un idioma');
      }
    });
  </script>
</body>
</html>`;

    res.status(200).send(html);
  } catch (err: any) {
    console.error('Error en GET /declaracion:', err);
    res.status(500).send('<h1>Error</h1><p>No fue posible cargar la página.</p>');
  }
});

// ---------------------------------------------------------------------------
// POST /declaracion/seleccionar-idioma
// Guarda el idioma seleccionado y redirige al formulario
// ---------------------------------------------------------------------------
router.post('/seleccionar-idioma', async (req: Request, res: Response): Promise<void> => {
  try {
    const { uid, language } = req.body;

    if (!uid || !language) {
      res.status(400).send('<h1>Error</h1><p>UID e idioma son requeridos.</p>');
      return;
    }

    const validLanguages: SupportedLanguage[] = ['es', 'en', 'pt'];
    if (!validLanguages.includes(language)) {
      res.status(400).send('<h1>Error</h1><p>Idioma no válido.</p>');
      return;
    }

    let record = await loadRecordAsync(uid);

    if (!record) {
      res.status(404).send('<h1>Error</h1><p>Registro no encontrado.</p>');
      return;
    }

    // Actualizar registro con idioma
    record.language = language as SupportedLanguage;
    record.status = 'pending_form';
    saveRecord(record);

    // Persistir en GitHub
    if (isGitHubStorageEnabled()) {
      try {
        await saveDeclaracionToGitHub(record.uid, {
          uid: record.uid,
          status: record.status,
          language: record.language,
          proveedor: record.proveedorData || null,
          expectedProveedor: record.expectedProveedorData || null,
          signedAt: null,
          signedPdfUrl: null,
          signatureMetadata: null,
          documentHash: null,
        });
      } catch (gitErr) {
        console.warn('⚠️ Error al guardar en GitHub:', gitErr);
      }
    }

    res.redirect(`/declaracion/formulario?uid=${encodeURIComponent(uid)}`);
  } catch (err: any) {
    console.error('Error en POST /declaracion/seleccionar-idioma:', err);
    res.status(500).send('<h1>Error</h1><p>No fue posible procesar la selección.</p>');
  }
});

// ---------------------------------------------------------------------------
// GET /declaracion/formulario?uid=XXX
// Muestra formulario en el idioma seleccionado
// ---------------------------------------------------------------------------
router.get('/formulario', async (req: Request, res: Response): Promise<void> => {
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
        </body>
        </html>
      `);
      return;
    }

    ensureDirs();

    let record = await loadRecordAsync(uid);

    if (!record) {
      res.redirect(`/declaracion?uid=${encodeURIComponent(uid)}`);
      return;
    }

    // Si no tiene idioma, redirigir a selección
    if (!record.language) {
      res.redirect(`/declaracion?uid=${encodeURIComponent(uid)}`);
      return;
    }

    const lang = record.language;

    if (record.status === 'signed') {
      res.send(`
        <!DOCTYPE html>
        <html lang="${lang}">
        <head><meta charset="UTF-8"><title>${t(lang, 'error_already_signed')}</title></head>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1>✅ ${t(lang, 'error_already_signed')}</h1>
          <p>${t(lang, 'error_already_signed_msg')}</p>
          <p>${t(lang, 'error_sign_date')}: ${record.signedAt ? new Date(record.signedAt).toLocaleDateString(getLocale(lang)) : 'N/A'}</p>
        </body>
        </html>
      `);
      return;
    }

    if (record.status === 'pending_signature' && record.token) {
      res.redirect(`/declaracion/firmar/${record.token}`);
      return;
    }

    // Preparar datos pre-llenados
    let hasExpectedData = false;
    let nombreValue = '';
    let representanteValue = '';
    let emailValue = '';

    if (record?.expectedProveedorData) {
      hasExpectedData = true;
      nombreValue = record.expectedProveedorData.nombre_proveedor_razon_social;
      representanteValue = record.expectedProveedorData.nombre_representante_legal;
      emailValue = record.expectedProveedorData.email;
    }

    const isReadonly = hasExpectedData;

    // Mostrar formulario en el idioma seleccionado
    const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${t(lang, 'form_title')}</title>
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
    input:read-only {
      background: #f9fafb;
      border-color: #e5e7eb;
      cursor: not-allowed;
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
    button:disabled {
      background: #9ca3af;
      cursor: not-allowed;
    }
    .btn-error {
      background: #dc2626;
      margin-top: 12px;
    }
    .btn-error:hover {
      background: #b91c1c;
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
    .warning {
      background: #fef3c7;
      border: 1px solid #fde68a;
      padding: 12px;
      border-radius: 6px;
      margin-bottom: 16px;
      font-size: 13px;
      color: #92400e;
    }
    .note {
      background: #f0fdf4;
      border: 1px solid #86efac;
      padding: 12px;
      border-radius: 6px;
      margin-top: 16px;
      font-size: 13px;
      color: #166534;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo-container">
      <img src="https://raw.githubusercontent.com/jovahernandez/ugc-contracts-dev/main/src/assets/another-logo.svg" alt="Another">
    </div>

    <h1>📋 ${t(lang, 'form_title')}</h1>
    <p class="subtitle">${hasExpectedData ? t(lang, 'form_subtitle_prefilled') : t(lang, 'form_subtitle_empty')}</p>

    <div class="info">
      <strong>${t(lang, 'form_provider_id')}:</strong> ${uid}
    </div>

    ${hasExpectedData ? `
    <div class="warning" id="readonly-notice">
      <strong>ℹ️ ${t(lang, 'form_prefilled_notice')}</strong><br>
      ${t(lang, 'form_prefilled_msg')}
    </div>
    ` : ''}

    <form action="/declaracion/generar" method="POST" id="declaracion-form">
      <input type="hidden" name="uid" value="${uid}">
      <input type="hidden" name="language" value="${lang}">

      <label for="nombre_proveedor_razon_social">${t(lang, 'form_company_name')} ${t(lang, 'form_required')}</label>
      <input
        type="text"
        id="nombre_proveedor_razon_social"
        name="nombre_proveedor_razon_social"
        value="${nombreValue}"
        ${isReadonly ? 'readonly' : ''}
        required
        placeholder="${t(lang, 'form_company_placeholder')}">

      <label for="nombre_representante_legal">${t(lang, 'form_legal_rep')} ${t(lang, 'form_required')}</label>
      <input
        type="text"
        id="nombre_representante_legal"
        name="nombre_representante_legal"
        value="${representanteValue}"
        ${isReadonly ? 'readonly' : ''}
        required
        placeholder="${t(lang, 'form_legal_rep_placeholder')}">

      <label for="email">${t(lang, 'form_email')} ${t(lang, 'form_required')}</label>
      <input
        type="email"
        id="email"
        name="email"
        value="${emailValue}"
        ${isReadonly ? 'readonly' : ''}
        required
        placeholder="${t(lang, 'form_email_placeholder')}">

      <div class="note">
        <strong>📝</strong> ${t(lang, 'sign_authorized_note')}
      </div>

      <button type="submit">${t(lang, 'form_submit')} →</button>

      ${hasExpectedData ? `
      <button type="button" class="btn-error" id="unlock-btn">${t(lang, 'form_back_btn')}</button>
      ` : ''}
    </form>
  </div>

  ${hasExpectedData ? `
  <script>
    const unlockBtn = document.getElementById('unlock-btn');

    unlockBtn.addEventListener('click', function() {
      alert('${lang === 'es' ? 'Te redirigiremos a EFFICENTA para corroborar tus datos, gracias' : lang === 'en' ? 'We will redirect you to EFFICENTA to verify your data, thank you' : 'Vamos redirecioná-lo para EFFICENTA para verificar seus dados, obrigado'}');
      window.close();
      setTimeout(function() {
        window.history.back();
      }, 500);
    });
  </script>
  ` : ''}
</body>
</html>`;

    res.status(200).send(html);
  } catch (err: any) {
    console.error('Error en GET /declaracion/formulario:', err);
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
      language,
      nombre_proveedor_razon_social,
      nombre_representante_legal,
      email,
    } = req.body;

    if (!uid || !nombre_proveedor_razon_social || !nombre_representante_legal || !email) {
      res.status(400).send('<h1>Error</h1><p>Todos los campos son obligatorios.</p>');
      return;
    }

    ensureDirs();

    // Obtener idioma del registro o del formulario
    let existingRecord = await loadRecordAsync(uid);
    const lang: SupportedLanguage = (language as SupportedLanguage) || existingRecord?.language || 'es';

    const proveedorData: ProveedorData = {
      nombre_proveedor_razon_social,
      nombre_representante_legal,
      email,
    };

    // Cargar template según idioma
    const templatePath = getTemplatePath(lang);
    if (!fs.existsSync(templatePath)) {
      // Fallback al template español si no existe el del idioma
      const fallbackPath = path.join(__dirname, '..', 'templates', 'declaracion-conflicto.docx');
      if (!fs.existsSync(fallbackPath)) {
        res.status(500).send(`<h1>${t(lang, 'error_generic')}</h1><p>Template de declaración no encontrado.</p>`);
        return;
      }
    }

    const templateContent = fs.readFileSync(templatePath, 'binary');
    const zip = new PizZip(templateContent);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
    });

    // Renderizar con datos (sin firma aún)
    // Los campos pueden variar según el idioma del template
    doc.render({
      // Español
      nombre_proveedor_razon_social,
      nombre_representante_legal,
      email,
      domicilio: '',
      telefono: '',
      fecha_de_la_firma: '',
      // English (campos alternativos para templates en inglés)
      supplier_name: nombre_proveedor_razon_social,
      legal_representative: nombre_representante_legal,
      signature_date: '',
      // Português (campos alternativos para templates en portugués)
      nome_fornecedor: nombre_proveedor_razon_social,
      representante_legal: nombre_representante_legal,
      data_assinatura: '',
    });

    const docxBuffer = doc.getZip().generate({ type: 'nodebuffer' });
    const docxFileName = `declaracion_${uid}.docx`;
    const docxPath = path.join(declaracionesDir, docxFileName);
    fs.writeFileSync(docxPath, docxBuffer);

    // Generar hash del documento
    const documentHash = generateDocumentHash(docxBuffer);

    // Crear token para firma
    const token = existingRecord?.token || randomUUID();

    // Guardar registro
    const record: DeclaracionRecord = {
      uid,
      token,
      status: 'pending_signature',
      language: lang,
      proveedorData,
      expectedProveedorData: existingRecord?.expectedProveedorData,
      docxPath,
      documentHash,
      createdAt: existingRecord?.createdAt || new Date().toISOString(),
    };
    saveRecord(record);

    // ✅ Persistir en GitHub inmediatamente (evita pérdida de datos en restart)
    if (isGitHubStorageEnabled()) {
      try {
        const gitResult = await saveDeclaracionToGitHub(record.uid, {
          uid: record.uid,
          status: record.status,
          language: record.language,
          proveedor: record.proveedorData || record.expectedProveedorData,
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

    const lang = record.language || 'es';

    if (record.status === 'signed') {
      res.send(`
        <!DOCTYPE html>
        <html lang="${lang}">
        <head><meta charset="UTF-8"><title>${t(lang, 'error_already_signed')}</title></head>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1>✅ ${t(lang, 'error_already_signed')}</h1>
          <p>${t(lang, 'error_already_signed_simple')} ${record.signedAt ? new Date(record.signedAt).toLocaleDateString(getLocale(lang)) : 'N/A'}.</p>
        </body>
        </html>
      `);
      return;
    }

    if (!record.docxPath || !fs.existsSync(record.docxPath)) {
      res.status(404).send(`<h1>${t(lang, 'error_generic')}</h1><p>${t(lang, 'error_doc_not_found')}</p>`);
      return;
    }

    let documentHtml = await convertDocxToHtml(record.docxPath);
    // Limpiar líneas de Domicilio y Teléfono vacíos (multi-idioma)
    documentHtml = documentHtml
      .replace(/<p[^>]*>\s*Domicilio:\s*<\/p>/gi, '')
      .replace(/<p[^>]*>\s*Tel[ée]fono:\s*<\/p>/gi, '')
      .replace(/Domicilio:\s*(<br\s*\/?>|\n|\r|<\/p>)/gi, '')
      .replace(/Tel[ée]fono:\s*(<br\s*\/?>|\n|\r|<\/p>)/gi, '')
      .replace(/<p[^>]*>\s*Address:\s*<\/p>/gi, '')
      .replace(/<p[^>]*>\s*Phone:\s*<\/p>/gi, '')
      .replace(/<p[^>]*>\s*Endereço:\s*<\/p>/gi, '')
      .replace(/<p[^>]*>\s*Telefone:\s*<\/p>/gi, '');

    const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${t(lang, 'sign_title')}</title>
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
    .note {
      background: #fef3c7;
      border: 1px solid #fde68a;
      padding: 12px;
      border-radius: 6px;
      margin-top: 16px;
      font-size: 13px;
      color: #92400e;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo-container">
      <img src="https://raw.githubusercontent.com/jovahernandez/ugc-contracts-dev/main/src/assets/another-logo.svg" alt="Another">
    </div>

    <h1>📋 ${t(lang, 'sign_title')}</h1>

    <div class="info-box">
      <strong>${t(lang, 'sign_provider')}:</strong> ${record.proveedorData?.nombre_proveedor_razon_social || 'N/A'}<br>
      <strong>${t(lang, 'sign_legal_rep')}:</strong> ${record.proveedorData?.nombre_representante_legal || 'N/A'}
    </div>

    <h2>${t(lang, 'sign_review_doc')}</h2>
    <div class="document-preview">
      ${documentHtml}
    </div>

    <div class="signature-section">
      <h2>${t(lang, 'sign_section_title')}</h2>
      <form method="POST">
        <p>${t(lang, 'sign_instructions')}</p>
        <canvas id="signatureCanvas" width="600" height="200"></canvas>

        <div class="note">
          <strong>📝</strong> ${t(lang, 'sign_authorized_note')}
        </div>

        <div class="checkbox-row">
          <input type="checkbox" id="accepted" name="accepted" value="yes" required>
          <label for="accepted">
            ${t(lang, 'sign_checkbox')}
          </label>
        </div>

        <div class="actions">
          <button type="button" class="secondary" id="clearBtn">${t(lang, 'sign_clear_btn')}</button>
          <button type="submit" class="primary">✍️ ${t(lang, 'sign_submit_btn')}</button>
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

    // Mínimo de píxeles requeridos para una firma válida (aprox. 500 = una firma básica)
    var MIN_SIGNATURE_PIXELS = 500;

    document.querySelector('form').addEventListener('submit', function(e) {
      if (!hasDrawing) {
        e.preventDefault();
        alert('${t(lang, 'sign_no_signature').replace(/'/g, "\\'")}');
        return;
      }

      var pixelCount = getSignaturePixelCount();
      if (pixelCount < MIN_SIGNATURE_PIXELS) {
        e.preventDefault();
        alert('${t(lang, 'sign_too_small').replace(/'/g, "\\'")}');
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

    const lang = record.language || 'es';

    if (record.status === 'signed') {
      res.status(400).send(`<h1>${t(lang, 'error_already_signed_simple')}</h1>`);
      return;
    }

    if (accepted !== 'yes') {
      res.status(400).send(`<h1>${t(lang, 'error_generic')}</h1><p>${t(lang, 'error_accept_required')}</p>`);
      return;
    }

    if (!signatureData || !signatureData.startsWith('data:image/')) {
      res.status(400).send(`<h1>${t(lang, 'error_generic')}</h1><p>${t(lang, 'error_no_signature')}</p>`);
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

    const fechaFirma = localSignedAt.toLocaleDateString(getLocale(lang), {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });

    // Regenerar DOCX con firma usando template del idioma seleccionado
    const templatePath = getTemplatePath(lang);
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

    // Convertir DOCX a PDF usando CloudConvert (con Puppeteer como fallback)
    let finalFilePath = signedDocxPath;
    let conversionMethod = 'none';

    try {
      console.log(`[PDF] Convirtiendo DOCX a PDF para ${record.uid}...`);

      // Intentar primero con CloudConvert (más confiable)
      const cloudConvertApiKey = process.env.CLOUDCONVERT_API_KEY;
      if (cloudConvertApiKey) {
        try {
          console.log(`[PDF] Intentando conversión con CloudConvert...`);
          const pdfPath = await convertDocxToPdfWithCloudConvert(signedDocxPath, signedDir);
          finalFilePath = pdfPath;
          conversionMethod = 'cloudconvert';
          console.log(`[PDF] ✅ Conversión exitosa con CloudConvert: ${pdfPath}`);
        } catch (cloudConvertErr: any) {
          console.error(`[PDF] ⚠️ CloudConvert falló: ${cloudConvertErr.message}`);
          console.log(`[PDF] Intentando con Puppeteer como fallback...`);

          // Fallback a Puppeteer si CloudConvert falla
          const pdfPath = await convertDocxToPdf(signedDocxPath, signedDir);
          finalFilePath = pdfPath;
          conversionMethod = 'puppeteer';
          console.log(`[PDF] ✅ Conversión exitosa con Puppeteer (fallback): ${pdfPath}`);
        }
      } else {
        // Si no hay CloudConvert configurado, usar Puppeteer directamente
        console.log(`[PDF] CloudConvert no configurado, usando Puppeteer...`);
        const pdfPath = await convertDocxToPdf(signedDocxPath, signedDir);
        finalFilePath = pdfPath;
        conversionMethod = 'puppeteer';
        console.log(`[PDF] ✅ Conversión exitosa con Puppeteer: ${pdfPath}`);
      }
    } catch (pdfErr: any) {
      console.error(`[PDF] ⚠️ Error en todas las conversiones, usando DOCX: ${pdfErr.message}`);
      conversionMethod = 'failed';
      // Si falla todo, continuamos con DOCX (fallback final)
    }

    console.log(`[PDF] Método de conversión usado: ${conversionMethod}`);

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
          proveedor: record.proveedorData || record.expectedProveedorData,
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
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${t(lang, 'success_title')}</title>
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
    <h1>${t(lang, 'success_title')}</h1>
    <p>${t(lang, 'success_message')}</p>

    <a href="${dataUrl}" class="download-btn" download="${downloadFileName}">📄 ${t(lang, 'success_download')}</a>

    <div class="info">
      <p><strong>${t(lang, 'success_provider')}:</strong> ${record.proveedorData?.nombre_proveedor_razon_social}</p>
      <p><strong>${t(lang, 'success_legal_rep')}:</strong> ${record.proveedorData?.nombre_representante_legal}</p>
      <p><strong>${t(lang, 'success_date')}:</strong> ${fechaFirma}</p>
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
        const provData = record.proveedorData || record.expectedProveedorData;
        return {
          uid: record.uid,
          status: record.status,
          proveedor: provData?.nombre_proveedor_razon_social || null,
          representante_legal: provData?.nombre_representante_legal || null,
          email: provData?.email || null,
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

    const provData = record.proveedorData || record.expectedProveedorData;
    res.json({
      uid: record.uid,
      status: record.status,
      proveedor: provData?.nombre_proveedor_razon_social || null,
      representante_legal: provData?.nombre_representante_legal || null,
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
    const {
      uid,
      api_key,
      nombre_proveedor_razon_social,
      nombre_representante_legal,
      email,
    } = req.body || {};

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

    // Preparar datos esperados del proveedor (si fueron enviados)
    const expectedProveedorData = (nombre_proveedor_razon_social && nombre_representante_legal && email) ? {
      nombre_proveedor_razon_social: nombre_proveedor_razon_social.trim(),
      nombre_representante_legal: nombre_representante_legal.trim(),
      email: email.trim(),
    } : undefined;

    // Crear nuevo registro
    const token = randomUUID();
    const now = new Date();

    record = {
      uid: cleanUid,
      token,
      status: 'pending_form',
      createdAt: now.toISOString(),
      expectedProveedorData, // ✅ Guardar datos esperados para validación
    };

    saveRecord(record);

    // ✅ Persistir en GitHub inmediatamente (evita pérdida de datos en restart)
    if (isGitHubStorageEnabled()) {
      try {
        const gitResult = await saveDeclaracionToGitHub(record.uid, {
          uid: record.uid,
          status: record.status,
          proveedor: null, // Aún no tiene datos del proveedor
          expectedProveedor: expectedProveedorData || null, // Datos esperados para validación
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

// ---------------------------------------------------------------------------
// DELETE /declaracion/webhook/delete
// Borra un registro específico (requiere autenticación)
// ---------------------------------------------------------------------------
router.delete('/webhook/delete', async (req: Request, res: Response): Promise<void> => {
  try {
    const { uid, api_key } = req.body;

    // Validar API key
    const expectedApiKey = process.env.EFICENTA_API_KEY || 'eficenta-secret-key';
    if (api_key !== expectedApiKey) {
      res.status(401).json({
        success: false,
        error: 'API key inválida',
      });
      return;
    }

    // Validar UID
    if (!uid) {
      res.status(400).json({
        success: false,
        error: 'UID es requerido',
      });
      return;
    }

    const cleanUid = uid.trim();
    const recordPath = getRecordPath(cleanUid);

    // IMPORTANTE: NO usar loadRecordAsync porque re-crea el archivo desde GitHub
    // En su lugar, intentar leer directamente desde el sistema de archivos local
    let record: DeclaracionRecord | null = null;

    if (fs.existsSync(recordPath)) {
      try {
        record = JSON.parse(fs.readFileSync(recordPath, 'utf-8'));
      } catch (err) {
        console.warn(`[DELETE] No se pudo leer ${recordPath}:`, err);
      }
    }

    // Borrar archivos locales asociados si existen
    const filesToDelete: string[] = [];

    if (fs.existsSync(recordPath)) {
      filesToDelete.push(recordPath);
      fs.unlinkSync(recordPath);
      console.log(`[DELETE] Archivo local borrado: ${recordPath}`);
    }

    if (record?.docxPath && fs.existsSync(record.docxPath)) {
      filesToDelete.push(record.docxPath);
      fs.unlinkSync(record.docxPath);
      console.log(`[DELETE] DOCX borrado: ${record.docxPath}`);
    }
    if (record?.signedPdfPath && fs.existsSync(record.signedPdfPath)) {
      filesToDelete.push(record.signedPdfPath);
      fs.unlinkSync(record.signedPdfPath);
      console.log(`[DELETE] PDF borrado: ${record.signedPdfPath}`);
    }
    if (record?.signatureImagePath && fs.existsSync(record.signatureImagePath)) {
      filesToDelete.push(record.signatureImagePath);
      fs.unlinkSync(record.signatureImagePath);
      console.log(`[DELETE] Firma borrada: ${record.signatureImagePath}`);
    }

    // Borrar de GitHub si está configurado
    let githubDeleted = false;
    if (isGitHubStorageEnabled()) {
      try {
        const githubToken = process.env.GITHUB_TOKEN;
        const owner = process.env.GITHUB_OWNER || 'another-company';
        const repo = process.env.GITHUB_REPO || 'another-ugc-contracts';
        const branch = process.env.GITHUB_BRANCH || 'main';

        // Intentar borrar archivo por UID (formato nuevo)
        const filePathByUid = `data/declaraciones/by-uid/${cleanUid}.json`;
        const urlByUid = `https://api.github.com/repos/${owner}/${repo}/contents/${filePathByUid}`;

        // Obtener SHA del archivo
        const getResponse = await fetch(urlByUid, {
          headers: {
            'Authorization': `Bearer ${githubToken}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'another-ugc-contracts',
          },
        });

        if (getResponse.ok) {
          const fileData = await getResponse.json();

          // Borrar el archivo
          const deleteResponse = await fetch(urlByUid, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${githubToken}`,
              'Accept': 'application/vnd.github.v3+json',
              'User-Agent': 'another-ugc-contracts',
            },
            body: JSON.stringify({
              message: `🗑️ DELETE: Registro ${cleanUid}`,
              sha: fileData.sha,
              branch,
            }),
          });

          if (deleteResponse.ok) {
            console.log(`✅ [GitHub] Archivo borrado: ${filePathByUid}`);
            githubDeleted = true;
          }
        }

        // Intentar borrar archivo legacy (formato YYYY-MM-DD_UID.json)
        const listUrl = `https://api.github.com/repos/${owner}/${repo}/contents/data/declaraciones?ref=${branch}`;
        const listResponse = await fetch(listUrl, {
          headers: {
            'Authorization': `Bearer ${githubToken}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'another-ugc-contracts',
          },
        });

        if (listResponse.ok) {
          const files = await listResponse.json();
          const legacyFile = files.find((f: any) =>
            f.name.endsWith(`_${cleanUid}.json`) && f.type === 'file'
          );

          if (legacyFile) {
            const legacyPath = `data/declaraciones/${legacyFile.name}`;
            const legacyUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${legacyPath}`;

            const deleteLegacyResponse = await fetch(legacyUrl, {
              method: 'DELETE',
              headers: {
                'Authorization': `Bearer ${githubToken}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'another-ugc-contracts',
              },
              body: JSON.stringify({
                message: `🗑️ DELETE: Registro legacy ${cleanUid}`,
                sha: legacyFile.sha,
                branch,
              }),
            });

            if (deleteLegacyResponse.ok) {
              console.log(`✅ [GitHub] Archivo legacy borrado: ${legacyPath}`);
              githubDeleted = true;
            }
          }
        }
      } catch (err) {
        console.error('[GitHub] Error borrando de GitHub:', err);
      }
    }

    console.log(`[DELETE] Registro ${cleanUid} borrado exitosamente (local + GitHub)`);

    res.json({
      success: true,
      message: `Registro ${cleanUid} borrado exitosamente`,
      deletedFilesLocal: filesToDelete.length,
      deletedFromGitHub: githubDeleted,
    });

  } catch (err: any) {
    console.error('Error en DELETE /declaracion/webhook/delete:', err);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor',
    });
  }
});

// ---------------------------------------------------------------------------
// GET /declaracion/debug/:uid
// Debug endpoint para ver de dónde se carga un registro
// ---------------------------------------------------------------------------
router.get('/debug/:uid', async (req: Request, res: Response): Promise<void> => {
  try {
    const uid = req.params.uid;
    const recordPath = getRecordPath(uid);

    // Check local
    const existsLocal = fs.existsSync(recordPath);
    let localContent = null;
    if (existsLocal) {
      localContent = JSON.parse(fs.readFileSync(recordPath, 'utf-8'));
    }

    // Check GitHub config
    const githubEnabled = isGitHubStorageEnabled();
    const githubConfig = {
      token: process.env.GITHUB_TOKEN ? '***' + process.env.GITHUB_TOKEN.slice(-4) : null,
      repo: process.env.GITHUB_REPO || 'another-ugc-contracts',
      owner: process.env.GITHUB_OWNER || 'another-company',
      branch: process.env.GITHUB_BRANCH || 'main',
    };

    // Try to load from GitHub
    let githubRecord = null;
    let githubError = null;
    if (githubEnabled) {
      try {
        githubRecord = await loadDeclaracionFromGitHub(uid);
      } catch (err: any) {
        githubError = err.message;
      }
    }

    // Try loadRecordAsync to see what it returns
    const loadedRecord = await loadRecordAsync(uid);

    res.json({
      uid,
      localFile: {
        path: recordPath,
        exists: existsLocal,
        content: localContent,
      },
      github: {
        enabled: githubEnabled,
        config: githubConfig,
        foundInGitHub: !!githubRecord,
        githubRecord: githubRecord ? { status: githubRecord.status, signedAt: githubRecord.signedAt } : null,
        error: githubError,
      },
      loadRecordAsync: {
        found: !!loadedRecord,
        record: loadedRecord ? { status: loadedRecord.status, signedAt: loadedRecord.signedAt, signedPdfUrl: loadedRecord.signedPdfUrl } : null,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// ---------------------------------------------------------------------------
// GET /declaracion/test-pdf
// Endpoint de test para verificar que Puppeteer funciona
// ---------------------------------------------------------------------------
router.get('/test-pdf', async (req: Request, res: Response): Promise<void> => {
  try {
    const puppeteer = require('puppeteer');
    
    console.log('[TEST] Iniciando test de Puppeteer...');
    console.log('[TEST] Executable path:', process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium');
    
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions',
      ],
      timeout: 30000,
    });
    
    console.log('[TEST] ✅ Navegador lanzado correctamente');
    
    const page = await browser.newPage();
    await page.setContent('<h1>Test PDF</h1><p>Puppeteer funciona correctamente!</p>');
    
    const pdfBuffer = await page.pdf({
      format: 'Letter',
      printBackground: true,
    });
    
    await browser.close();
    
    console.log('[TEST] ✅ PDF generado correctamente');
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="test.pdf"');
    res.send(pdfBuffer);
    
  } catch (err: any) {
    console.error('[TEST] ❌ Error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      stack: err.stack,
    });
  }
});

export default router;
