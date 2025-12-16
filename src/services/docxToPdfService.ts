// src/services/docxToPdfService.ts
import fs from 'fs';
import path from 'path';
import https from 'https';
import CloudConvert from 'cloudconvert';

/**
 * Convierte un DOCX firmado a PDF usando CloudConvert.
 *
 * - signedDocxPath: ruta ABSOLUTA al DOCX ya firmado.
 * - outputDir: carpeta donde guardaremos el PDF generado.
 *
 * Devuelve la ruta ABSOLUTA al PDF resultante.
 */
export async function convertDocxToPdf(
  signedDocxPath: string,
  outputDir: string
): Promise<string> {
  // Validar que exista el DOCX
  if (!fs.existsSync(signedDocxPath)) {
    throw new Error(`Signed DOCX not found at: ${signedDocxPath}`);
  }

  const apiKey = process.env.CLOUDCONVERT_API_KEY;
  const useSandbox = process.env.CLOUDCONVERT_SANDBOX === 'true';

  // Si no hay API key, no rompemos el flujo: devolvemos el DOCX
  if (!apiKey) {
    console.warn(
      '[CloudConvert] CLOUDCONVERT_API_KEY is not set. Returning DOCX path instead of PDF.'
    );
    return signedDocxPath;
  }

  // Soportar ambas formas de export del paquete (default / named)
  const CloudConvertCtor: any =
    (CloudConvert as any).default || (CloudConvert as any);
  const cloudConvert = new CloudConvertCtor(apiKey, useSandbox);

  // Asegurar carpeta de salida
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Nombre del PDF final
  const pdfFileName =
    path.basename(signedDocxPath, path.extname(signedDocxPath)) + '.pdf';
  const pdfPath = path.join(outputDir, pdfFileName);

  // 1) Crear Job en CloudConvert
  let job: any = await cloudConvert.jobs.create({
    tasks: {
      'import-my-file': {
        operation: 'import/upload',
      },
      'convert-my-file': {
        operation: 'convert',
        input: 'import-my-file',
        input_format: 'docx',
        output_format: 'pdf',
      },
      'export-my-file': {
        operation: 'export/url',
        input: 'convert-my-file',
      },
    },
  });

  // 2) Subir el DOCX al task de import/upload
  const uploadTask = job.tasks.filter(
    (task: any) => task.name === 'import-my-file'
  )[0];

  await cloudConvert.tasks.upload(
    uploadTask,
    fs.createReadStream(signedDocxPath)
  );

  // 3) Esperar a que el Job termine
  job = await cloudConvert.jobs.wait(job.id);

  // 4) Obtener la URL del PDF generado (export/url)
  const exportTask = job.tasks.filter(
    (task: any) => task.name === 'export-my-file'
  )[0];

  if (
    !exportTask ||
    !exportTask.result ||
    !exportTask.result.files ||
    !exportTask.result.files[0]
  ) {
    throw new Error('[CloudConvert] No export file found in job result.');
  }

  const file = exportTask.result.files[0];

  // 5) Descargar el PDF a pdfPath
  await new Promise<void>((resolve, reject) => {
    https
      .get(file.url, (response) => {
        if (response.statusCode && response.statusCode >= 400) {
          reject(
            new Error(
              `[CloudConvert] Download failed with status ${response.statusCode}`
            )
          );
          return;
        }

        const fileStream = fs.createWriteStream(pdfPath);
        response
          .pipe(fileStream)
          .on('finish', () => {
            fileStream.close();
            resolve();
          })
          .on('error', (err) => {
            fileStream.close();
            reject(err);
          });
      })
      .on('error', (err) => {
        reject(err);
      });
  });

  return pdfPath;
}
