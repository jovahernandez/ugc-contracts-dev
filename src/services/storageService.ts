import fs from 'fs/promises';
import path from 'path';

const STORAGE_ROOT =
  process.env.STORAGE_ROOT || path.resolve(process.cwd(), 'storage');

export async function saveContractFile(
  contactId: string,
  buffer: Buffer,
  extension: 'pdf' | 'docx'
): Promise<{ filePath: string; publicUrl: string }> {
  const contractsDir = path.join(STORAGE_ROOT, 'contracts');
  await fs.mkdir(contractsDir, { recursive: true });

  const fileName = `contract_${contactId}.${extension}`;
  const filePath = path.join(contractsDir, fileName);

  await fs.writeFile(filePath, buffer);

  const baseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
  const publicUrl = `${baseUrl}/files/contracts/${fileName}`;

  return { filePath, publicUrl };
}
