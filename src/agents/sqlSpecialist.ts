// src/agents/sqlSpecialist.ts
// SQL-focused LLM agent: analyses schema, indexes, and slow queries

import Anthropic from '@anthropic-ai/sdk';
import { AppContext } from '../types/ingestion';
import { Finding } from '../types/agents';
import { SQL_SPECIALIST_SYSTEM_PROMPT } from '../discussion/prompts';

/**
 * Run the SQL Specialist agent against the provided AppContext and return
 * an array of Findings.
 */
export async function runSqlSpecialist(
  client: Anthropic,
  context: AppContext,
  model: string = 'claude-3-5-sonnet-20241022',
): Promise<Finding[]> {
  const userMessage = buildUserMessage(context);

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: SQL_SPECIALIST_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('\n');

  return parseFindings(text, 'sql-specialist');
}

function buildUserMessage(context: AppContext): string {
  const parts: string[] = ['Analyse the following database schema and query data for optimisation opportunities.'];

  for (const artifact of context.sqlArtifacts) {
    parts.push(`\n--- Schema: ${artifact.sourceFile} ---`);
    for (const table of artifact.tables) {
      parts.push(table.ddl);
    }
    for (const index of artifact.indexes) {
      parts.push(index.ddl);
    }
    for (const sq of artifact.slowQueries) {
      parts.push(`\nSlow query (${sq.durationMs}ms):\n${sq.query}`);
      if (sq.explainOutput) {
        parts.push(`EXPLAIN:\n${sq.explainOutput}`);
      }
    }
  }

  return parts.join('\n');
}

function parseFindings(text: string, _source: string): Finding[] {
  // Stub: return raw text as a single finding for wiring purposes.
  // A real implementation would parse structured JSON from the LLM response.
  return [
    {
      id: `sql-${Date.now()}`,
      title: 'SQL Specialist Analysis',
      description: text,
      layer: 'query',
    },
  ];
}
