// src/api/middleware/requestLogger.ts
// Simple request-logging middleware

import { Request, Response, NextFunction } from 'express';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${durationMs}ms`);
  });
  next();
}
