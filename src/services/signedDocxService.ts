// src/services/signedDocxService.ts
import fs from 'fs';
import path from 'path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { ContractData } from './templateService';
import ImageModule from 'docxtemplater-image-module-free';

// Misma plantilla base que usas para el borrador
const templatePath = path.join(
  __dirname,
  '..',
  'templates',
  'ugc-contract.docx'
);

/**
 * Genera un DOCX FIRMAdo:
 * - Usa la plantilla ugc-contract.docx
 * - Llena ContractData
 * - Inserta la firma en el placeholder {%firma_creador}
 */
export function renderSignedContractDocx(
  data: ContractData,
  signatureImagePath: string
): Buffer {
  if (!fs.existsSync(templatePath)) {
    throw new Error(`DOCX template not found at: ${templatePath}`);
  }

  if (!signatureImagePath || !fs.existsSync(signatureImagePath)) {
    throw new Error(`Signature image not found at: ${signatureImagePath}`);
  }

  const content = fs.readFileSync(templatePath, 'binary');
  const zip = new PizZip(content);

  const imageModule = new (ImageModule as any)({
    centered: false,
    fileType: 'docx',
    getImage: function (tagValue: any) {
      // tagValue será lo que mandemos en data.firma_creador
      if (!tagValue || typeof tagValue !== 'string') {
        return Buffer.alloc(0);
      }
      if (!fs.existsSync(tagValue)) {
        console.warn('[SignedDocx] Signature image not found at:', tagValue);
        return Buffer.alloc(0);
      }
      return fs.readFileSync(tagValue);
    },
    getSize: function (_img: Buffer, _tagValue: any, _tagName: string) {
      // Tamaño de la firma dentro del documento
      return [200, 60]; // width, height
    },
  });

  const doc = new Docxtemplater(zip, {
    modules: [imageModule],
    paragraphLoop: true,
    linebreaks: true,
    delimiters: {
      start: '{',
      end: '}',
    },
  });

  // Inyectamos firma_creador explícitamente (ruta al PNG)
  const finalData: ContractData = {
    ...data,
    firma_creador: signatureImagePath,
  };

  // Normalizamos undefined/null -> ''
  const safeData: Record<string, any> = {};
  for (const [key, value] of Object.entries(finalData)) {
    safeData[key] =
      value === undefined || value === null ? '' : value;
  }

  doc.setData(safeData);

  try {
    doc.render();
  } catch (error: any) {
    console.error('Docxtemplater signed error:', error);
    throw new Error('Failed to render signed DOCX template');
  }

  const buf = doc.getZip().generate({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });

  return buf;
}
