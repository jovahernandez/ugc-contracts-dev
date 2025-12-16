// src/services/signedPdfService.ts
import fs from 'fs';
import path from 'path';

export interface GenerateSignedPdfParams {
  docxPath: string;
  signatureImagePath: string;
  signerName: string;
  signedAtDisplay: string; // dd/mm/aaaa para mostrar
  outputDir: string;
  outputFileName: string; // normalmente ".pdf", pero aquí no es obligatorio
}

/**
 * Versión simplificada de generación de "PDF firmado":
 *
 * Por ahora:
 * - Verifica que exista el DOCX original.
 * - Crea la carpeta de contratos firmados si no existe.
 * - Copia el DOCX original a esa carpeta con un nuevo nombre.
 *
 * A futuro:
 * - Aquí podemos:
 *   - Convertir el DOCX a PDF.
 *   - Incrustar la firma (PNG) en la sección de firma.
 *   - Poner leyendas de quien firmó y cuándo.
 */
export async function generateSignedPdf(
  params: GenerateSignedPdfParams
): Promise<{ pdfPath: string }> {
  const {
    docxPath,
    // signatureImagePath,
    // signerName,
    // signedAtDisplay,
    outputDir,
    outputFileName,
  } = params;

  // 1) Validar que exista el DOCX original
  if (!fs.existsSync(docxPath)) {
    throw new Error(`Source DOCX not found at: ${docxPath}`);
  }

  // 2) Asegurar carpeta de salida
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 3) Definir ruta de "PDF firmado"
  //    Para este MVP usamos una copia del DOCX con un nombre distinto.
  const baseName = path.basename(outputFileName, path.extname(outputFileName));
  const signedDocxFileName = `${baseName}.docx`;
  const signedDocxPath = path.join(outputDir, signedDocxFileName);

  // 4) Copiar el DOCX como "documento firmado"
  fs.copyFileSync(docxPath, signedDocxPath);

  // Nota: devolvemos la ruta como pdfPath aunque sea .docx,
  // porque el resto del código ya espera la propiedad pdfPath.
  // Más adelante podremos cambiar la implementación a un PDF real
  // sin tocar la firma del contratoRoutes.
  return { pdfPath: signedDocxPath };
}
