// src/agents/backendSpecialist.ts
// Backend-focused LLM agent: analyses application code for ORM misuse,
// N+1 queries, missing caches, etc.

import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { AppContextInput, CodeArtifact } from '../types/ingestion';
import { AppContext, Finding } from '../types/agents';
import { FindingSchema } from '../types/validators';
import { BACKEND_SPECIALIST_SYSTEM_PROMPT } from '../discussion/prompts';
import { z } from 'zod';

// ── Error type ────────────────────────────────────────────────────────────────

export class AgentError extends Error {
  constructor(
    message: string,
    public readonly agentId: string = 'backend_specialist',
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

// ── Relaxed Zod schema for LLM output (id/layer/agentSource overridden) ──────

const LlmFindingSchema = FindingSchema.extend({
  id: z.string(),
  layer: z.string(),
  agentSource: z.string(),
}).passthrough();

const LlmFindingsArraySchema = z.array(LlmFindingSchema);

// ── Public API ────────────────────────────────────────────────────────────────

const MAX_RAW_SOURCE_LINES = 120;

const client = new Anthropic();

/**
 * Run the Backend Specialist agent and return validated Finding[].
 */
export async function runBackendSpecialist(
  input: AppContextInput,
  context: AppContext,
): Promise<Finding[]> {
  const userMessage = formatUserMessage(input, context);

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: BACKEND_SPECIALIST_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = extractText(response);
    return parseAndNormaliseFindings(text);
  } catch (err) {
    if (err instanceof AgentError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new AgentError(`Backend specialist failed: ${message}`);
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

  // ── App context ─────────────────────────────────────────────────────────
  sections.push('## App context');
  sections.push('');
  sections.push(context.summary);
  sections.push('');

  if (context.ormRelationships.length > 0) {
    sections.push('**ORM relationships:**');
    for (const rel of context.ormRelationships) {
      const lazy = rel.isLazyLoaded ? ' (LAZY)' : ' (EAGER)';
      sections.push(`- ${rel.entity} ${rel.relationType} ${rel.relatedEntity}${lazy}`);
    }
    sections.push('');
  }

  if (Object.keys(context.endpointQueryMap).length > 0) {
    sections.push('**Endpoint → query map:**');
    for (const [endpoint, queries] of Object.entries(context.endpointQueryMap)) {
      sections.push(`- ${endpoint}:`);
      for (const q of queries) {
        sections.push(`    - ${q}`);
      }
    }
    sections.push('');
  }

  // ── Code artifacts ──────────────────────────────────────────────────────
  sections.push('## Code artifacts');
  sections.push('');

  for (const artifact of input.codeArtifacts) {
    sections.push(`### ${artifact.filename} (type: ${artifact.type}, lang: ${artifact.language})`);

    const hasPatterns =
      artifact.detectedPatterns != null && artifact.detectedPatterns.length > 0;

    if (hasPatterns) {
      sections.push('');
      sections.push('**Detected patterns:**');
      for (const pattern of artifact.detectedPatterns!) {
        sections.push(
          `- [${pattern.type}] lines ${pattern.lineRange[0]}–${pattern.lineRange[1]}: ${pattern.description} (confidence: ${pattern.confidence})`,
        );
      }

      // Include trimmed raw source only for files with detected patterns
      sections.push('');
      sections.push('**Source (trimmed):**');
      sections.push('```' + artifact.language);
      sections.push(trimSource(artifact));
      sections.push('```');
    } else {
      sections.push('No anti-patterns detected.');
    }

    sections.push('');
  }

  // ── Hot tables ──────────────────────────────────────────────────────────
  sections.push('## Hot tables');
  sections.push('');
  if (context.hotTables.length === 0) {
    sections.push('(none identified)');
  } else {
    sections.push(
      'These tables are performance-critical — cross-reference them when assessing severity:',
    );
    for (const t of context.hotTables) {
      sections.push(`- ${t}`);
    }
  }

  sections.push('');
  sections.push(
    'Respond with ONLY a JSON array of Finding objects. No markdown fences, no explanation — just the raw JSON array.',
  );

  return sections.join('\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Trim raw source to MAX_RAW_SOURCE_LINES lines.
 */
function trimSource(artifact: CodeArtifact): string {
  const lines = artifact.rawContent.split('\n');
  if (lines.length <= MAX_RAW_SOURCE_LINES) {
    return artifact.rawContent;
  }
  return (
    lines.slice(0, MAX_RAW_SOURCE_LINES).join('\n') +
    `\n// ... (${lines.length - MAX_RAW_SOURCE_LINES} more lines trimmed)`
  );
}

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
    throw new AgentError(
      `Failed to parse backend specialist JSON response: ${cleaned.slice(0, 200)}`,
    );
  }

  let parsed: z.infer<typeof LlmFindingsArraySchema>;
  try {
    parsed = LlmFindingsArraySchema.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AgentError(`Backend specialist output validation failed: ${message}`);
  }

  return parsed.map((f) => ({
    ...f,
    id: crypto.randomUUID(),
    layer: 'backend' as const,
    severity: f.severity as Finding['severity'],
    agentSource: 'backend_specialist' as const,
    dependsOn: f.dependsOn ?? [],
    blocks: f.blocks ?? [],
  }));
}
