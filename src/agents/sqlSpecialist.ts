// src/agents/sqlSpecialist.ts
// SQL-focused LLM agent: analyses schema, indexes, and slow queries

import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { AppContextInput } from '../types/ingestion';
import { AppContext, Finding } from '../types/agents';
import { FindingSchema } from '../types/validators';
import { SQL_SPECIALIST_SYSTEM_PROMPT } from '../discussion/prompts';
import { z } from 'zod';

// ── Error type ────────────────────────────────────────────────────────────────

export class AgentError extends Error {
  constructor(
    message: string,
    public readonly agentId: string = 'sql_specialist',
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

// ── Relaxed Zod schema for LLM output (id/layer/agentSource overridden) ──────

const LlmFindingSchema = FindingSchema.extend({
  id: z.string(), // LLM may not produce a valid UUID; we replace it
  layer: z.string(), // we force 'sql'
  agentSource: z.string(), // we force 'sql_specialist'
}).passthrough();

const LlmFindingsArraySchema = z.array(LlmFindingSchema);

// ── Public API ────────────────────────────────────────────────────────────────

const client = new Anthropic();

/**
 * Run the SQL Specialist agent and return validated Finding[].
 */
export async function runSqlSpecialist(
  input: AppContextInput,
  context: AppContext,
): Promise<Finding[]> {
  const userMessage = formatUserMessage(input, context);

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: SQL_SPECIALIST_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = extractText(response);
    return parseAndNormaliseFindings(text);
  } catch (err) {
    if (err instanceof AgentError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new AgentError(`SQL specialist failed: ${message}`);
  }
}

/**
 * Build the user message for unit-testing without LLM calls.
 */
export function formatUserMessage(
  input: AppContextInput,
  context: AppContext,
): string {
  const sections: string[] = [];

  // ── App context summary ─────────────────────────────────────────────────
  sections.push('## App context summary');
  sections.push('');
  sections.push(context.summary);
  sections.push('');
  sections.push(`**Hot tables:** ${context.hotTables.join(', ') || '(none identified)'}`);
  sections.push(`**Traffic profile:** ${context.trafficProfile}`);

  // ── Schema ──────────────────────────────────────────────────────────────
  sections.push('');
  sections.push('## Schema');
  sections.push('');

  const allTables = input.sqlArtifacts.flatMap((a) => a.parsedTables ?? []);
  if (allTables.length === 0) {
    sections.push('(no tables parsed)');
  }
  for (const table of allTables) {
    sections.push(`CREATE TABLE ${table.name} (`);
    for (const col of table.columns) {
      const nullable = col.nullable ? 'NULL' : 'NOT NULL';
      const indexed = col.hasIndex ? ' -- INDEXED' : '';
      sections.push(`  ${col.name} ${col.type} ${nullable},${indexed}`);
    }
    if (table.primaryKey.length > 0) {
      sections.push(`  PRIMARY KEY (${table.primaryKey.join(', ')})`);
    }
    for (const fk of table.foreignKeys) {
      sections.push(
        `  FOREIGN KEY (${fk.column}) REFERENCES ${fk.referencesTable}(${fk.referencesColumn})`,
      );
    }
    sections.push(');');
    if (table.estimatedRowCount != null) {
      sections.push(`-- estimated rows: ${table.estimatedRowCount}`);
    }
    sections.push('');
  }

  // ── Existing indexes ────────────────────────────────────────────────────
  sections.push('## Existing indexes');
  sections.push('');

  const allIndexes = input.sqlArtifacts.flatMap((a) => a.parsedIndexes ?? []);
  if (allIndexes.length === 0) {
    sections.push('(no indexes parsed)');
  }
  for (const idx of allIndexes) {
    const unique = idx.isUnique ? 'UNIQUE ' : '';
    sections.push(
      `${unique}INDEX ${idx.name} ON ${idx.table} (${idx.columns.join(', ')}) USING ${idx.type}${idx.sizeEstimate ? ` -- size: ${idx.sizeEstimate}` : ''}`,
    );
  }

  // ── Slow queries (top 10 by duration) ───────────────────────────────────
  sections.push('');
  sections.push('## Slow queries');
  sections.push('');

  const allSlowQueries = input.sqlArtifacts
    .flatMap((a) => a.slowQueries ?? [])
    .sort((a, b) => b.duration_ms - a.duration_ms)
    .slice(0, 10);

  if (allSlowQueries.length === 0) {
    sections.push('(no slow queries recorded)');
  }
  for (const sq of allSlowQueries) {
    sections.push(`### ${sq.duration_ms}ms (${sq.calls} calls)`);
    sections.push('```sql');
    sections.push(sq.query);
    sections.push('```');
    if (sq.explainOutput) {
      sections.push('EXPLAIN output:');
      sections.push('```');
      sections.push(sq.explainOutput);
      sections.push('```');
    }
    sections.push('');
  }

  // ── Critical paths ─────────────────────────────────────────────────────
  sections.push('## Critical paths');
  sections.push('');
  if (context.criticalPaths.length === 0) {
    sections.push('(none identified)');
  } else {
    for (const cp of context.criticalPaths) {
      sections.push(`- ${cp}`);
    }
  }

  sections.push('');
  sections.push(
    'Respond with ONLY a JSON array of Finding objects. No markdown fences, no explanation — just the raw JSON array.',
  );

  return sections.join('\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractText(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

function parseAndNormaliseFindings(text: string): Finding[] {
  const cleaned = text
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim();

  let raw: unknown;
  try {
    raw = JSON.parse(cleaned);
  } catch {
    throw new AgentError(`Failed to parse SQL specialist JSON response: ${cleaned.slice(0, 200)}`);
  }

  let parsed: z.infer<typeof LlmFindingsArraySchema>;
  try {
    parsed = LlmFindingsArraySchema.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AgentError(`SQL specialist output validation failed: ${message}`);
  }

  return parsed.map((f) => ({
    ...f,
    id: crypto.randomUUID(),
    layer: 'sql' as const,
    severity: f.severity as Finding['severity'],
    agentSource: 'sql_specialist' as const,
    dependsOn: f.dependsOn ?? [],
    blocks: f.blocks ?? [],
  }));
}
