# EFFICENTA - Pre-llenado de Datos via URL

## Descripción

El sistema de declaraciones ahora soporta **pre-llenado automático de datos** mediante parámetros en el URL.

EFFICENTA puede enviar los datos del proveedor directamente en el link, y el formulario se mostrará con estos datos **pre-llenados y bloqueados** para validación visual del usuario.

## Flujo de Validación Visual

El sistema implementa un flujo de **validación visual** para mejorar la experiencia y precisión:

### Pasos del Flujo

1. **EFFICENTA construye el URL** → Añade los datos como parámetros en el link
2. **EFFICENTA envía el link al proveedor** → Por correo, WhatsApp, etc.
3. **Usuario abre el link** → El formulario lee los parámetros y pre-llena los campos
4. **Formulario pre-llenado** → Los campos se muestran bloqueados (readonly) con los datos enviados
5. **Usuario valida visualmente** → El usuario revisa que los datos sean correctos
6. **Dos opciones:**
   - ✅ **Datos correctos** → Usuario hace clic en "Generar Documento" directamente
   - ⚠️ **Datos incorrectos** → Usuario hace clic en "Datos erróneos" para desbloquear y editar

### Campos Pre-llenados

1. **Nombre de Empresa/Razón Social** (`nombre_proveedor_razon_social`)
   - Pre-llenado y bloqueado
   - Usuario puede desbloquear para editar

2. **Nombre del Representante Legal** (`nombre_representante_legal`)
   - Pre-llenado y bloqueado
   - Usuario puede desbloquear para editar

3. **Email** (`email`)
   - Pre-llenado y bloqueado
   - Usuario puede desbloquear para editar

### Botón "Datos erróneos"

Si el usuario detecta un error en los datos pre-llenados:
- Hace clic en **"⚠️ Datos erróneos - Desbloquear para editar"**
- Los campos se desbloquean y el usuario puede editarlos libremente
- El sistema **NO valida** las correcciones - confía en el usuario
- Usuario envía el formulario con los datos corregidos

## Formato del URL

```
https://coi-acuerdo.up.railway.app/declaracion?uid=XXX&nombre_proveedor_razon_social=YYY&nombre_representante_legal=ZZZ&email=AAA
```

### Parámetros del URL

| Parámetro | Requerido | Descripción | Ejemplo |
|-----------|-----------|-------------|---------|
| `uid` | ✅ Obligatorio | Identificador único del proveedor | `PROV001` |
| `nombre_proveedor_razon_social` o `nombre` | ⚠️ Opcional | Nombre o razón social del proveedor | `EFFICENTA%20S.A.%20DE%20C.V.` |
| `nombre_representante_legal` o `representante` | ⚠️ Opcional | Nombre del representante legal | `Juan%20P%C3%A9rez%20Garc%C3%ADa` |
| `email` | ⚠️ Opcional | Correo electrónico | `contacto@eficenta.com` |

**IMPORTANTE:** Los valores deben estar URL-encoded (espacios = %20, acentos, etc.)

## Comportamiento

### Sin parámetros opcionales (formulario vacío)
- URL mínimo: `https://coi-acuerdo.up.railway.app/declaracion?uid=PROV001`
- El formulario se muestra vacío
- El usuario puede escribir cualquier dato
- No hay pre-llenado ni bloqueo

### Con parámetros opcionales (formulario pre-llenado)
- EFFICENTA construye el URL con todos los datos
- El usuario abre el link
- El formulario se muestra con los campos **pre-llenados y bloqueados** (readonly)
- Se muestra un aviso: *"Los datos han sido pre-llenados por EFFICENTA. Si encuentra algún error, haga clic en 'Datos erróneos' para corregirlos."*
- **Opción 1:** Usuario verifica y hace clic en "Generar Documento" (datos correctos)
- **Opción 2:** Usuario hace clic en "Datos erróneos" para desbloquear, editar y enviar
- **Importante:** NO hay validación de las ediciones del usuario - se confía en su corrección

## Webhook (Método Alternativo)

Si prefieren, también pueden usar el webhook para crear links y obtenerlos via API:

```
POST https://coi-acuerdo.up.railway.app/declaracion/webhook/crear
```

### Request Body

```json
{
  "uid": "PROV001",
  "api_key": "tu-api-key-secreta",
  "nombre_proveedor_razon_social": "EFFICENTA S.A. DE C.V.",
  "nombre_representante_legal": "Juan Pérez García",
  "email": "contacto@eficenta.com"
}
```

