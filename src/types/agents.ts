// src/types/agents.ts
// Shared types for the multi-agent discussion layer

export type AgentRole = 'sql-specialist' | 'backend-specialist' | 'orchestrator';

export interface AgentMessage {
  role: AgentRole;
  content: string;
  /** ISO timestamp */
  timestamp: string;
  /** Zero-based round index */
  round: number;
}

export interface Finding {
  id: string;
  /** Short human-readable title */
  title: string;
  /** Detailed description of the issue */
  description: string;
  layer: FindingLayer;
  /** Relevant code or SQL snippet, if any */
  snippet?: string;
  /** Source file where the issue was detected */
  sourceFile?: string;
  /** Line number(s) of the issue */
  lines?: number[];
}

export type FindingLayer =
  | 'schema'
  | 'index'
  | 'query'
  | 'application'
  | 'caching'
  | 'orm'
  | 'general';

export interface DiscussionRound {
  roundIndex: number;
  messages: AgentMessage[];
  /** Findings synthesised at the end of this round */
  findings: Finding[];
}
