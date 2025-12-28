# Configuración de Webhooks de HubSpot

Esta guía explica cómo configurar webhooks en HubSpot para automatizar la generación de contratos cuando un contacto está listo.

## 🎯 Flujo Automatizado

Cuando alguien en HubSpot marca un contacto con `ready_to_generate = true`:

1. **HubSpot** detecta el cambio de propiedad
2. **HubSpot** envía un webhook a tu servidor en Render
3. **Tu servidor**:
   - Genera el contrato DOCX automáticamente
   - Crea el token de firma con expiración de 5 días
   - Guarda el link de firma en HubSpot (`contract_link`)
   - Resetea `ready_to_generate` a `false`
4. **Andrés o tu equipo** copia el link y se lo envía al creador

## 📋 Pasos para Configurar

### 1. Configurar Variables de Entorno en Render

Agrega estas variables en tu proyecto de Render (Dashboard → Environment):

```bash
# URL pública de tu servidor en Render
PUBLIC_BASE_URL=https://ugc-contracts-dev.onrender.com

# Secret para validar webhooks de HubSpot (genera uno único)
HUBSPOT_WEBHOOK_SECRET=tu-secret-super-seguro-aqui-12345

# Días de vigencia del link de firma (opcional, default: 5)
SIGNATURE_EXPIRATION_DAYS=5
```

**Para generar un secret seguro**, ejecuta en tu terminal:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Crear Webhook en HubSpot

#### Opción A: Usando la Interfaz Web de HubSpot

1. **Ve a Settings** (icono de engranaje arriba a la derecha)
2. **Integrations → Private Apps** (o busca "webhooks" en el buscador)
3. **Crea o edita tu Private App** que ya tienes configurada
4. En la pestaña **"Webhooks"**, haz click en **"Subscribe to events"**

#### Opción B: Crear Webhook Programáticamente (Recomendado)

Usa esta llamada a la API de HubSpot para crear el webhook:

```bash
# Reemplaza estos valores:
# - YOUR_HUBSPOT_APP_ID: El ID de tu Private App
# - YOUR_HUBSPOT_DEVELOPER_API_KEY: Tu developer API key
# - https://ugc-contracts-dev.onrender.com: Tu URL de Render

curl -X POST \
  "https://api.hubapi.com/webhooks/v3/YOUR_HUBSPOT_APP_ID/subscriptions" \
  -H "Authorization: Bearer YOUR_HUBSPOT_DEVELOPER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "contact.propertyChange",
    "propertyName": "ready_to_generate",
    "active": true,
    "webhookUrl": "https://ugc-contracts-dev.onrender.com/webhook/hubspot"
  }'
```

**Encontrar tu App ID y Developer Key:**
1. Ve a **Settings → Integrations → Private Apps**
2. Click en tu app
3. El **App ID** está en la URL: `https://app.hubspot.com/developers/YOUR_PORTAL_ID/application/YOUR_APP_ID`
4. La **Developer API Key** está en la pestaña "Auth"

### 3. Configurar el Webhook Secret en HubSpot

Después de crear el webhook, HubSpot te pedirá configurar un **webhook secret**.

1. Copia el mismo secret que pusiste en `HUBSPOT_WEBHOOK_SECRET` en Render
2. Pégalo en la configuración del webhook en HubSpot
3. HubSpot usará este secret para firmar las peticiones

**Importante:** El secret en HubSpot y en Render **DEBEN SER IDÉNTICOS**.

### 4. Verificar que Funciona

#### Prueba 1: Endpoint de Test

Visita en tu navegador:
```
https://ugc-contracts-dev.onrender.com/webhook/test
```

Deberías ver:
```json
{
  "status": "ok",
  "message": "Webhook endpoint is working",
  "config": {
    "hasWebhookSecret": true,
    "signatureExpirationDays": 5
  }
}
```

#### Prueba 2: Webhook Real con HubSpot

1. **Abre un contacto de prueba** en HubSpot (ej: "Fabiola Mercado")
2. **Asegúrate** que el contacto tenga todos los campos necesarios:
   - `email`
   - `nombre_completo`
   - `rfc`
   - `monto_total`
   - `fecha_de_inicio_de_servicio`
   - `fecha_de_fin_de_servicio`
   - `sow__acciones`
   - etc.
3. **Cambia la propiedad** `ready_to_generate` a `true`
4. **Espera unos segundos** (HubSpot puede tardar 1-5 segundos)
5. **Verifica** que:
   - ✅ La propiedad `contract_link` ahora tiene una URL
   - ✅ La propiedad `ready_to_generate` volvió a `false`
   - ✅ El contrato se generó en tu servidor

#### Prueba 3: Verificar el Link de Firma

1. **Copia el link** de `contract_link` en HubSpot
2. **Pégalo en el navegador**
3. **Deberías ver** la página de firma del contrato
4. **Prueba firmarlo** para verificar el flujo completo

## 🔍 Debugging

### Ver logs del webhook en Render

1. Ve a tu dashboard de Render
2. Click en tu servicio
3. Ve a la pestaña **"Logs"**
4. Busca líneas que digan `[Webhook]`

### Webhook no se dispara

Si cambias `ready_to_generate` a `true` y no pasa nada:

1. **Verifica en HubSpot** que el webhook esté activo:
   - Settings → Integrations → Private Apps → Tu App → Webhooks
   - El webhook debe tener un ✅ verde

2. **Verifica la URL** del webhook:
   - Debe ser: `https://ugc-contracts-dev.onrender.com/webhook/hubspot`
   - NO debe tener espacios ni caracteres raros

3. **Verifica el secret**:
   - El `HUBSPOT_WEBHOOK_SECRET` en Render
   - Debe ser EXACTAMENTE igual al secret en HubSpot

4. **Mira los logs de HubSpot**:
   - Settings → Integrations → Private Apps → Tu App → Webhooks
   - Click en el webhook
   - Ve la pestaña **"Recent deliveries"**
   - Ahí verás si HubSpot intentó enviar el webhook y qué respondió tu servidor

### Error "Invalid webhook signature"

Esto significa que el `HUBSPOT_WEBHOOK_SECRET` en Render es diferente al que configuraste en HubSpot.

**Solución:**
1. Genera un nuevo secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. Actualiza `HUBSPOT_WEBHOOK_SECRET` en Render
3. Actualiza el secret en HubSpot (Settings → Webhooks)
4. Espera que Render se reinicie
5. Prueba de nuevo

### Contacto no tiene todos los campos

Si el contacto no tiene `monto_total`, `rfc`, etc., la generación del contrato puede fallar.

**Solución:**
1. Revisa los logs en Render
2. Asegúrate que el contacto tenga todos los campos requeridos
3. Puedes ver qué campos faltan en el error del log

## 🎉 ¡Listo!

Ahora cada vez que alguien marque un contacto como `ready_to_generate = true`:

1. ✅ **Se genera el contrato automáticamente**
2. ✅ **Se crea el link de firma con expiración**
3. ✅ **Se guarda el link en HubSpot**
4. ✅ **Solo tienes que copiarlo y enviárselo al creador**

## 📚 Próximos Pasos (Opcional)

- **Fase 2:** Guardar metadata en Airtable automáticamente cuando firmen
- **Fase 3:** Enviar el link por WhatsApp/Email automáticamente (usar `ready_to_sign = true`)

## 🆘 Ayuda

Si algo no funciona:
1. Revisa los logs de Render
2. Revisa "Recent deliveries" en HubSpot
3. Verifica que el secret sea idéntico en ambos lados
4. Prueba con el endpoint `/webhook/test` primero
