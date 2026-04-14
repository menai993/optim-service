// src/api/server.ts
// Express application setup

import express from 'express';
import { healthRouter } from './routes/health';
import { analyzeRouter } from './routes/analyze';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';

export function createApp() {
  const app = express();

  app.use(express.json({ limit: '10mb' }));
  app.use(requestLogger);

  // Routes
  app.use(healthRouter);
  app.use(analyzeRouter);

  // Error handler must be registered last
  app.use(errorHandler);

  return app;
}