**Nota:** Los datos enviados al webhook se guardan en la base de datos. Cuando el usuario abra el link, verá los campos pre-llenados aunque el URL no contenga los parámetros.

### Respuesta del Webhook

#### Éxito - Link Creado

```json
{
  "success": true,
  "uid": "PROV001",
  "status": "pending_form",
  "message": "Link creado exitosamente",
  "formUrl": "https://coi-acuerdo.up.railway.app/declaracion?uid=PROV001",
  "statusUrl": "https://coi-acuerdo.up.railway.app/declaracion/status?uid=PROV001",
  "createdAt": "2026-01-14T20:30:00.000Z"
}
```

## Ejemplos de URLs

### Formulario vacío (sin pre-llenado)

```
https://coi-acuerdo.up.railway.app/declaracion?uid=PROV001
```

### Formulario pre-llenado (recomendado)

**Opción 1: Nombres completos de parámetros**
```
https://coi-acuerdo.up.railway.app/declaracion?uid=PROV001&nombre_proveedor_razon_social=EFFICENTA%20S.A.%20DE%20C.V.&nombre_representante_legal=Juan%20P%C3%A9rez%20Garc%C3%ADa&email=contacto@eficenta.com
```

**Opción 2: Nombres cortos (alias)**
```
https://coi-acuerdo.up.railway.app/declaracion?uid=PROV001&nombre=EFFICENTA%20S.A.%20DE%20C.V.&representante=Juan%20P%C3%A9rez%20Garc%C3%ADa&email=contacto@eficenta.com
```

### Generar URL desde código (JavaScript ejemplo)

```javascript
function construirUrlDeclaracion(uid, nombre, representante, email) {
  const baseUrl = 'https://coi-acuerdo.up.railway.app/declaracion';
  const params = new URLSearchParams({
    uid: uid,
    nombre_proveedor_razon_social: nombre,
    nombre_representante_legal: representante,
    email: email
  });

  return `${baseUrl}?${params.toString()}`;
}

// Uso:
const url = construirUrlDeclaracion(
  'PROV001',
  'EFFICENTA S.A. DE C.V.',
  'Juan Pérez García',
  'contacto@eficenta.com'
);

console.log(url);
// Output: https://coi-acuerdo.up.railway.app/declaracion?uid=PROV001&nombre_proveedor_razon_social=EFFICENTA+S.A.+DE+C.V.&nombre_representante_legal=Juan+P%C3%A9rez+Garc%C3%ADa&email=contacto%40eficenta.com
```

## Ventajas del Pre-llenado via URL

1. **Simplicidad**: Solo necesitan construir un URL, sin llamar APIs
2. **Ahorro de Tiempo**: El usuario no necesita escribir todos sus datos manualmente
3. **Reducción de Errores**: Los datos vienen directamente de la base de EFFICENTA
4. **Validación Visual**: El usuario solo necesita revisar que los datos sean correctos
5. **Flexibilidad**: Si hay un error, el usuario puede corregirlo directamente
6. **Sin Dependencias**: No requiere autenticación ni API keys para el link
7. **Portable**: El link completo puede compartirse por cualquier medio (correo, WhatsApp, SMS)

## Comparación de Métodos

| Aspecto | URL con parámetros | Webhook API |
|---------|-------------------|-------------|
| **Facilidad de uso** | ✅ Solo construir URL | ⚠️ Requiere llamada API |
| **Autenticación** | ✅ No requiere | ⚠️ Requiere API key |
| **Compartible** | ✅ Link completo | ⚠️ Solo retorna URL base |
| **Pre-llenado** | ✅ Sí | ✅ Sí |
| **Persistencia** | ✅ Auto-guarda en DB | ✅ Guarda en DB |

**Recomendación:** Usar URL con parámetros para mayor simplicidad.

## Notas Importantes

- Los datos pre-llenados SÍ son visibles para el usuario (para validación visual)
- Los campos están bloqueados (readonly) hasta que el usuario haga clic en "Datos erróneos"
- El pre-llenado NO afecta el funcionamiento si no se envían los datos opcionales
- NO hay validación automática - el sistema confía en las correcciones del usuario
- Los datos se guardan automáticamente en GitHub cuando el usuario abre el link (si está configurado)
- Si el usuario abre el link múltiples veces, los datos se mantienen consistentes
