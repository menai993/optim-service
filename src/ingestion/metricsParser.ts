// src/ingestion/metricsParser.ts
// Parses query metrics, EXPLAIN output, and pg_stat_statements JSON

import { SlowQueryEntry } from '../types/ingestion';

export interface QueryMetrics {
  totalCalls: number;
  totalTimeMs: number;
  meanTimeMs: number;
  maxTimeMs: number;
  stddevTimeMs: number;
  query: string;
}

export interface ExplainNode {
  nodeType: string;
  startupCost: number;
  totalCost: number;
  planRows: number;
  actualRows?: number;
  actualTimeMs?: number;
  children: ExplainNode[];
}

/**
 * Parse a pg_stat_statements JSON dump into an array of QueryMetrics.
 *
 * @param json - Raw JSON string from pg_stat_statements
 */
export function parsePgStatStatements(json: string): QueryMetrics[] {
  const rows: Record<string, unknown>[] = JSON.parse(json);
  return rows.map((row) => ({
    totalCalls: Number(row['calls'] ?? 0),
    totalTimeMs: Number(row['total_exec_time'] ?? row['total_time'] ?? 0),
    meanTimeMs: Number(row['mean_exec_time'] ?? row['mean_time'] ?? 0),
    maxTimeMs: Number(row['max_exec_time'] ?? row['max_time'] ?? 0),
    stddevTimeMs: Number(row['stddev_exec_time'] ?? row['stddev_time'] ?? 0),
    query: String(row['query'] ?? ''),
  }));
}

/**
 * Parse a slow-query log JSON array into SlowQueryEntry records.
 *
 * @param json - Raw JSON string with an array of slow query entries
 */
export function parseSlowQueryLog(json: string): SlowQueryEntry[] {
  const rows: Record<string, unknown>[] = JSON.parse(json);
  return rows.map((row) => ({
    durationMs: Number(row['duration_ms'] ?? row['durationMs'] ?? 0),
    query: String(row['query'] ?? ''),
    explainOutput: row['explain'] != null ? String(row['explain']) : undefined,
  }));
}

/**
 * Parse a PostgreSQL EXPLAIN (FORMAT JSON) output into an ExplainNode tree.
 *
 * @param json - EXPLAIN JSON string
 */
export function parseExplainOutput(json: string): ExplainNode {
  const parsed: unknown[] = JSON.parse(json);
  const plan = (parsed[0] as Record<string, unknown>)['Plan'] as Record<string, unknown>;
  return mapPlanNode(plan);
}

function mapPlanNode(node: Record<string, unknown>): ExplainNode {
  const children = Array.isArray(node['Plans'])
    ? (node['Plans'] as Record<string, unknown>[]).map(mapPlanNode)
    : [];

  return {
    nodeType: String(node['Node Type'] ?? ''),
    startupCost: Number(node['Startup Cost'] ?? 0),
    totalCost: Number(node['Total Cost'] ?? 0),
    planRows: Number(node['Plan Rows'] ?? 0),
    actualRows: node['Actual Rows'] != null ? Number(node['Actual Rows']) : undefined,
    actualTimeMs: node['Actual Total Time'] != null ? Number(node['Actual Total Time']) : undefined,
    children,
  };
}
