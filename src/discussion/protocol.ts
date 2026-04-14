// src/discussion/protocol.ts
// Discussion runner: drives inter-agent exchange across reaction and resolution rounds

import crypto from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { Finding, AppContext, AgentMessage, ConflictItem, DiscussionRound } from '../types/agents';
import { FindingSchema } from '../types/validators';
import {
  SQL_SPECIALIST_SYSTEM_PROMPT,
  BACKEND_SPECIALIST_SYSTEM_PROMPT,
  SQL_REACTION_PROMPT_TEMPLATE,
  BACKEND_REACTION_PROMPT_TEMPLATE,
  CONFLICT_RESOLUTION_PROMPT_TEMPLATE,
} from './prompts';

// ── Config ────────────────────────────────────────────────────────────────────

export interface DiscussionConfig {
  maxRounds: number;
  conflictThreshold: number;
}

const DEFAULT_CONFIG: DiscussionConfig = {
  maxRounds: 2,
  conflictThreshold: 0.6,
};

// ── Zod schemas for LLM reaction / resolution responses ──────────────────────

const LlmFindingSchema = FindingSchema.extend({
  id: z.string(),
  layer: z.string(),
  agentSource: z.string(),
}).passthrough();

const ReactionResponseSchema = z.object({
  agreements: z.array(z.string()).default([]),
  conflicts: z
    .array(
      z.object({
        findingIdA: z.string(),
        findingIdB: z.string(),
        description: z.string(),
      }),
    )
    .default([]),
  additionalFindings: z.array(LlmFindingSchema).default([]),
});

const ResolutionEntrySchema = z.object({
  findingIdA: z.string(),
  findingIdB: z.string(),
  action: z.enum(['concede', 'maintain', 'merge']),
  resolution: z.string(),
  crossCutting: z.boolean().default(false),
});

const ResolutionResponseSchema = z.object({
  resolutions: z.array(ResolutionEntrySchema).default([]),
});

// ── Client ────────────────────────────────────────────────────────────────────

const client = new Anthropic();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run the multi-round inter-agent discussion.
 *
 * Round 1: Each agent reacts to the other's findings (parallel).
 * Round 2: Each agent resolves unresolved conflicts (parallel, if maxRounds >= 2).
 */
