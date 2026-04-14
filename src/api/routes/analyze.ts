// src/api/routes/analyze.ts
// POST /api/analyze

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { runPipeline } from '../../pipeline';

export const analyzeRouter = Router();

const AnalyzeBodySchema = z.object({
  /** Array of file entries to analyse */
  files: z.array(
    z.object({
      filePath: z.string().min(1),
      content: z.string().min(1),
      type: z.enum(['sql', 'typescript', 'javascript', 'json', 'unknown']).default('unknown'),
    }),
  ).min(1),
  /** Report title */
  title: z.string().optional(),
  /** Report output mode */
  mode: z.enum(['full', 'summary', 'json']).default('full'),
  /** Number of discussion rounds (1-5) */
  rounds: z.number().int().min(1).max(5).default(2),
});

analyzeRouter.post('/api/analyze', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = AnalyzeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: { message: 'Invalid request body', details: parsed.error.flatten() } });
      return;
    }

    const { files, title, mode, rounds } = parsed.data;

    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) {
      res.status(500).json({ error: { message: 'ANTHROPIC_API_KEY is not configured' } });
      return;
    }

    const client = new Anthropic({ apiKey });
    const report = await runPipeline(client, files, { title, mode, rounds });

    res.json(report);
  } catch (err) {
    next(err);
  }
});
