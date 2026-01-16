// src/services/cloudConvertService.ts
import fs from 'fs';
import path from 'path';

/**
 * Convierte un DOCX a PDF usando CloudConvert API
 *
 * @param docxPath - Ruta absoluta al archivo DOCX
 * @param outputDir - Directorio donde se guardará el PDF
 * @returns Ruta absoluta al PDF generado
 */
export async function convertDocxToPdfWithCloudConvert(
  docxPath: string,
  outputDir: string
): Promise<string> {
  const apiKey = process.env.CLOUDCONVERT_API_KEY;
  const isSandbox = process.env.CLOUDCONVERT_SANDBOX === 'true';

  if (!apiKey) {
    throw new Error('CLOUDCONVERT_API_KEY no está configurada en las variables de entorno');
  }

  // Validar que existe el DOCX
  if (!fs.existsSync(docxPath)) {
    throw new Error(`DOCX no encontrado: ${docxPath}`);
  }

  // Asegurar carpeta de salida
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const pdfFileName = path.basename(docxPath, path.extname(docxPath)) + '.pdf';
  const pdfPath = path.join(outputDir, pdfFileName);

  try {
    console.log('[CloudConvert] Iniciando conversión DOCX → PDF');
    console.log('[CloudConvert] Archivo:', docxPath);
    console.log('[CloudConvert] Modo:', isSandbox ? 'SANDBOX' : 'PRODUCTION');

    // Paso 1: Crear un Job de conversión
    console.log('[CloudConvert] Paso 1: Creando job de conversión...');
    const createJobResponse = await fetch('https://api.cloudconvert.com/v2/jobs', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tasks: {
          'upload-my-file': {
            operation: 'import/upload',
          },
          'convert-my-file': {
            operation: 'convert',
            input: 'upload-my-file',
            output_format: 'pdf',
            engine: 'office', // Usa LibreOffice para mejor compatibilidad
            input_format: 'docx',
          },
          'export-my-file': {
            operation: 'export/url',
            input: 'convert-my-file',
          },
        },
        tag: 'declaracion-coi',
      }),
    });

    if (!createJobResponse.ok) {
      const errorText = await createJobResponse.text();
      throw new Error(`Error creando job en CloudConvert: ${createJobResponse.status} - ${errorText}`);
    }

    const jobData = await createJobResponse.json();
    console.log('[CloudConvert] ✅ Job creado:', jobData.data.id);

    // Paso 2: Obtener la tarea de upload
    const uploadTask = jobData.data.tasks.find((t: any) => t.name === 'upload-my-file');
    if (!uploadTask) {
      throw new Error('No se encontró la tarea de upload en el job');
    }

    // Paso 3: Subir el archivo DOCX
    console.log('[CloudConvert] Paso 2: Subiendo archivo DOCX...');
    const docxBuffer = fs.readFileSync(docxPath);
    const uploadUrl = uploadTask.result.form.url;
    const uploadParameters = uploadTask.result.form.parameters;

    const formData = new FormData();
    Object.keys(uploadParameters).forEach((key) => {
      formData.append(key, uploadParameters[key]);
    });
    formData.append('file', new Blob([docxBuffer]), path.basename(docxPath));

    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      body: formData,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`Error subiendo archivo: ${uploadResponse.status} - ${errorText}`);
    }

    console.log('[CloudConvert] ✅ Archivo subido correctamente');

    // Paso 4: Esperar a que termine la conversión
    console.log('[CloudConvert] Paso 3: Esperando conversión...');
    let jobStatus = jobData.data;
    let maxAttempts = 60; // Máximo 60 intentos (2 minutos)
    let attempts = 0;

    while (jobStatus.status !== 'finished' && jobStatus.status !== 'error' && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // Esperar 2 segundos

      const statusResponse = await fetch(`https://api.cloudconvert.com/v2/jobs/${jobData.data.id}`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (!statusResponse.ok) {
        throw new Error(`Error consultando status del job: ${statusResponse.status}`);
      }

      const statusData = await statusResponse.json();
      jobStatus = statusData.data;
      attempts++;

      console.log(`[CloudConvert] Status: ${jobStatus.status} (${attempts}/${maxAttempts})`);
    }

    if (jobStatus.status === 'error') {
      const errorTask = jobStatus.tasks.find((t: any) => t.status === 'error');
      throw new Error(`Error en conversión: ${errorTask?.message || 'Unknown error'}`);
    }

    if (jobStatus.status !== 'finished') {
      throw new Error('Timeout esperando conversión (2 minutos)');
    }

    console.log('[CloudConvert] ✅ Conversión completada');

    // Paso 5: Descargar el PDF
    console.log('[CloudConvert] Paso 4: Descargando PDF...');
    const exportTask = jobStatus.tasks.find((t: any) => t.name === 'export-my-file');
    if (!exportTask || !exportTask.result?.files?.[0]?.url) {
      throw new Error('No se encontró URL de descarga del PDF');
    }

    const downloadUrl = exportTask.result.files[0].url;
    const downloadResponse = await fetch(downloadUrl);

    if (!downloadResponse.ok) {
      throw new Error(`Error descargando PDF: ${downloadResponse.status}`);
    }

    const pdfBuffer = Buffer.from(await downloadResponse.arrayBuffer());
    fs.writeFileSync(pdfPath, pdfBuffer);

    console.log('[CloudConvert] ✅ PDF descargado:', pdfPath);
    console.log(`✅ Conversión exitosa: ${pdfPath}`);

    return pdfPath;

  } catch (err: any) {
    console.error('[CloudConvert] ❌ Error en conversión:');
    console.error('[CloudConvert] Error:', err.message);
    console.error('[CloudConvert] Stack:', err.stack);
    throw new Error(`CloudConvert conversion failed: ${err.message}`);
  }
}