export async function runDiscussion(
  sqlFindings: Finding[],
  backendFindings: Finding[],
  context: AppContext,
  config?: Partial<DiscussionConfig>,
): Promise<DiscussionRound[]> {
  const cfg: DiscussionConfig = { ...DEFAULT_CONFIG, ...config };
  const rounds: DiscussionRound[] = [];

  // Mutable copies — we append additional findings per round
  let currentSqlFindings = [...sqlFindings];
  let currentBackendFindings = [...backendFindings];
  let allConflicts: ConflictItem[] = [];
  let allAgreements = new Set<string>();

  // ── Round 1: Reaction ───────────────────────────────────────────────────
  const [sqlReaction, backendReaction] = await Promise.all([
    callReaction(
      'sql_specialist',
      SQL_SPECIALIST_SYSTEM_PROMPT,
      SQL_REACTION_PROMPT_TEMPLATE(currentBackendFindings),
      context,
    ),
    callReaction(
      'backend_specialist',
      BACKEND_SPECIALIST_SYSTEM_PROMPT,
      BACKEND_REACTION_PROMPT_TEMPLATE(currentSqlFindings),
      context,
    ),
  ]);

  // Merge additional findings
  const sqlAdditional = normaliseFindings(sqlReaction.additionalFindings, 'sql', 'sql_specialist');
  const backendAdditional = normaliseFindings(
    backendReaction.additionalFindings,
    'backend',
    'backend_specialist',
  );
  currentSqlFindings = [...currentSqlFindings, ...sqlAdditional];
  currentBackendFindings = [...currentBackendFindings, ...backendAdditional];

  // Collect conflicts
  allConflicts = [...sqlReaction.conflicts, ...backendReaction.conflicts];

  // Flag low-confidence findings as conflicts
  for (const f of [...currentSqlFindings, ...currentBackendFindings]) {
    if (f.confidence < cfg.conflictThreshold) {
      const existing = allConflicts.find(
        (c) => c.findingIdA === f.id || c.findingIdB === f.id,
      );
      if (!existing) {
        allConflicts.push({
          findingIdA: f.id,
          findingIdB: f.id,
          description: `Low confidence (${f.confidence}) — flagged for review`,
        });
      }
    }
  }

  // Collect agreements
  for (const id of sqlReaction.agreements) allAgreements.add(id);
  for (const id of backendReaction.agreements) allAgreements.add(id);

  const round1SqlMsg: AgentMessage = {
    role: 'assistant',
    content: JSON.stringify(sqlReaction),
    agentId: 'sql_specialist',
    roundNumber: 1,
    timestamp: new Date().toISOString(),
  };
  const round1BackendMsg: AgentMessage = {
    role: 'assistant',
    content: JSON.stringify(backendReaction),
    agentId: 'backend_specialist',
    roundNumber: 1,
    timestamp: new Date().toISOString(),
  };

  rounds.push({
    roundNumber: 1,
    sqlMessage: round1SqlMsg,
    backendMessage: round1BackendMsg,
    crossCuttingItems: identifyCrossCuttingItems(currentSqlFindings, currentBackendFindings, allAgreements),
    conflicts: allConflicts,
  });

  // ── Round 2: Resolution (if maxRounds >= 2 and there are conflicts) ─────
  if (cfg.maxRounds >= 2 && allConflicts.length > 0) {
    const unresolvedConflicts = allConflicts.filter((c) => !c.resolution);

    if (unresolvedConflicts.length > 0) {
      const [sqlResolution, backendResolution] = await Promise.all([
        callResolution(
          'sql_specialist',
          SQL_SPECIALIST_SYSTEM_PROMPT,
          unresolvedConflicts,
          context,
        ),
        callResolution(
          'backend_specialist',
          BACKEND_SPECIALIST_SYSTEM_PROMPT,
          unresolvedConflicts,
          context,
        ),
      ]);

      // Match resolutions from both agents
      const resolvedConflicts = resolveConflicts(
        unresolvedConflicts,
        sqlResolution,
        backendResolution,
      );

      // Update the master conflict list with resolutions
      for (const resolved of resolvedConflicts.conflicts) {
        const original = allConflicts.find(
          (c) => c.findingIdA === resolved.findingIdA && c.findingIdB === resolved.findingIdB,
        );
        if (original && resolved.resolution) {
          original.resolution = resolved.resolution;
        }
      }

      // Merge cross-cutting items
      for (const id of resolvedConflicts.crossCuttingIds) {
        allAgreements.add(id);
      }

      const round2SqlMsg: AgentMessage = {
        role: 'assistant',
        content: JSON.stringify(sqlResolution),
        agentId: 'sql_specialist',
        roundNumber: 2,
        timestamp: new Date().toISOString(),
      };
      const round2BackendMsg: AgentMessage = {
        role: 'assistant',
        content: JSON.stringify(backendResolution),
        agentId: 'backend_specialist',
        roundNumber: 2,
        timestamp: new Date().toISOString(),
      };

      rounds.push({
        roundNumber: 2,
        sqlMessage: round2SqlMsg,
        backendMessage: round2BackendMsg,
        crossCuttingItems: identifyCrossCuttingItems(
          currentSqlFindings,
          currentBackendFindings,
          allAgreements,
        ),
        conflicts: allConflicts,
      });
    }
  }

  return rounds;
}

// ── LLM call helpers ──────────────────────────────────────────────────────────

type ReactionResult = z.infer<typeof ReactionResponseSchema>;
type ResolutionResult = z.infer<typeof ResolutionResponseSchema>;

async function callReaction(
  agentId: string,
  systemPrompt: string,
  userContent: string,
  context: AppContext,
): Promise<ReactionResult> {
  const contextPreamble = `App summary: ${context.summary}\nHot tables: ${context.hotTables.join(', ')}\nTraffic: ${context.trafficProfile}\n\n`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: contextPreamble + userContent }],
  });

  const text = extractText(response);
  return parseReactionResponse(text, agentId);
}

async function callResolution(
  agentId: string,
  systemPrompt: string,
  conflicts: ConflictItem[],
  context: AppContext,
): Promise<ResolutionResult> {
  const contextPreamble = `App summary: ${context.summary}\nHot tables: ${context.hotTables.join(', ')}\n\n`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: contextPreamble + CONFLICT_RESOLUTION_PROMPT_TEMPLATE(conflicts),
      },
    ],
  });

  const text = extractText(response);
  return parseResolutionResponse(text, agentId);
}

// ── Parsing helpers ───────────────────────────────────────────────────────────

