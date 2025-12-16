// src/services/docxContractService.ts
import fs from 'fs';
import path from 'path';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import type { ContractData } from './templateService';

// Usamos siempre la ruta raíz del proyecto + src/templates
// Esto funciona igual en local y en Railway (donde el repo está en /app).
const templatePath = path.join(
  process.cwd(),
  'src',
  'templates',
  'ugc-contract.docx'
);

export function renderContractDocx(data: ContractData): Buffer {
  if (!fs.existsSync(templatePath)) {
    throw new Error(`DOCX template not found at: ${templatePath}`);
  }

  const content = fs.readFileSync(templatePath);
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
  });

  doc.setData(data);

  try {
    doc.render();
  } catch (err: any) {
    console.error('Error rendering DOCX contract:', err);
    throw err;
  }

  const buf = doc.getZip().generate({ type: 'nodebuffer' });
  return buf;
}
