// src/types/agents.ts
// Shared types for the multi-agent discussion layer

import { TableDefinition } from './ingestion';

export type FindingLayer = 'sql' | 'backend' | 'both';
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface Finding {
  id: string;
  layer: FindingLayer;
  severity: FindingSeverity;
  title: string;
  description: string;
  affectedArtifacts: string[];
  suggestedFix: string;
  sqlExample?: string;
  codeExample?: string;
  dependsOn: string[];
  blocks: string[];
  confidence: number;
  agentSource: 'sql_specialist' | 'backend_specialist' | 'orchestrator';
}

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  agentId: string;
  roundNumber: number;
  timestamp: string;
}

export interface ConflictItem {
  findingIdA: string;
  findingIdB: string;
  description: string;
  resolution?: string;
}

export interface DiscussionRound {
  roundNumber: number;
  sqlMessage: AgentMessage;
  backendMessage: AgentMessage;
  crossCuttingItems: string[];
  conflicts: ConflictItem[];
}

export interface OrmRelationship {
  entity: string;
  relationType: 'has_many' | 'belongs_to' | 'has_one' | 'many_to_many';
  relatedEntity: string;
  isLazyLoaded: boolean;
}

export interface AppContext {
  summary: string;
  tables: TableDefinition[];
  hotTables: string[];
  endpointQueryMap: Record<string, string[]>;
  ormRelationships: OrmRelationship[];
  trafficProfile: string;
  criticalPaths: string[];
}
