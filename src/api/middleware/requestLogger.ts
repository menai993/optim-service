// src/api/middleware/requestLogger.ts
// Request/response logging middleware

import { Request, Response, NextFunction } from 'express';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const findingCount = (res as any).__findingCount ?? '-';
    const mode = (res as any).__mode ?? '-';
    console.log(
      `${req.method} ${req.path} ${res.statusCode} duration_ms=${durationMs} findings=${findingCount} mode=${mode}`,
    );
  });
  next();
}
