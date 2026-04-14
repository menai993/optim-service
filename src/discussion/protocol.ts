// src/discussion/protocol.ts
// DiscussionMessage schema, discussion runner, and round manager

import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { AppContext } from '../types/ingestion';
import { Finding, DiscussionRound, AgentMessage } from '../types/agents';
import { ORCHESTRATOR_SYSTEM_PROMPT, DISCUSSION_ROUND_PROMPT } from './prompts';

// ---------------------------------------------------------------------------
// Zod schema for a single Finding returned from the LLM
// ---------------------------------------------------------------------------

export const FindingSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  layer: z.enum(['schema', 'index', 'query', 'application', 'caching', 'orm', 'general']),
  snippet: z.string().optional(),
  sourceFile: z.string().optional(),
  lines: z.array(z.number()).optional(),
});

export const DiscussionMessageSchema = z.object({
  role: z.enum(['sql-specialist', 'backend-specialist', 'orchestrator']),
  content: z.string(),
  round: z.number().int().nonnegative(),
});

export type ValidatedFinding = z.infer<typeof FindingSchema>;

export interface DiscussionOptions {
  model: string;
  rounds: number;
}

/**
 * Run a structured multi-round discussion between the LLM agents and
 * return all DiscussionRound records.
 */
export async function runDiscussion(
  client: Anthropic,
  _context: AppContext,
  initialFindings: Finding[],
  options: DiscussionOptions,
): Promise<DiscussionRound[]> {
  const rounds: DiscussionRound[] = [];
  let currentFindings = initialFindings;
  const conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (let i = 0; i < options.rounds; i++) {
    const userContent = buildRoundUserMessage(currentFindings, i);
    conversationHistory.push({ role: 'user', content: userContent });

    const response = await client.messages.create({
      model: options.model,
      max_tokens: 4096,
      system: ORCHESTRATOR_SYSTEM_PROMPT,
      messages: conversationHistory,
    });

    const assistantText = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('\n');

    conversationHistory.push({ role: 'assistant', content: assistantText });

    const roundFindings = extractFindingsFromText(assistantText) ?? currentFindings;

    const messages: AgentMessage[] = [
      {
        role: 'orchestrator',
        content: assistantText,
        timestamp: new Date().toISOString(),
        round: i,
      },
    ];

    rounds.push({ roundIndex: i, messages, findings: roundFindings });
    currentFindings = roundFindings;
  }

  return rounds;
}

/**
 * Build the user-turn message for a given discussion round.
 */
function buildRoundUserMessage(findings: Finding[], round: number): string {
  if (round === 0) {
    return (
      'Here are the initial findings from the SQL and backend specialists:\n\n' +
      JSON.stringify(findings, null, 2) +
      '\n\nPlease synthesise and prioritise these findings.'
    );
  }
  return DISCUSSION_ROUND_PROMPT + '\n\nCurrent findings:\n' + JSON.stringify(findings, null, 2);
}

/**
 * Attempt to parse a JSON findings array from LLM response text.
 * Returns null if parsing fails.
 */
export function extractFindingsFromText(text: string): Finding[] | null {
  // Try to find a JSON array in the text
  const jsonArrayMatch = /\[[\s\S]*\]/.exec(text);
  if (jsonArrayMatch) {
    try {
      const parsed: unknown = JSON.parse(jsonArrayMatch[0]);
      if (Array.isArray(parsed)) {
        const validated = parsed
          .map((item) => FindingSchema.safeParse(item))
          .filter((r) => r.success)
          .map((r) => (r as { success: true; data: ValidatedFinding }).data);
        if (validated.length > 0) return validated;
      }
    } catch {
      // Fall through
    }
  }

  // Try synthesisedFindings key
  const objMatch = /\{[\s\S]*\}/.exec(text);
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]) as Record<string, unknown>;
      const arr = parsed['synthesisedFindings'];
      if (Array.isArray(arr)) {
        const validated = arr
          .map((item) => FindingSchema.safeParse(item))
          .filter((r) => r.success)
          .map((r) => (r as { success: true; data: ValidatedFinding }).data);
        if (validated.length > 0) return validated;
      }
    } catch {
      // Fall through
    }
  }

  return null;
}
