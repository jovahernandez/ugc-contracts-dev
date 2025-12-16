// src/clients/hubspotClient.ts
import axios, { AxiosInstance } from 'axios';

export interface HubSpotContact {
  id: string;
  properties: {
    [key: string]: string | null | undefined;
  };
}

const HUBSPOT_PRIVATE_APP_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
const HUBSPOT_BASE_URL =
  process.env.HUBSPOT_BASE_URL || 'https://api.hubapi.com';

if (!HUBSPOT_PRIVATE_APP_TOKEN) {
  console.warn(
    '[HubSpot] HUBSPOT_PRIVATE_APP_TOKEN is not set. HubSpot API calls will fail until you configure it.'
  );
}

export const hubspotApi: AxiosInstance = axios.create({
  baseURL: HUBSPOT_BASE_URL,
  headers: {
    Authorization: `Bearer ${HUBSPOT_PRIVATE_APP_TOKEN}`,
    'Content-Type': 'application/json',
  },
});

// Lista de propiedades que queremos asegurar al leer el contacto
const CONTACT_PROPERTIES = [
  'campana',
  'cliente_ugc',
  'contract_link',
  'contract_name',
  'contract_type',
  'email',
  'dias_de_pago',
  'domicilio',
  'email_rl',
  'exclusividad',
  'fecha_de_fin_de_servicio',
  'fecha_de_inicio_de_servicio',
  'fecha_de_la_firma',
  'hashtags',
  'hubspot_owner_id',
  'job',
  'marca_a_promocionar',
  'monto_total',
  'monto_total_letra',
  'nombre_completo',
  'rfc',
  'razon_social',
  'ready_to_generate',
  'representante_legal',
  'sow__acciones',
  'sow__fecha_de_asistencia',
  'sow__hora_de_asistencia',
  'sow__lugar_de_asistencia',
  'tags',
  'uso_de_imagen',
  // Nuevas relacionadas con firma
  'contract_signed_link',
  'signed',
];

/**
 * Obtiene un contacto por ID desde HubSpot.
 */
export async function getContact(contactId: string): Promise<HubSpotContact> {
  if (!HUBSPOT_PRIVATE_APP_TOKEN) {
    throw new Error(
      'HUBSPOT_PRIVATE_APP_TOKEN is not set. Cannot call HubSpot API.'
    );
  }

  const propsParam = CONTACT_PROPERTIES.join(',');

  const resp = await hubspotApi.get(`/crm/v3/objects/contacts/${contactId}`, {
    params: {
      properties: propsParam,
    },
  });

  const data = resp.data;

  const contact: HubSpotContact = {
    id: data.id,
    properties: data.properties || {},
  };

  return contact;
}

/**
 * Actualiza propiedades de un contacto en HubSpot.
 *
 * @param contactId ID del contacto
 * @param properties Objeto con propiedades a actualizar
 */
export async function updateContactProperties(
  contactId: string,
  properties: Record<string, any>
): Promise<void> {
  if (!HUBSPOT_PRIVATE_APP_TOKEN) {
    throw new Error(
      'HUBSPOT_PRIVATE_APP_TOKEN is not set. Cannot call HubSpot API.'
    );
  }

  console.log('[HubSpot] Updating contact', contactId, 'with properties:', properties);

  const payload = { properties };

  const resp = await hubspotApi.patch(
    `/crm/v3/objects/contacts/${contactId}`,
    payload
  );

  console.log(
    '[HubSpot] Update response status:',
    resp.status,
    'data:',
    resp.data?.id ? `contact ${resp.data.id} updated` : resp.data
  );
}
