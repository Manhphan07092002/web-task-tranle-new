import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface JwtPayload {
  sub?: string;
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  avatar: string;
  permissions: string[];
  tokenVersion?: number;
  managementLevel?: number;
  primaryDepartmentId?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

function verifyBearerToken(req: Request, res: Response, next: NextFunction, db: any) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.error(`[Auth] Missing token for ${req.method} ${req.originalUrl}`);
    return res.status(401).json({ error: 'Unauthorized: missing token' });
  }

  const token = authHeader.slice(7);
  const secret = process.env.JWT_SECRET as string;

  try {
    if (!process.env.JWT_SECRET) throw new Error('JWT secret is not configured');
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    if (typeof payload.sub !== 'string' || !payload.sub || !Number.isSafeInteger(payload.tokenVersion) || Number(payload.tokenVersion) < 0) {
      return res.status(401).json({ error: 'Unauthorized: invalid token claims' });
    }

    (async () => {
      const user = await db.get(
        'SELECT u.id, u.name, u.email, u.role, u.department, u.avatar, u.isLocked, u.lockedUntil, u.tokenVersion, u.managementLevel, u.primaryDepartmentId, r.permissions FROM users u LEFT JOIN roles r ON u.role = r.name WHERE u.id = ?',
        [payload.sub]
      );
      const temporarilyLocked = user?.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now();
      if (!user || user.isLocked || temporarilyLocked) {
        return res.status(401).json({ error: 'Unauthorized: account unavailable' });
      }
      const tokenVersion = Number(payload.tokenVersion);
      if (Number(user.tokenVersion || 0) !== tokenVersion) {
        return res.status(401).json({ error: 'Unauthorized: token revoked' });
      }
      req.user = {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        avatar: user.avatar,
        permissions: user.permissions ? JSON.parse(user.permissions) : [],
        tokenVersion: Number(user.tokenVersion || 0),
        managementLevel: user.managementLevel,
        primaryDepartmentId: user.primaryDepartmentId,
      };
      next();
    })().catch((e: any) => {
      console.error(`[Auth] DB verification failed for ${req.method} ${req.originalUrl}:`, e.message);
      res.status(401).json({ error: 'Unauthorized: invalid account' });
    });
  } catch (e: any) {
    console.error(`[Auth] Invalid token for ${req.method} ${req.originalUrl}:`, e.message);
    return res.status(401).json({ error: 'Unauthorized: invalid or expired token' });
  }
}

export function createRequireAuth(db: any) {
  if (!db || typeof db.get !== 'function') throw new Error('createRequireAuth requires a database adapter');
  return (req: Request, res: Response, next: NextFunction) => verifyBearerToken(req, res, next, db);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || (req.user.role !== 'Admin' && !req.user.permissions?.includes('admin_panel'))) {
    return res.status(403).json({ error: 'Forbidden: admin access required' });
  }
  next();
}

export function requirePermission(...permissions: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role === 'Admin' || req.user.permissions?.includes('admin_panel')) return next();
    const allowed = permissions.some(permission => req.user?.permissions?.includes(permission));
    if (!allowed) return res.status(403).json({ error: 'Forbidden: insufficient permissions' });
    next();
  };
}
