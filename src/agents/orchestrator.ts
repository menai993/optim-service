// src/agents/orchestrator.ts
// Final LLM call: deduplicates, merges, resolves conflicts, assigns dependency chains

import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { Finding, DiscussionRound, AppContext } from '../types/agents';
import { FindingSchema } from '../types/validators';
import { ORCHESTRATOR_SYSTEM_PROMPT } from '../discussion/prompts';

// ── Zod schema for LLM response ──────────────────────────────────────────────

const OrchestratorFindingSchema = FindingSchema.extend({
  id: z.string(),
  layer: z.string(),
  agentSource: z.string(),
}).passthrough();

const OrchestratorResponseSchema = z.array(OrchestratorFindingSchema);

// ── Client ────────────────────────────────────────────────────────────────────

const client = new Anthropic();

// ── Error class ───────────────────────────────────────────────────────────────

export class AgentError extends Error {
  constructor(
    message: string,
    public readonly agentId: string,
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function runOrchestrator(
  allFindings: Finding[],
  rounds: DiscussionRound[],
  context: AppContext,
): Promise<Finding[]> {
  const userMessage = formatUserMessage(allFindings, rounds, context);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: ORCHESTRATOR_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return parseOrchestratorResponse(text, allFindings);
}

// ── User message builder (exported for testing) ──────────────────────────────

export function formatUserMessage(
  allFindings: Finding[],
  rounds: DiscussionRound[],
  context: AppContext,
): string {
  const sqlFindings = allFindings.filter((f) => f.agentSource === 'sql_specialist');
  const backendFindings = allFindings.filter((f) => f.agentSource === 'backend_specialist');

  // Collect cross-cutting items and unresolved conflicts from all rounds
  const crossCuttingItems = new Set<string>();
  const unresolvedConflicts: Array<{ findingIdA: string; findingIdB: string; description: string }> = [];

  for (const round of rounds) {
    for (const item of round.crossCuttingItems) {
      crossCuttingItems.add(item);
    }
    for (const conflict of round.conflicts) {
      if (!conflict.resolution) {
        unresolvedConflicts.push({
          findingIdA: conflict.findingIdA,
          findingIdB: conflict.findingIdB,
          description: conflict.description,
        });
      }
    }
  }

  const sections: string[] = [];

  sections.push(`## SQL specialist findings\n\n${JSON.stringify(sqlFindings, null, 2)}`);
  sections.push(`## Backend specialist findings\n\n${JSON.stringify(backendFindings, null, 2)}`);

  sections.push(
    `## Cross-cutting items identified in discussion\n\n` +
      (crossCuttingItems.size > 0
        ? [...crossCuttingItems].map((id) => `- ${id}`).join('\n')
        : '(none)'),
  );

  sections.push(
    `## Unresolved conflicts\n\n${JSON.stringify(unresolvedConflicts, null, 2)}`,
  );

  sections.push(
    `## App context\n\n` +
      `Summary: ${context.summary}\n` +
      `Hot tables: ${context.hotTables.join(', ')}\n` +
      `Traffic profile: ${context.trafficProfile}\n` +
      `Critical paths: ${context.criticalPaths.join(', ')}`,
  );

  return sections.join('\n\n');
}

// ── Response parser ───────────────────────────────────────────────────────────

function parseOrchestratorResponse(text: string, originalFindings: Finding[]): Finding[] {
  const cleaned = text
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Retry: look for a JSON array in the text
    const match = /\[[\s\S]*\]/.exec(text);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        console.warn('[orchestrator] Failed to parse response; returning original findings');
        return originalFindings;
      }
    } else {
      console.warn('[orchestrator] No JSON array found in response; returning original findings');
      return originalFindings;
    }
  }

  const result = OrchestratorResponseSchema.safeParse(parsed);
  if (!result.success) {
    console.warn('[orchestrator] Zod validation failed; returning original findings');
    return originalFindings;
  }

  // Normalise findings
  const existingIds = new Set(originalFindings.map((f) => f.id));

  return result.data.map((f) => {
    const layer = normaliseLayer(f.layer);
    const agentSource = normaliseAgentSource(f.agentSource);
    const id = existingIds.has(f.id) ? f.id : crypto.randomUUID();

    return {
      ...f,
      id,
      layer,
      severity: f.severity as Finding['severity'],
      agentSource,
      dependsOn: f.dependsOn ?? [],
      blocks: f.blocks ?? [],
      affectedArtifacts: f.affectedArtifacts ?? [],
    };
  });
}

function normaliseLayer(layer: string): Finding['layer'] {
  if (layer === 'sql' || layer === 'backend' || layer === 'both') return layer;
  return 'both';
}

function normaliseAgentSource(source: string): Finding['agentSource'] {
  if (source === 'sql_specialist' || source === 'backend_specialist' || source === 'orchestrator') {
    return source;
  }
  return 'orchestrator';
}
