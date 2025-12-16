// src/middleware/authMiddleware.ts
import type { Request, Response, NextFunction } from 'express';

// Token esperado (definido como variable de entorno en Railway / .env)
const EXPECTED_TOKEN = process.env.API_AUTH_TOKEN;

/**
 * Autenticación simple para webhooks.
 *
 * Acepta el token en:
 *  - body.apiAuthToken
 *  - body.api_auth_token
 *  - body.api_token
 *  - body.token
 *  - Authorization: Bearer <token>
 *  - x-api-key / x-api-token
 */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Si no hay token configurado en el entorno, dejamos pasar (solo log de aviso)
  if (!EXPECTED_TOKEN) {
    console.warn(
      '[AuthMiddleware] API_AUTH_TOKEN is not set; skipping auth check.'
    );
    return next();
  }

  // ----- 1) TOKENS POR BODY -----
  const bodyCandidates: unknown[] = [
    req.body?.apiAuthToken,
    req.body?.api_auth_token,
    req.body?.api_token,
    req.body?.token,
  ];

  const bodyToken = bodyCandidates.find(
    (v) => typeof v === 'string' && v.length > 0
  ) as string | undefined;

  // ----- 2) Authorization: Bearer <token> -----
  const authHeader = req.header('authorization') || req.header('Authorization');
  let bearerToken: string | undefined;
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    bearerToken = authHeader.slice(7).trim();
  }

  // ----- 3) x-api-key / x-api-token -----
  const xApiKey =
    (req.header('x-api-key') as string | undefined) ||
    (req.header('x-api-token') as string | undefined);

  const resolvedToken = bodyToken || bearerToken || xApiKey;

  // Log seguro para debug (no imprime el valor del token)
  console.log('[AuthMiddleware] token check', {
    hasBodyToken: !!bodyToken,
    hasBearer: !!bearerToken,
    hasXApiKey: !!xApiKey,
    expectedSet: !!EXPECTED_TOKEN,
  });

  if (!resolvedToken || resolvedToken !== EXPECTED_TOKEN) {
    console.warn('[AuthMiddleware] Missing or invalid API token');

    res.status(401).json({
      status: 'error',
      message: 'Missing or invalid API token',
    });
    return;
  }

  // Autenticado
  next();
}
