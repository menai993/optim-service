// src/agents/orchestrator.ts
// Discussion orchestrator: runs the multi-agent discussion and synthesises findings

import Anthropic from '@anthropic-ai/sdk';
import { AppContext } from '../types/ingestion';
import { Finding, DiscussionRound, AgentMessage } from '../types/agents';
import { runDiscussion } from '../discussion/protocol';
import { runSqlSpecialist } from './sqlSpecialist';
import { runBackendSpecialist } from './backendSpecialist';

export interface OrchestratorOptions {
  model?: string;
  rounds?: number;
}

/**
 * Orchestrate the full multi-agent discussion and return all rounds plus
 * a final synthesised set of findings.
 */
export async function orchestrate(
  client: Anthropic,
  context: AppContext,
  options: OrchestratorOptions = {},
): Promise<{ rounds: DiscussionRound[]; findings: Finding[] }> {
  const model = options.model ?? 'claude-3-5-sonnet-20241022';
  const rounds = options.rounds ?? 2;

  // Phase 1: gather independent specialist findings
  const [sqlFindings, backendFindings] = await Promise.all([
    runSqlSpecialist(client, context, model),
    runBackendSpecialist(client, context, model),
  ]);

  const initialFindings = [...sqlFindings, ...backendFindings];

  // Phase 2: run structured discussion rounds
  const discussionRounds = await runDiscussion(client, context, initialFindings, { model, rounds });

  // Phase 3: synthesise final findings from the last round or initial findings
  const finalFindings =
    discussionRounds.length > 0
      ? discussionRounds[discussionRounds.length - 1].findings
      : initialFindings;

  return { rounds: discussionRounds, findings: finalFindings };
}

/**
 * Build a summary AgentMessage from a text response.
 */
export function buildAgentMessage(
  role: AgentMessage['role'],
  content: string,
  round: number,
): AgentMessage {
  return {
    role,
    content,
    timestamp: new Date().toISOString(),
    round,
  };
}