function extractText(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

function cleanJson(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim();
}

function parseReactionResponse(text: string, agentId: string): ReactionResult {
  try {
    const parsed = JSON.parse(cleanJson(text));
    return ReactionResponseSchema.parse(parsed);
  } catch {
    // Return empty reaction on parse failure — don't crash the discussion
    console.warn(`[${agentId}] Failed to parse reaction response; using empty defaults`);
    return { agreements: [], conflicts: [], additionalFindings: [] };
  }
}

function parseResolutionResponse(text: string, agentId: string): ResolutionResult {
  try {
    const parsed = JSON.parse(cleanJson(text));
    return ResolutionResponseSchema.parse(parsed);
  } catch {
    console.warn(`[${agentId}] Failed to parse resolution response; using empty defaults`);
    return { resolutions: [] };
  }
}

// ── Finding normalisation ─────────────────────────────────────────────────────

function normaliseFindings(
  raw: z.infer<typeof LlmFindingSchema>[],
  layer: Finding['layer'],
  agentSource: Finding['agentSource'],
): Finding[] {
  return raw.map((f) => ({
    ...f,
    id: crypto.randomUUID(),
    layer,
    severity: f.severity as Finding['severity'],
    agentSource,
    dependsOn: f.dependsOn ?? [],
    blocks: f.blocks ?? [],
    affectedArtifacts: f.affectedArtifacts ?? [],
  }));
}

// ── Conflict resolution logic ─────────────────────────────────────────────────

function resolveConflicts(
  unresolvedConflicts: ConflictItem[],
  sqlResolution: ResolutionResult,
  backendResolution: ResolutionResult,
): { conflicts: ConflictItem[]; crossCuttingIds: string[] } {
  const crossCuttingIds: string[] = [];
  const resolved: ConflictItem[] = [];

  for (const conflict of unresolvedConflicts) {
    const sqlEntry = sqlResolution.resolutions.find(
      (r) => r.findingIdA === conflict.findingIdA && r.findingIdB === conflict.findingIdB,
    );
    const backendEntry = backendResolution.resolutions.find(
      (r) => r.findingIdA === conflict.findingIdA && r.findingIdB === conflict.findingIdB,
    );

    let resolution: string | undefined;

    if (sqlEntry && backendEntry) {
      // Both agents responded
      if (sqlEntry.action === 'concede' && backendEntry.action !== 'concede') {
        resolution = backendEntry.resolution;
      } else if (backendEntry.action === 'concede' && sqlEntry.action !== 'concede') {
        resolution = sqlEntry.resolution;
      } else if (sqlEntry.action === 'merge' || backendEntry.action === 'merge') {
        resolution = `Merged: SQL perspective — ${sqlEntry.resolution}; Backend perspective — ${backendEntry.resolution}`;
      } else {
        // Both maintain — leave for orchestrator
        resolution = undefined;
      }

      if (sqlEntry.crossCutting || backendEntry.crossCutting) {
        crossCuttingIds.push(conflict.findingIdA, conflict.findingIdB);
      }
    } else if (sqlEntry) {
      resolution = sqlEntry.resolution;
      if (sqlEntry.crossCutting) crossCuttingIds.push(conflict.findingIdA, conflict.findingIdB);
    } else if (backendEntry) {
      resolution = backendEntry.resolution;
      if (backendEntry.crossCutting) crossCuttingIds.push(conflict.findingIdA, conflict.findingIdB);
    }

    resolved.push({ ...conflict, resolution });
  }

  return { conflicts: resolved, crossCuttingIds };
}

// ── Cross-cutting identification ──────────────────────────────────────────────

/**
 * Identify finding IDs that are cross-cutting — i.e. referenced by both agents
 * or present in the agreements set.
 */
function identifyCrossCuttingItems(
  sqlFindings: Finding[],
  backendFindings: Finding[],
  agreements: Set<string>,
): string[] {
  const crossCutting = new Set<string>();

  // Anything both agents agreed on is cross-cutting
  for (const id of agreements) {
    crossCutting.add(id);
  }

  // Findings where a backend finding depends on a SQL finding (or vice versa)
  const sqlIds = new Set(sqlFindings.map((f) => f.id));
  const backendIds = new Set(backendFindings.map((f) => f.id));

  for (const f of backendFindings) {
    for (const dep of f.dependsOn) {
      if (sqlIds.has(dep)) {
        crossCutting.add(f.id);
        crossCutting.add(dep);
      }
    }
  }

  for (const f of sqlFindings) {
    for (const dep of f.dependsOn) {
      if (backendIds.has(dep)) {
        crossCutting.add(f.id);
        crossCutting.add(dep);
      }
    }
  }

  // Findings that affect the same artifacts from different layers
  const sqlArtifactMap = new Map<string, string[]>();
  for (const f of sqlFindings) {
    for (const a of f.affectedArtifacts) {
      const list = sqlArtifactMap.get(a) ?? [];
      list.push(f.id);
      sqlArtifactMap.set(a, list);
    }
  }
  for (const f of backendFindings) {
    for (const a of f.affectedArtifacts) {
      const sqlIds = sqlArtifactMap.get(a);
      if (sqlIds) {
        crossCutting.add(f.id);
        for (const id of sqlIds) crossCutting.add(id);
      }
    }
  }

  return [...crossCutting];
}
