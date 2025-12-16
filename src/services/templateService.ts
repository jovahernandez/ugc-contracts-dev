// src/services/templateService.ts
import fs from 'fs';
import path from 'path';
import Handlebars from 'handlebars';
import type { HubSpotContact } from '../clients/hubspotClient';
import { montoMxEnLetras } from '../utils/amountToWords';

// Campos que realmente usamos en el contrato
export interface ContractData {
  campana?: string;
  cliente_ugc?: string;
  contract_link?: string;
  contract_name?: string;
  contract_type?: string;
  email?: string;
  dias_de_pago?: string;
  domicilio?: string;
  email_rl?: string;
  exclusividad?: string;
  fecha_de_fin_de_servicio?: string;
  fecha_de_inicio_de_servicio?: string;
  fecha_de_la_firma?: string;
  hashtags?: string;
  hubspot_owner_id?: string;
  job?: string;
  marca_a_promocionar?: string;
  monto_total?: string;
  monto_total_letra?: string;
  nombre_completo?: string;
  rfc?: string;
  razon_social?: string;
  ready_to_generate?: string;
  representante_legal?: string;
  sow__acciones?: string;
  sow__fecha_de_asistencia?: string;
  sow__hora_de_asistencia?: string;
  sow__lugar_de_asistencia?: string;
  tags?: string;
  uso_de_imagen?: string;
  fecha_actual?: string;

  // Solo se usa en el documento FIRMADO
  firma_creador?: string; // ruta al PNG de la firma

}

// (solo para legacy HTML, si aún usas ugc-contract.html)
const templatePath = path.join(
  __dirname,
  '..',
  'templates',
  'ugc-contract.html'
);

let contractTemplate: Handlebars.TemplateDelegate<ContractData> | null = null;
if (fs.existsSync(templatePath)) {
  const templateSource = fs.readFileSync(templatePath, 'utf-8');
  contractTemplate = Handlebars.compile<ContractData>(templateSource);
}

/**
 * dd/mm/yyyy – si no puede parsear, devuelve el valor original.
 */
function formatDateToDDMMYYYY(value?: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/**
 * 123456.7 → "123,456.70"
 */
function formatCurrencyMx(amount?: string | number): string | undefined {
  if (amount === undefined || amount === null || amount === '') return undefined;
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(n)) return undefined;

  return new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/**
 * Construye el objeto que inyectamos en el .docx
 */
export function buildContractDataFromContact(
  contact: HubSpotContact
): ContractData {
  const p = (contact.properties || {}) as any;

  // 1) Email obligatorio
  const email: string | undefined = p.email;
  if (!email) {
    throw new Error('El contacto no tiene correo electrónico (email).');
  }

  // 2) nombre_completo con fallbacks sensatos
  let nombreCompleto: string | undefined = p.nombre_completo;
  const razonSocial: string | undefined = p.razon_social;

  if (!nombreCompleto) {
    const first = (p.firstname as string | undefined) || '';
    const last = (p.lastname as string | undefined) || '';
    const full = `${first} ${last}`.trim();
    if (full) nombreCompleto = full;
  }
  if (!nombreCompleto && razonSocial) {
    nombreCompleto = razonSocial;
  }
  if (!nombreCompleto) {
    nombreCompleto = email;
  }

  // 3) RFC (alias r_f_c_ → rfc)
  const rfcValue: string | undefined = p.r_f_c_ || p.rfc;

  // 4) Email RL (sin fallback a email)
  const emailRepresentante: string | undefined = p.email_rl;

  // 5) SOW – Acciones (alias sow → sow__acciones)
  const sowAcciones: string | undefined = p.sow__acciones || p.sow;

  // 6) Fechas en dd/mm/yyyy
  const fechaInicioServicio = formatDateToDDMMYYYY(
    p.fecha_de_inicio_de_servicio as string | undefined
  );
  const fechaFinServicio = formatDateToDDMMYYYY(
    p.fecha_de_fin_de_servicio as string | undefined
  );
  const fechaFirma = formatDateToDDMMYYYY(
    p.fecha_de_la_firma as string | undefined
  );
  const sowFechaAsistencia = formatDateToDDMMYYYY(
    p.sow__fecha_de_asistencia as string | undefined
  );

  // 7) Monto total: número y letra
  const rawMonto = p.monto_total;
  const montoNumber =
    typeof rawMonto === 'number'
      ? rawMonto
      : rawMonto
      ? Number(rawMonto)
      : 0;

  const montoFormateado =
    montoNumber > 0 ? formatCurrencyMx(montoNumber) : undefined;

  let montoTotalLetra: string | undefined =
    p.monto_total_letra && String(p.monto_total_letra).trim()
      ? String(p.monto_total_letra)
      : undefined;

  if (!montoTotalLetra && montoNumber > 0) {
    // Tu helper ya corregido (sin doble "Y")
    montoTotalLetra = montoMxEnLetras(montoNumber);
  }

  // 8) Fecha actual (para {fecha_actual})
  const now = new Date();
  const ddNow = String(now.getDate()).padStart(2, '0');
  const mmNow = String(now.getMonth() + 1).padStart(2, '0');
  const yyyyNow = now.getFullYear();
  const fechaActual = `${ddNow}/${mmNow}/${yyyyNow}`;

  // 9) Construimos el objeto FINAL (sin undefined, usamos '' cuando falte)
  const data: ContractData = {
    campana: p.campana ?? '',
    cliente_ugc: p.cliente_ugc ?? '',
    contract_link: p.contract_link ?? '',
    contract_name: p.contract_name ?? '',
    contract_type: p.contract_type ?? '',

    email, // correo principal
    dias_de_pago:
      p.dias_de_pago !== undefined && p.dias_de_pago !== null
        ? String(p.dias_de_pago)
        : '',
    domicilio: p.domicilio ?? '',
    email_rl: emailRepresentante ?? '',
    exclusividad: p.exclusividad ?? '',

    fecha_de_fin_de_servicio: fechaFinServicio ?? '',
    fecha_de_inicio_de_servicio: fechaInicioServicio ?? '',
    fecha_de_la_firma: fechaFirma ?? '',

    hashtags: p.hashtags ?? '',
    hubspot_owner_id: p.hubspot_owner_id ?? '',
    job: p.job ?? '',
    marca_a_promocionar: p.marca_a_promocionar ?? '',

    monto_total: montoFormateado ?? '',
    monto_total_letra: montoTotalLetra ?? '',

    nombre_completo: nombreCompleto ?? '',
    rfc: rfcValue ?? '',
    razon_social: razonSocial ?? '',
    ready_to_generate: p.ready_to_generate ?? '',
    representante_legal: p.representante_legal ?? '',

    sow__acciones: sowAcciones ?? '',
    sow__fecha_de_asistencia: sowFechaAsistencia ?? '',
    sow__hora_de_asistencia: p.sow__hora_de_asistencia ?? '',
    sow__lugar_de_asistencia: p.sow__lugar_de_asistencia ?? '',

    tags: p.tags ?? '',
    uso_de_imagen: p.uso_de_imagen ?? '',

    fecha_actual: fechaActual,
  };

  console.log('ContractData generado para contacto', contact.id, data);

  return data;
}

// Solo si aún usas plantilla HTML
export function renderContractHtml(data: ContractData): string {
  if (!contractTemplate) {
    throw new Error('HTML contract template not configured');
  }
  return contractTemplate(data);
}
