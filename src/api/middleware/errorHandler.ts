// src/api/middleware/errorHandler.ts
// Express error-handling middleware

import { Request, Response, NextFunction } from 'express';

export function errorHandler(
  err: Error & { statusCode?: number; agentId?: string },
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // AgentError from specialist agents
  if (err.name === 'AgentError' && err.agentId) {
    res.status(500).json({
      error: {
        message: err.message,
        agentId: err.agentId,
      },
    });
    return;
  }

  const statusCode = err.statusCode ?? 500;
  const message = err.message ?? 'Internal Server Error';

  res.status(statusCode).json({
    error: {
      message,
      ...(process.env['NODE_ENV'] !== 'production' && { stack: err.stack }),
    },
  });
}
