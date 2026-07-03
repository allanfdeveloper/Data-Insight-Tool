import type { Request, Response, NextFunction } from "express";

/**
 * Middleware to require an authenticated session.
 * Attaches req.userId if session is valid.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const userId = (req.session as any).userId;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  (req as any).userId = userId;
  (req as any).isAdmin = !!(req.session as any).isAdmin;
  next();
}

/**
 * Middleware to require admin privileges.
 * Must be used after requireAuth.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const isAdmin = (req.session as any).isAdmin;
  if (!isAdmin) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}
