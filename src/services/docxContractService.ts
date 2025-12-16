// src/services/docxContractService.ts
import fs from 'fs';
import path from 'path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { ContractData } from './templateService';

// Ruta de la plantilla Word
const templatePath = path.join(
  __dirname,
  '..',
  'templates',
  'ugc-contract.docx'
);

/**
 * Rellena la plantilla DOCX usando los campos de ContractData.
 * - Placeholders en el .docx deben ser {campo}
 * - Cualquier valor undefined/null se envía como cadena vacía ("")
 */
export function renderContractDocx(data: ContractData): Buffer {
  if (!fs.existsSync(templatePath)) {
    throw new Error(`DOCX template not found at: ${templatePath}`);
  }

  const content = fs.readFileSync(templatePath, 'binary');
  const zip = new PizZip(content);

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: {
      start: '{',
      end: '}',
    },
  });

  // Normalizamos: nada de undefined / null hacia la plantilla
  const safeData: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    safeData[key] =
      value === undefined || value === null ? '' : value;
  }

  console.log('renderContractDocx() keys:', Object.keys(safeData));

  doc.setData(safeData);

  try {
    doc.render();
  } catch (error: any) {
    console.error('Docxtemplater error:', error);
    throw new Error('Failed to render DOCX template');
  }

  const buf = doc.getZip().generate({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });

  return buf;
}
