// src/agents/backendSpecialist.ts
// Backend-focused LLM agent: analyses application code for ORM misuse,
// N+1 queries, missing caches, etc.

import Anthropic from '@anthropic-ai/sdk';
import { AppContext } from '../types/ingestion';
import { Finding } from '../types/agents';
import { BACKEND_SPECIALIST_SYSTEM_PROMPT } from '../discussion/prompts';

/**
 * Run the Backend Specialist agent against the provided AppContext and
 * return an array of Findings.
 */
export async function runBackendSpecialist(
  client: Anthropic,
  context: AppContext,
  model: string = 'claude-3-5-sonnet-20241022',
): Promise<Finding[]> {
  const userMessage = buildUserMessage(context);

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: BACKEND_SPECIALIST_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('\n');

  return parseFindings(text);
}

function buildUserMessage(context: AppContext): string {
  const parts: string[] = ['Analyse the following backend source files for performance and optimisation issues.'];

  for (const artifact of context.codeArtifacts) {
    parts.push(`\n--- File: ${artifact.sourceFile} ---`);
    parts.push(`Exports: ${artifact.exports.join(', ')}`);

    if (artifact.queryPatterns.length > 0) {
      parts.push('Detected query patterns:');
      for (const p of artifact.queryPatterns) {
        parts.push(`  Line ${p.line} [${p.classification}]: ${p.snippet}`);
      }
    }

    if (artifact.ormCalls.length > 0) {
      parts.push('ORM calls:');
      for (const c of artifact.ormCalls) {
        parts.push(`  Line ${c.line} [${c.orm}]: ${c.callSite}`);
      }
    }
  }

  return parts.join('\n');
}

function parseFindings(text: string): Finding[] {
  // Stub: return raw text as a single finding for wiring purposes.
  return [
    {
      id: `backend-${Date.now()}`,
      title: 'Backend Specialist Analysis',
      description: text,
      layer: 'application',
    },
  ];
}
