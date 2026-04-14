// src/ingestion/metricsParser.ts
// Parses query metrics JSON into normalized SlowQuery records

import { z } from 'zod';
import { SlowQuery } from '../types/ingestion';

/**
 * Zod schema for a single metrics entry (accepts multiple field names).
 */
const MetricsEntrySchema = z.object({
  query: z.string(),
  duration_ms: z.number().optional(),
  durationMs: z.number().optional(),
  total_exec_time: z.number().optional(),
  total_time: z.number().optional(),
  mean_exec_time: z.number().optional(),
  mean_time: z.number().optional(),
  calls: z.number().optional(),
  explain: z.string().optional(),
  explainOutput: z.string().optional(),
});

const MetricsArraySchema = z.array(MetricsEntrySchema);

/**
 * Parse pg_stat_statements JSON or a generic slow-query JSON array into SlowQuery[].
 *
 * Accepts `unknown` — validates with Zod before processing.
 */
export function parseMetricsJson(json: unknown): SlowQuery[] {
  const parsed = MetricsArraySchema.parse(json);

  return parsed.map((entry) => {
    const duration_ms =
      entry.duration_ms ??
      entry.durationMs ??
      entry.mean_exec_time ??
      entry.mean_time ??
      entry.total_exec_time ??
      entry.total_time ??
      0;

    return {
      duration_ms,
      query: entry.query,
      calls: entry.calls ?? 1,
      explainOutput: entry.explain ?? entry.explainOutput,
    };
  });
}
