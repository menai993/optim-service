// src/api/routes/analyze.ts
// POST /api/analyze

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { runAnalysisPipeline } from '../../pipeline';

export const analyzeRouter = Router();

const AnalyzeBodySchema = z.object({
  files: z
    .array(
      z.object({
        filename: z.string().min(1),
        content: z.string().min(1),
      }),
    )
    .min(1),
  metadata: z
    .object({
      framework: z.string().optional(),
      orm: z.string().optional(),
      dbEngine: z.enum(['postgresql', 'mysql', 'mssql', 'sqlite']).optional(),
      trafficProfile: z.enum(['read_heavy', 'write_heavy', 'balanced']).optional(),
      description: z.string().optional(),
    })
    .optional(),
  mode: z.enum(['sql_only', 'backend_only', 'combined']).default('combined'),
  outputFormat: z.enum(['json', 'markdown']).default('json'),
  discussionRounds: z.number().int().min(1).max(3).default(2),
});

analyzeRouter.post('/api/analyze', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = AnalyzeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          message: 'Invalid request body',
          details: parsed.error.flatten(),
        },
      });
      return;
    }

    const { files, metadata, mode, outputFormat, discussionRounds } = parsed.data;

    const report = await runAnalysisPipeline(files, {
      mode,
      metadata,
      discussionRounds,
    });

    // Attach counts for logging middleware
    (res as any).__findingCount = report.totalFindings;
    (res as any).__mode = mode;

    if (outputFormat === 'markdown') {
      const { toMarkdown } = await import('../../reports/formatter');
      res.type('text/markdown').send(toMarkdown(report));
    } else {
      res.json(report);
    }
  } catch (err) {
    next(err);
  }
});
