// src/api/middleware/errorHandler.ts
// Express error-handling middleware

import { Request, Response, NextFunction } from 'express';

export interface ApiError extends Error {
  statusCode?: number;
}

export function errorHandler(
  err: ApiError,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const statusCode = err.statusCode ?? 500;
  const message = err.message ?? 'Internal Server Error';

  res.status(statusCode).json({
    error: {
      message,
      ...(process.env['NODE_ENV'] !== 'production' && { stack: err.stack }),
    },
  });
}
