# Migración de Render a Railway

## 📋 Checklist de Migración

### Antes de Empezar
- [ ] Andrés ya pagó Railway (confirmado ✅)
- [ ] Tienes acceso al repositorio GitHub
- [ ] Tienes las variables de entorno actuales de Render

---

## Paso 1: Crear Proyecto en Railway

1. **Ir a Railway:** https://railway.app/
2. **Login con GitHub** (mismo usuario que tiene el repo)
3. **New Project** → **Deploy from GitHub repo**
4. **Seleccionar:** `jovahernandez/ugc-contracts-dev` (o el repo correcto)
5. Railway detectará automáticamente que es Node.js

---

## Paso 2: Configurar Variables de Entorno

Railway las lee desde un dashboard. Agregar TODAS estas variables:

### Variables Críticas (copiar de Render):

```bash
# HubSpot
HUBSPOT_PRIVATE_APP_TOKEN=pat-na1-XXXXXXX
HUBSPOT_WEBHOOK_SECRET=XXXXXXX
HUBSPOT_BASE_URL=https://api.hubapi.com

# GitHub Storage
GITHUB_TOKEN=ghp_XXXXXXX
GITHUB_REPO=another-ugc-contracts
GITHUB_OWNER=jovahernandez
GITHUB_BRANCH=main

# URLs
PUBLIC_BASE_URL=https://YOUR-APP.up.railway.app

# Eficenta
EFICENTA_API_KEY=XXXXXXX

# Opcionales
SIGNATURE_EXPIRATION_DAYS=5
API_AUTH_TOKEN=XXXXXXX
PORT=3000
```

**Cómo agregar variables en Railway:**
- Project Settings → Variables
- Add Variable (una por una)
- Railway auto-redeploya después de agregar variables

---

## Paso 3: Configurar Build Settings (Automático)

Railway detecta automáticamente desde `package.json`:

```json
{
  "scripts": {
    "build": "tsc",
    "start": "node dist/server.js"
  }
}
```

**Build Command:** `npm run build`
**Start Command:** `npm start`

✅ Railway ya lo detecta, NO necesitas configurar nada extra.

---

## Paso 4: Obtener URL de Railway

Después del primer deploy:

1. **Settings → Networking → Generate Domain**
2. Railway te da una URL como: `https://another-ugc-contracts-production.up.railway.app`
3. **Copiar esta URL** (la necesitarás para el siguiente paso)

---

## Paso 5: Actualizar PUBLIC_BASE_URL

1. Ir a **Variables** en Railway
2. Editar `PUBLIC_BASE_URL`
3. Poner la URL de Railway (del paso anterior)
4. Railway auto-redeploya

---

## Paso 6: Actualizar Webhooks en HubSpot

### Webhook URL antigua (Render):
```
https://ugc-contracts-dev.onrender.com/webhook/hubspot
```

### Webhook URL nueva (Railway):
```
https://YOUR-APP.up.railway.app/webhook/hubspot
```

**Pasos en HubSpot:**
1. Settings → Integrations → Private Apps
2. Editar el webhook existente
3. Cambiar URL a la nueva de Railway
4. Guardar

**IMPORTANTE:** El `HUBSPOT_WEBHOOK_SECRET` debe ser el MISMO.

---

## Paso 7: Actualizar URLs en Eficenta

Si Eficenta tiene URLs hardcodeadas:

**Antigua:** `https://ugc-contracts-dev.onrender.com/declaracion/...`
**Nueva:** `https://YOUR-APP.up.railway.app/declaracion/...`

Avisar a Liz/equipo Eficenta del cambio.

---

## Paso 8: Verificar Deploy

### A) Healthcheck
```bash
curl https://YOUR-APP.up.railway.app/health
```

Debe responder: `{"status":"ok"}`

### B) Ver Logs en Railway
- Project → Deployments → Click en el deployment activo
- Ver logs en tiempo real

### C) Probar endpoints:

**Status de declaración:**
```bash
curl https://YOUR-APP.up.railway.app/declaracion/status?uid=TEST001
```

**Webhook test:**
```bash
curl https://YOUR-APP.up.railway.app/webhook/test
```

---

## Paso 9: Prueba End-to-End

1. **Crear nueva declaración en Eficenta**
2. **Firmar el documento**
3. **Verificar que se guarde en GitHub**
4. **Verificar que el PDF se descargue correctamente**

Si todo funciona ✅ → migración exitosa!

---

## Paso 10: (Opcional) Apagar Render

Una vez confirmado que Railway funciona 100%:

1. Ir a Render dashboard
2. Suspender el servicio (no eliminarlo todavía por si acaso)
3. Esperar 1-2 días
4. Si todo sigue funcionando, eliminar de Render

---

## 🔥 Ventajas de Railway vs Render

| Feature | Render | Railway |
|---------|--------|---------|
| **Cold starts** | Frecuentes | Casi ninguno |
| **Reinicio** | Cada 24h | Solo cuando actualizas |
| **Deploy** | 3-5 min | 30-60 seg |
| **Logs** | Básicos | Mejores |
| **Networking** | OK | Mejor |
| **Precio** | Gratis (limitado) | $5/mes (mejor) |

---

## 🆘 Troubleshooting

### Error: "Cannot find module"
- Build falló → ver logs en Railway
- Verificar que `npm run build` funcione localmente

### Error: Variables de entorno no se aplican
- Railway redeploya automáticamente al agregar variables
- Esperar 1-2 minutos después de agregar

### Error: Webhook no funciona
- Verificar que la URL en HubSpot sea la correcta
- Verificar que `HUBSPOT_WEBHOOK_SECRET` sea idéntico

### Error: GitHub storage falla
- Verificar `GITHUB_TOKEN` con permisos correctos
- Token debe tener scope: `repo` (full control)

---

## 📞 Contacto Railway

Si hay problemas técnicos con Railway:
- Discord: https://discord.gg/railway
- Docs: https://docs.railway.app/

---

## ✅ Post-Migración

Después de migrar:
1. **Monitorear logs** por 24h
2. **Verificar que GitHub siga guardando** datos
3. **Confirmar con Eficenta** que todo funciona
4. **Actualizar documentación** interna con nueva URL

---

## 🎯 Resumen Rápido

```bash
# 1. Crear proyecto en Railway desde GitHub
# 2. Copiar TODAS las env vars de Render → Railway
# 3. Obtener URL de Railway
# 4. Actualizar PUBLIC_BASE_URL en Railway
# 5. Actualizar webhook URL en HubSpot
# 6. Probar endpoints
# 7. ✅ Listo!
```

**Tiempo estimado:** 15-20 minutos

**Downtime:** 0 minutos (Railway y Render pueden coexistir mientras pruebas)
