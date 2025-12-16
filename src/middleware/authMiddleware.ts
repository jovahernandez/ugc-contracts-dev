// src/middleware/authMiddleware.ts
import type { Request, Response, NextFunction } from 'express';

const EXPECTED_TOKEN = process.env.API_AUTH_TOKEN;

/**
 * Autenticación muy simple para webhooks:
 * - Lee el token de:
 *   - body.apiAuthToken
 *   - header Authorization: Bearer <token>
 *   - header x-api-key o x-api-token
 */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Si no hay token configurado en el server, no bloqueamos (solo log)
  if (!EXPECTED_TOKEN) {
    console.warn(
      '[AuthMiddleware] API_AUTH_TOKEN is not set; skipping auth check.'
    );
    return next();
  }

  // 1) Token por body (forma que usaremos desde HubSpot)
  const bodyToken =
    typeof req.body?.apiAuthToken === 'string'
      ? (req.body.apiAuthToken as string)
      : undefined;

  // 2) Token por Authorization: Bearer xxx
  const authHeader = req.header('authorization') || req.header('Authorization');
  let bearerToken: string | undefined;
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    bearerToken = authHeader.slice(7).trim();
  }

  // 3) Token por cabecera x-api-key / x-api-token
  const xApiKey =
    (req.header('x-api-key') as string | undefined) ||
    (req.header('x-api-token') as string | undefined);

  const resolvedToken = bodyToken || bearerToken || xApiKey;

  if (!resolvedToken || resolvedToken !== EXPECTED_TOKEN) {
    console.warn('[AuthMiddleware] Missing or invalid API token', {
      hasBodyToken: !!bodyToken,
      hasBearer: !!bearerToken,
      hasXApiKey: !!xApiKey,
    });

    res.status(401).json({
      status: 'error',
      message: 'Missing or invalid API token',
    });
    return;
  }

  // Autenticado
  next();
}
