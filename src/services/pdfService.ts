// src/services/pdfService.ts
import { PDFDocument, StandardFonts } from 'pdf-lib';

/**
 * Convierte un HTML (simple) a un PDF de texto usando pdf-lib.
 * No renderiza estilos, solo el contenido textual, en UNA sola página.
 */
export async function htmlToPdfBuffer(html: string): Promise<Buffer> {
  // 1) Quitar etiquetas HTML básicas para quedarnos con texto
  const text = stripHtmlTags(html);

  // 2) Crear un nuevo PDF
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const fontSize = 10;
  const margin = 40;
  const lineHeight = fontSize * 1.3;

  // Una sola página
  const page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  const maxWidth = width - margin * 2;

  // 3) Hacer un wrap básico del texto
  const lines = wrapText(text, maxWidth, font, fontSize);

  let y = height - margin;

  for (const line of lines) {
    // Si no hay espacio, dejamos de dibujar (MVP simple)
    if (y < margin) {
      break;
    }

    page.drawText(line, {
      x: margin,
      y,
      size: fontSize,
      font,
    });

    y -= lineHeight;
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/**
 * Elimina etiquetas HTML muy básicas para quedarnos con texto.
 */
function stripHtmlTags(html: string): string {
  return html
    .replace(/<\/(p|div|br|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Divide el texto en líneas que quepan en el ancho de página.
 */
function wrapText(
  text: string,
  maxWidth: number,
  font: any,
  fontSize: number
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const width = font.widthOfTextAtSize(testLine, fontSize);

    if (width <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = word;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}
