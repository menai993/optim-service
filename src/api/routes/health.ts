// src/api/routes/health.ts
// GET /health

import { Router, Request, Response } from 'express';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let version = 'unknown';
try {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../../package.json'), 'utf-8'));
  version = pkg.version;
} catch {
  // Ignore — version stays 'unknown'
}

export const healthRouter = Router();

healthRouter.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', version });
});
