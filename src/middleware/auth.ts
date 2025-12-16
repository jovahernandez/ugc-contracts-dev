// src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express';

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers['authorization'];

  if (!header) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Invalid Authorization format' });
  }

  const expectedToken = process.env.API_AUTH_TOKEN;
  if (!expectedToken) {
    console.error('API_AUTH_TOKEN is not set in environment variables');
    return res.status(500).json({ error: 'Server auth misconfiguration' });
  }

  if (token !== expectedToken) {
    return res.status(403).json({ error: 'Invalid API token' });
  }

  // Token válido, continuamos
  next();
}