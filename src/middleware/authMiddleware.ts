// src/middleware/authMiddleware.ts
import { Request, Response, NextFunction } from 'express';

const API_AUTH_TOKEN = process.env.API_AUTH_TOKEN;

/**
 * Autenticación de la API:
 * - Acepta x-api-key: <token>
 * - O Authorization: Bearer <token>
 *
 * Si API_AUTH_TOKEN no está seteado, deja pasar (útil en dev),
 * pero en tu caso ya lo tienes configurado: contracts2025!
 */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Lo que pueda venir del cliente
  const apiKeyHeader = req.header('x-api-key');
  const authHeader =
    req.header('authorization') || req.header('Authorization');

  const tokenFromAuth =
    authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.substring('Bearer '.length).trim()
      : undefined;

  const providedToken = apiKeyHeader || tokenFromAuth;

  if (!API_AUTH_TOKEN) {
    console.warn(
      '[Auth] API_AUTH_TOKEN is not configured. Skipping auth check.'
    );
    next();
    return;
  }

  if (!providedToken || providedToken !== API_AUTH_TOKEN) {
    console.warn('[Auth] Missing or invalid API token', {
      apiKeyHeader,
      authHeader,
    });

    res.status(401).json({
      status: 'error',
      message: 'Missing or invalid API token',
    });
    return;
  }

  // OK
  next();
}
