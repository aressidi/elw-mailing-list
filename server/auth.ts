import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const AUTH_ENABLED: boolean =
  process.env.AUTH_ENABLED === 'true'
    ? true
    : process.env.AUTH_ENABLED === 'false'
      ? false
      : process.env.NODE_ENV === 'production';

const AUTH_USERNAME = process.env.AUTH_USERNAME || 'admin';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
const AUTH_JWT_SECRET = process.env.AUTH_JWT_SECRET;
const AUTH_JWT_EXPIRES_IN = process.env.AUTH_JWT_EXPIRES_IN || '8h';

if (AUTH_ENABLED && !AUTH_PASSWORD) {
  console.error('FATAL: AUTH_ENABLED is true but AUTH_PASSWORD is not set.');
  process.exit(1);
}

if (AUTH_ENABLED && (!AUTH_JWT_SECRET || AUTH_JWT_SECRET.length < 32)) {
  console.error('FATAL: AUTH_ENABLED is true but AUTH_JWT_SECRET is missing or shorter than 32 characters.');
  process.exit(1);
}

if (AUTH_ENABLED && AUTH_PASSWORD && AUTH_PASSWORD.length < 8) {
  console.warn('WARNING: AUTH_PASSWORD is shorter than 8 characters.');
}

export const authEnabled = AUTH_ENABLED;

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  const length = Math.max(aBuf.length, bBuf.length, 1);
  const aPadded = Buffer.alloc(length);
  const bPadded = Buffer.alloc(length);
  aBuf.copy(aPadded);
  bBuf.copy(bPadded);
  return crypto.timingSafeEqual(aPadded, bPadded) && aBuf.length === bBuf.length;
}

export function loginHandler(req: Request, res: Response): void {
  const { username, password } = req.body || {};

  const usernameMatches = typeof username === 'string' && timingSafeStringEqual(username, AUTH_USERNAME);
  const passwordMatches = typeof password === 'string' && timingSafeStringEqual(password, AUTH_PASSWORD || '');

  if (!usernameMatches || !passwordMatches) {
    res.status(401).json({ success: false, error: 'Invalid credentials' });
    return;
  }

  const token = jwt.sign({ sub: username, role: 'admin' }, AUTH_JWT_SECRET as string, {
    expiresIn: AUTH_JWT_EXPIRES_IN,
  } as jwt.SignOptions);

  res.json({ success: true, data: { token, expiresIn: AUTH_JWT_EXPIRES_IN, username } });
}

export function authRequired(req: Request, res: Response, next: NextFunction): void {
  if (!authEnabled) {
    next();
    return;
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }

  const token = header.slice('Bearer '.length);

  try {
    const payload = jwt.verify(token, AUTH_JWT_SECRET as string) as jwt.JwtPayload;
    (req as any).user = { username: payload.sub, role: payload.role };
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

export function authConfigHandler(_req: Request, res: Response): void {
  res.json({ success: true, data: { enabled: authEnabled } });
}
