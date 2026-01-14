// src/services/docxToPdfService.ts
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import mammoth from 'mammoth';

/**
 * Convierte un DOCX firmado a PDF usando Puppeteer.
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

  // Asegurar carpeta de salida
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Nombre del PDF final
  const pdfFileName =
    path.basename(signedDocxPath, path.extname(signedDocxPath)) + '.pdf';
  const pdfPath = path.join(outputDir, pdfFileName);

  try {
    // 1) Convertir DOCX a HTML usando mammoth
    const docxBuffer = fs.readFileSync(signedDocxPath);
    const result = await mammoth.convertToHtml({ buffer: docxBuffer });
    const htmlContent = result.value;

    // 2) Crear HTML completo con estilos para mejor formato
    const fullHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page {
      margin: 2cm;
      size: letter;
    }
    body {
      font-family: Arial, sans-serif;
      font-size: 12pt;
      line-height: 1.6;
      color: #000;
      max-width: 800px;
      margin: 0 auto;
    }
    img {
      max-width: 150px;
      height: auto;
      display: block;
      margin: 10px 0;
    }
    p {
      margin: 10px 0;
      text-align: justify;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }
    td, th {
      border: 1px solid #000;
      padding: 8px;
      text-align: left;
    }
  </style>
</head>
<body>
  ${htmlContent}
</body>
</html>`;

    // 3) Usar Puppeteer para convertir HTML a PDF
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: 'networkidle0' });

    await page.pdf({
      path: pdfPath,
      format: 'Letter',
      printBackground: true,
      margin: {
        top: '2cm',
        right: '2cm',
        bottom: '2cm',
        left: '2cm',
      },
    });

    await browser.close();

    console.log(`✅ PDF generado con Puppeteer: ${pdfPath}`);
    return pdfPath;

  } catch (err: any) {
    console.error('[Puppeteer] Error convirtiendo DOCX a PDF:', err);
    throw new Error(`Failed to convert DOCX to PDF: ${err.message}`);
  }
}
