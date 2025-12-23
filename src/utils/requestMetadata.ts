// src/utils/requestMetadata.ts
import type { Request } from 'express';
import { createHash } from 'crypto';

/**
 * Extrae la IP real del cliente considerando proxies (Railway, Codespaces, Vercel, etc.)
 */
export function getClientIp(req: Request): string {
  // X-Forwarded-For puede tener múltiples IPs: "client, proxy1, proxy2"
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',');
    const clientIp = ips[0].trim();
    if (clientIp && clientIp !== 'unknown') {
      return clientIp;
    }
  }

  // Otros headers comunes de proxies
  const realIp = req.headers['x-real-ip'];
  if (realIp && typeof realIp === 'string') {
    return realIp.trim();
  }

  // Cloudflare
  const cfIp = req.headers['cf-connecting-ip'];
  if (cfIp && typeof cfIp === 'string') {
    return cfIp.trim();
  }

  // Fallback a Express (requiere trust proxy habilitado)
  const expressIp = req.ip;
  if (expressIp) {
    // Normalizar IPv6 localhost
    if (expressIp === '::1' || expressIp === '::ffff:127.0.0.1') {
      return '127.0.0.1';
    }
    // Quitar prefijo IPv6 de IPv4 mapeada
    if (expressIp.startsWith('::ffff:')) {
      return expressIp.substring(7);
    }
    return expressIp;
  }

  return 'unknown';
}

/**
 * Extrae toda la metadata relevante de la request para auditoría legal
 */
export interface SignatureMetadata {
  ip: string;
  userAgent: string;
  acceptLanguage: string;
  timezone: string;
  signedAtUtc: string;
  signedAtLocal: string;
  referer: string;
  screenInfo?: string;
}

export function extractSignatureMetadata(req: Request, timezoneOffset?: number): SignatureMetadata {
  const now = new Date();
  
  // Calcular hora local si el cliente envió su offset
  let signedAtLocal = now.toISOString();
  let timezone = 'UTC';
  
  if (timezoneOffset !== undefined && !isNaN(timezoneOffset)) {
    const localTime = new Date(now.getTime() - (timezoneOffset * 60000));
    signedAtLocal = localTime.toISOString();
    const offsetHours = -timezoneOffset / 60;
    const sign = offsetHours >= 0 ? '+' : '';
    timezone = `UTC${sign}${offsetHours}`;
  }

  return {
    ip: getClientIp(req),
    userAgent: req.get('user-agent') || 'unknown',
    acceptLanguage: req.get('accept-language') || 'unknown',
    timezone,
    signedAtUtc: now.toISOString(),
    signedAtLocal,
    referer: req.get('referer') || req.get('origin') || 'direct',
  };
}

/**
 * Genera un hash SHA-256 del contenido del documento para auditoría
 */
export function generateDocumentHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Valida si un token ha expirado (por defecto 5 días)
 */
export function isTokenExpired(createdAt: string, expirationDays: number = 5): boolean {
  const created = new Date(createdAt);
  const now = new Date();
  const diffMs = now.getTime() - created.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays > expirationDays;
}

/**
 * Calcula cuántos días quedan antes de expirar
 */
export function daysUntilExpiration(createdAt: string, expirationDays: number = 5): number {
  const created = new Date(createdAt);
  const expiresAt = new Date(created.getTime() + (expirationDays * 24 * 60 * 60 * 1000));
  const now = new Date();
  const diffMs = expiresAt.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * Formatea fecha de expiración para mostrar al usuario
 */
export function formatExpirationDate(createdAt: string, expirationDays: number = 5): string {
  const created = new Date(createdAt);
  const expiresAt = new Date(created.getTime() + (expirationDays * 24 * 60 * 60 * 1000));
  return expiresAt.toLocaleDateString('es-MX', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
