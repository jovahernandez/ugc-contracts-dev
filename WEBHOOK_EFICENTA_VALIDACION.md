# Webhook EFICENTA - Pre-llenado de Datos

## Descripción

El webhook `/declaracion/webhook/crear` ahora soporta **pre-llenado automático de datos** del proveedor.

EFICENTA puede enviar los datos del proveedor al crear el link, y el formulario se mostrará con estos datos **pre-llenados y bloqueados** para validación visual del usuario.

## Flujo de Validación Visual

El sistema implementa un flujo de **validación visual** para mejorar la experiencia y precisión:

### Pasos del Flujo

1. **EFICENTA envía datos** → El webhook recibe los datos esperados del proveedor
2. **Formulario pre-llenado** → Los campos se muestran bloqueados (readonly) con los datos enviados
3. **Usuario valida visualmente** → El usuario revisa que los datos sean correctos
4. **Dos opciones:**
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

## Endpoint

```
POST https://coi-acuerdo.up.railway.app/declaracion/webhook/crear
```

## Request Body

### Campos Obligatorios

```json
{
  "uid": "PROV001",
  "api_key": "tu-api-key-secreta"
}
```

### Campos Opcionales (para validación automática)

```json
{
  "uid": "PROV001",
  "api_key": "tu-api-key-secreta",
  "nombre_proveedor_razon_social": "EFICENTA S.A. DE C.V.",
  "nombre_representante_legal": "Juan Pérez García",
  "email": "contacto@eficenta.com"
}
```

## Comportamiento

### Sin datos opcionales (comportamiento estándar)
- El formulario se muestra vacío
- El usuario puede escribir cualquier dato
- No hay pre-llenado ni bloqueo
- El proceso continúa normalmente

### Con datos opcionales (nuevo comportamiento con pre-llenado)
- EFICENTA envía los datos esperados en el webhook
- El sistema los guarda internamente
- El formulario se muestra con los campos **pre-llenados y bloqueados** (readonly)
- Se muestra un aviso: *"Los datos han sido pre-llenados por EFICENTA. Si encuentra algún error, haga clic en 'Datos erróneos' para corregirlos."*
- **Opción 1:** Usuario verifica y hace clic en "Generar Documento" (datos correctos)
- **Opción 2:** Usuario hace clic en "Datos erróneos" para desbloquear, editar y enviar
- **Importante:** NO hay validación de las ediciones del usuario - se confía en su corrección

## Respuesta

### Éxito - Link Creado

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

### Éxito - Link Ya Existente

```json
{
  "success": true,
  "uid": "PROV001",
  "status": "pending_signature",
  "message": "Registro existente, link disponible",
  "formUrl": "https://coi-acuerdo.up.railway.app/declaracion?uid=PROV001",
  "statusUrl": "https://coi-acuerdo.up.railway.app/declaracion/status?uid=PROV001",
  "createdAt": "2026-01-14T20:30:00.000Z"
}
```

### Éxito - Ya Firmado

```json
{
  "success": true,
  "uid": "PROV001",
  "status": "already_signed",
  "message": "Este proveedor ya firmó la declaración",
  "signedAt": "2026-01-14T21:00:00.000Z",
  "signedPdfUrl": "https://coi-acuerdo.up.railway.app/declaracion/download/PROV001"
}
```

### Error - API Key Inválida

```json
{
  "success": false,
  "error": "API key inválida"
}
```

### Error - UID Faltante

```json
{
  "success": false,
  "error": "uid es requerido"
}
```

## Ejemplo de Uso con cURL

### Sin validación (solo crear link)

```bash
curl -X POST https://coi-acuerdo.up.railway.app/declaracion/webhook/crear \
  -H "Content-Type: application/json" \
  -d '{
    "uid": "PROV001",
    "api_key": "eficenta-secret-key"
  }'
```

### Con pre-llenado de datos (recomendado)

```bash
curl -X POST https://coi-acuerdo.up.railway.app/declaracion/webhook/crear \
  -H "Content-Type: application/json" \
  -d '{
    "uid": "PROV001",
    "api_key": "eficenta-secret-key",
    "nombre_proveedor_razon_social": "EFICENTA S.A. DE C.V.",
    "nombre_representante_legal": "Juan Pérez García",
    "email": "contacto@eficenta.com"
  }'
```

## Ventajas del Pre-llenado

1. **Ahorro de Tiempo**: El usuario no necesita escribir todos sus datos manualmente
2. **Reducción de Errores de Escritura**: Los datos vienen directamente de la base de EFICENTA
3. **Validación Visual Simple**: El usuario solo necesita revisar que los datos sean correctos
4. **Flexibilidad**: Si hay un error, el usuario puede corregirlo directamente
5. **Confianza en el Usuario**: El sistema respeta las correcciones sin validación adicional
6. **No Invasivo**: Si EFICENTA no envía los datos, el formulario funciona normalmente (sin pre-llenar)

## Notas Importantes

- Los datos pre-llenados SÍ son visibles para el usuario (para validación visual)
- Los campos están bloqueados (readonly) hasta que el usuario haga clic en "Datos erróneos"
- El pre-llenado NO afecta el funcionamiento si no se envían los datos opcionales
- NO hay validación automática - el sistema confía en las correcciones del usuario
- Los datos se guardan en GitHub para persistencia (si está configurado)
- **NO se modifica la estructura del JSON de respuesta** - mantiene compatibilidad total
