// src/agents/contextBuilder.ts
// Builds an AppContext by sending ingested artifacts to Claude for analysis

import Anthropic from '@anthropic-ai/sdk';
import { AppContextInput, SqlArtifact, CodeArtifact } from '../types/ingestion';
import { AppContext } from '../types/agents';
import { AppContextSchema } from '../types/validators';
import { CONTEXT_BUILDER_SYSTEM_PROMPT } from '../discussion/prompts';

const client = new Anthropic();

/**
 * Build a text prompt from the ingested input, suitable for the LLM user message.
 * Serialises structured data (no raw file content) to keep tokens manageable.
 */
export function buildContextPromptContent(input: AppContextInput): string {
  const sections: string[] = [];

  // ── SQL Artifacts ────────────────────────────────────────────────────────
  const sqlArtifacts = input.sqlArtifacts;
  if (sqlArtifacts.length > 0) {
    sections.push('=== SQL ARTIFACTS ===');
    for (const artifact of sqlArtifacts) {
      sections.push(`\n--- ${artifact.filename} (type: ${artifact.type}) ---`);

      if (artifact.parsedTables && artifact.parsedTables.length > 0) {
        sections.push('\nTables:');
        for (const table of artifact.parsedTables) {
          sections.push(`  TABLE ${table.name}`);
          sections.push(`    Primary Key: [${table.primaryKey.join(', ')}]`);
          sections.push('    Columns:');
          for (const col of table.columns) {
            const flags = [
              col.nullable ? 'NULL' : 'NOT NULL',
              col.hasIndex ? 'INDEXED' : '',
            ]
              .filter(Boolean)
              .join(', ');
            sections.push(`      - ${col.name} ${col.type} (${flags})`);
          }
          if (table.foreignKeys.length > 0) {
            sections.push('    Foreign Keys:');
            for (const fk of table.foreignKeys) {
              sections.push(
                `      - ${fk.column} -> ${fk.referencesTable}(${fk.referencesColumn})`,
              );
            }
          }
          if (table.estimatedRowCount != null) {
            sections.push(`    Estimated Rows: ${table.estimatedRowCount}`);
          }
        }
      }

      if (artifact.parsedIndexes && artifact.parsedIndexes.length > 0) {
        sections.push('\nIndexes:');
        for (const idx of artifact.parsedIndexes) {
          const unique = idx.isUnique ? 'UNIQUE ' : '';
          sections.push(
            `  ${unique}INDEX ${idx.name} ON ${idx.table} (${idx.columns.join(', ')}) [${idx.type}]`,
          );
        }
      }

      if (artifact.slowQueries && artifact.slowQueries.length > 0) {
        sections.push('\nSlow Queries:');
        for (const sq of artifact.slowQueries) {
          sections.push(`  Duration: ${sq.duration_ms}ms | Calls: ${sq.calls}`);
          sections.push(`  Query: ${sq.query}`);
          if (sq.explainOutput) {
            sections.push(`  EXPLAIN:\n    ${sq.explainOutput.replace(/\n/g, '\n    ')}`);
          }
          sections.push('');
        }
      }

      // For explain_plan type, include raw content
      if (artifact.type === 'explain_plan') {
        sections.push(`\nEXPLAIN Plan:\n  ${artifact.rawContent.replace(/\n/g, '\n  ')}`);
      }
    }
  }

  // ── Code Artifacts ───────────────────────────────────────────────────────
  const codeArtifacts = input.codeArtifacts;
  if (codeArtifacts.length > 0) {
    sections.push('\n=== CODE ARTIFACTS ===');
    for (const artifact of codeArtifacts) {
      sections.push(
        `\n--- ${artifact.filename} (type: ${artifact.type}, lang: ${artifact.language}) ---`,
      );

      if (artifact.detectedPatterns && artifact.detectedPatterns.length > 0) {
        sections.push('  Detected Patterns:');
        for (const pattern of artifact.detectedPatterns) {
          sections.push(
            `    - [${pattern.type}] lines ${pattern.lineRange[0]}–${pattern.lineRange[1]}: ${pattern.description} (confidence: ${pattern.confidence})`,
          );
        }
      } else {
        sections.push('  No anti-patterns detected.');
      }
    }
  }

  // ── Metadata ─────────────────────────────────────────────────────────────
  if (input.metadata) {
    sections.push('\n=== METADATA ===');
    const m = input.metadata;
    if (m.framework) sections.push(`Framework: ${m.framework}`);
    if (m.orm) sections.push(`ORM: ${m.orm}`);
    if (m.dbEngine) sections.push(`Database Engine: ${m.dbEngine}`);
    if (m.trafficProfile) sections.push(`Traffic Profile: ${m.trafficProfile}`);
    if (m.description) sections.push(`Description: ${m.description}`);
  }

  return sections.join('\n');
}

/**
 * Call Claude to analyze the ingested artifacts and produce an AppContext.
 * Retries once with a corrective message if JSON parsing fails.
 */
export async function buildContext(input: AppContextInput): Promise<AppContext> {
  const userContent = buildContextPromptContent(input);

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userContent },
  ];

  // First attempt
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: CONTEXT_BUILDER_SYSTEM_PROMPT,
    messages,
  });

  const firstText = extractText(response);
  const firstResult = tryParseAppContext(firstText);
  if (firstResult.success) {
    return firstResult.data;
  }

  // Retry with corrective follow-up
  messages.push({ role: 'assistant', content: firstText });
  messages.push({
    role: 'user',
    content: `Your previous response was not valid JSON or did not match the required AppContext schema.\nParse error: ${firstResult.error}\n\nPlease fix the JSON and return ONLY the corrected JSON object with keys: summary, tables, hotTables, endpointQueryMap, ormRelationships, trafficProfile, criticalPaths.`,
  });

  const retryResponse = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: CONTEXT_BUILDER_SYSTEM_PROMPT,
    messages,
  });

  const retryText = extractText(retryResponse);
  const retryResult = tryParseAppContext(retryText);
  if (retryResult.success) {
    return retryResult.data;
  }

  throw new Error(
    `Failed to build AppContext after retry. Last error: ${retryResult.error}`,
  );
}

/**
 * Extract text content from an Anthropic response.
 */
function extractText(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

/**
 * Try to parse and validate a JSON string as AppContext.
 */
function tryParseAppContext(
  text: string,
): { success: true; data: AppContext } | { success: false; error: string } {
  try {
    // Strip markdown fences if present
    const cleaned = text
      .replace(/^```(?:json)?\s*/m, '')
      .replace(/\s*```\s*$/m, '')
      .trim();

    const parsed = JSON.parse(cleaned);
    const validated = AppContextSchema.parse(parsed);
    return { success: true, data: validated as AppContext };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
