// src/utils/dataValidation.ts

/**
 * Normaliza un string para comparación flexible
 * - Convierte a mayúsculas
 * - Quita acentos
 * - Normaliza espacios (múltiples espacios → uno solo)
 * - Trim espacios al inicio y final
 */
export function normalizeString(str: string): string {
  if (!str) return '';

  return str
    .toUpperCase()
    .normalize('NFD') // Descompone caracteres con acentos
    .replace(/[\u0300-\u036f]/g, '') // Elimina marcas diacríticas (acentos)
    .replace(/\s+/g, ' ') // Múltiples espacios → un espacio
    .trim();
}

/**
 * Normaliza un email para comparación
 * - Convierte a minúsculas
 * - Trim espacios
 */
export function normalizeEmail(email: string): string {
  if (!email) return '';
  return email.toLowerCase().trim();
}

/**
 * Compara dos strings con normalización flexible
 * Usado para nombres, direcciones, etc.
 */
export function flexibleMatch(input: string, expected: string): boolean {
  const normalizedInput = normalizeString(input);
  const normalizedExpected = normalizeString(expected);
  return normalizedInput === normalizedExpected;
}

/**
 * Compara dos emails con normalización
 */
export function emailMatch(input: string, expected: string): boolean {
  const normalizedInput = normalizeEmail(input);
  const normalizedExpected = normalizeEmail(expected);
  return normalizedInput === normalizedExpected;
}

/**
 * Valida datos del proveedor contra los datos esperados
 * Devuelve true si todos coinciden, false si alguno no coincide
 */
export interface ProveedorValidationData {
  nombre_proveedor_razon_social: string;
  nombre_representante_legal: string;
  email: string;
}

export function validateProveedorData(
  inputData: ProveedorValidationData,
  expectedData: ProveedorValidationData
): boolean {
  // Validar nombre de empresa/razón social (flexible)
  const nombreEmpresaMatch = flexibleMatch(
    inputData.nombre_proveedor_razon_social,
    expectedData.nombre_proveedor_razon_social
  );

  // Validar nombre del representante legal (flexible)
  const nombreRepresentanteMatch = flexibleMatch(
    inputData.nombre_representante_legal,
    expectedData.nombre_representante_legal
  );

  // Validar email (normalizado pero no tan flexible)
  const emailMatches = emailMatch(
    inputData.email,
    expectedData.email
  );

  // Log para debugging (solo en desarrollo)
  if (process.env.NODE_ENV !== 'production') {
    console.log('[Validation] Nombre empresa:', {
      input: normalizeString(inputData.nombre_proveedor_razon_social),
      expected: normalizeString(expectedData.nombre_proveedor_razon_social),
      match: nombreEmpresaMatch,
    });
    console.log('[Validation] Nombre representante:', {
      input: normalizeString(inputData.nombre_representante_legal),
      expected: normalizeString(expectedData.nombre_representante_legal),
      match: nombreRepresentanteMatch,
    });
    console.log('[Validation] Email:', {
      input: normalizeEmail(inputData.email),
      expected: normalizeEmail(expectedData.email),
      match: emailMatches,
    });
  }

  // Todos deben coincidir
  return nombreEmpresaMatch && nombreRepresentanteMatch && emailMatches;
}
