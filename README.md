# optim-service

AI-powered database and backend optimization service that analyzes SQL schemas, backend code, and slow query logs, then produces prioritized, actionable recommendations. It uses a multi-agent architecture where specialist LLMs debate findings before a final orchestrator merges and ranks them. The output is a scored report with quick wins, complex bets, and implementation ordering that respects dependency chains.

---

## Architecture

```
                        +---------------------+
                        |   POST /api/analyze  |    Express API / Library
                        +----------+----------+
                                   |
                        +----------v----------+
                        |    Ingestion Layer   |    sqlParser, codeParser, metricsParser
                        +----------+----------+
                                   |
                        +----------v----------+
                        |   Context Builder    |    LLM: builds AppContext (hot tables,
                        |                      |    traffic profile, critical paths)
                        +----------+----------+
                                   |
                     +-------------+-------------+
                     |                           |
              +------v------+            +-------v-------+
              | SQL Specialist|          | Backend Specialist|   LLM agents (parallel)
              +------+------+            +-------+-------+
                     |                           |
                     +-------------+-------------+
                                   |
                        +----------v----------+
                        |  Discussion Protocol |    Multi-round reaction + resolution
                        +----------+----------+
                                   |
                        +----------v----------+
                        |    Orchestrator      |    LLM: dedup, merge, assign deps
                        +----------+----------+
                                   |
                        +----------v----------+
                        |   Scoring Engine     |    Effort/impact rubric, ROI, topo sort
                        +----------+----------+
                                   |
                        +----------v----------+
                        |  Report Generator    |    JSON / Markdown output
                        +---------------------+
```

---

## Project Structure

```
src/
  types/           Shared TypeScript types (ingestion, agents, scoring, report, validators)
  ingestion/       Parsers: SQL schemas, TypeScript/JS code patterns, pg_stat_statements JSON
  agents/          LLM agents: contextBuilder, sqlSpecialist, backendSpecialist, orchestrator
  discussion/      Multi-agent protocol: prompts.ts (templates), protocol.ts (runner)
  scoring/         Deterministic rubric (effort 1-5, impact 1-5) and scoring engine
  reports/         Report generator and Markdown/JSON formatters
  api/             Express server, routes (/api/analyze, /health), middleware
  pipeline.ts      End-to-end orchestration (usable as a library)
  index.ts         Entry point (starts HTTP server)

tests/
  fixtures/        sample.sql, sample_slow_queries.json, sample_backend.ts
  unit/            Unit tests for parsers and scoring engine
  integration/     Full pipeline test with mocked LLM
```

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy env and add your Anthropic API key
cp .env.example .env
# Edit .env → ANTHROPIC_API_KEY=sk-ant-...

# 3. Run in development mode (hot reload)
npm run dev

# 4. Build and start for production
npm run build
npm start
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | — | Anthropic API key for Claude |
| `PORT` | No | `3000` | HTTP server port |
| `NODE_ENV` | No | — | Set to `production` to hide stack traces in errors |

---

## API Documentation

### `GET /health`

```json
{ "status": "ok", "version": "0.1.0" }
```

### `POST /api/analyze`

Analyze SQL schemas, backend code, and metrics to produce an optimization report.

**Request body:**

```json
{
  "files": [
    { "filename": "schema.sql", "content": "CREATE TABLE users (...)" },
    { "filename": "service.ts", "content": "export class OrderService { ... }" },
    { "filename": "slow_queries.json", "content": "{ \"pg_stat_statements\": [...] }" }
  ],
  "metadata": {
    "framework": "express",
    "orm": "typeorm",
    "dbEngine": "postgresql",
    "trafficProfile": "read_heavy",
    "description": "E-commerce order management API"
  },
  "mode": "combined",
  "outputFormat": "json",
  "discussionRounds": 2
}
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `files` | `{filename, content}[]` | Yes | — | Files to analyze |
| `metadata.framework` | string | No | — | Backend framework (express, fastify, etc.) |
| `metadata.orm` | string | No | — | ORM in use (typeorm, prisma, sequelize, etc.) |
| `metadata.dbEngine` | `postgresql\|mysql\|mssql\|sqlite` | No | — | Database engine |
| `metadata.trafficProfile` | `read_heavy\|write_heavy\|balanced` | No | — | Traffic pattern hint |
| `metadata.description` | string | No | — | App description |
| `mode` | `combined\|sql_only\|backend_only` | No | `combined` | Filter findings by layer |
| `outputFormat` | `json\|markdown` | No | `json` | Response format |
| `discussionRounds` | `1-3` | No | `2` | Number of inter-agent discussion rounds |

**Response (200):**

```json
{
  "id": "a1b2c3d4-...",
  "generatedAt": "2026-04-14T10:30:00.000Z",
  "mode": "combined",
  "appSummary": "E-commerce order management app...",
  "totalFindings": 8,
  "criticalFindings": 3,
  "recommendations": [
    {
      "finding": {
        "id": "...",
        "layer": "sql",
        "severity": "critical",
        "title": "Missing index on orders.user_id",
        "description": "...",
        "affectedArtifacts": ["orders"],
        "suggestedFix": "CREATE INDEX ...",
        "sqlExample": "BEFORE: ...\nAFTER: ...",
        "dependsOn": [],
        "blocks": ["..."],
        "confidence": 0.97,
        "agentSource": "sql_specialist"
      },
      "effort": { "value": 1, "label": "Trivial", "reasoning": "Single index change" },
      "impact": { "value": 5, "label": "Critical", "reasoning": "..." },
      "roi": 5,
      "implementationOrder": 1,
      "estimatedQuerySpeedup": "50-80% query time reduction"
    }
  ],
  "quickWins": [ "..." ],
  "complexBets": [ "..." ],
  "discussionRounds": [ "..." ],
  "rawFindings": [ "..." ]
}
```

**Error responses:**

- `400` — Zod validation error with `{ error: { message, details } }`
- `500` — Agent failure with `{ error: { message, agentId } }`

---

## Using as a Library

```typescript
import { runAnalysisPipeline } from './src/pipeline';

const report = await runAnalysisPipeline(
  [
    { filename: 'schema.sql', content: sqlContent },
    { filename: 'service.ts', content: codeContent },
    { filename: 'metrics.json', content: metricsJson },
  ],
  {
    mode: 'combined',
    metadata: { dbEngine: 'postgresql', orm: 'typeorm' },
    discussionRounds: 2,
  },
);

console.log(`Found ${report.totalFindings} issues, ${report.criticalFindings} critical`);
console.log(`Quick wins: ${report.quickWins.length}`);
```

---

## Supported Input Files

Files are routed by extension:

| Extension | Parser | What it extracts |
|---|---|---|
| `.sql` | `sqlParser` | CREATE TABLE (columns, PK, FK), CREATE INDEX, slow query logs |
| `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs` | `codeParser` | File type, language, 7 anti-pattern detectors |
| `.py`, `.java`, `.cs`, `.go` | `codeParser` | Same pattern detection (language-aware) |
| `.json` | `metricsParser` | pg_stat_statements format or generic `{duration_ms, query, calls}` arrays |

### Naming Conventions

- SQL schema files: `schema.sql`, `migrations/*.sql`
- Slow query logs: `slow_queries.json`, `pg_stat.json`
- Code files: use standard extensions (`.ts`, `.js`, `.py`, etc.)

---

## Scoring Rubric

### Effort (1-5)

| Score | Label | Examples |
|---|---|---|
| 1 | Trivial | Add/drop a single index, one-line code change, query hint |
| 2 | Small | Rewrite a single query, add cache to one function, toggle eager/lazy |
| 3 | Moderate | Refactor a service method, add pagination, covering index + migration |
| 4 | Significant | Multi-table schema migration, extract a new service, restructure query pattern |
| 5 | Major | Cross-service architectural change, data model redesign, new caching tier |

### Impact (1-5)

Base value comes from finding severity (`critical`=5, `high`=4, `medium`=3, `low`=2), then adjusted:

- **+1** if the finding affects a hot table (from `AppContext.hotTables`)
- **+1** if the finding is on a critical path (from `AppContext.criticalPaths`)
- **-1** if all affected artifacts are cold/secondary tables
- Clamped to 1-5

### ROI and Quick Wins

- **ROI** = `impact.value / effort.value` (higher is better)
- **Quick wins**: ROI >= 2.5 AND effort <= 2
- **Complex bets**: effort >= 4
- **Implementation order**: topological sort respecting `dependsOn` chains

---

## Adding a New Pattern Detector

Pattern detectors live in `src/ingestion/codeParser.ts`. To add a new one:

1. Add the pattern type to `PatternType` in `src/types/ingestion.ts`:

```typescript
export type PatternType =
  | 'n_plus_one'
  | 'missing_cache'
  // ... existing patterns
  | 'your_new_pattern';
```

2. Write a detector function in `codeParser.ts`:

```typescript
function detectYourNewPattern(lines: string[]): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/* your condition */) {
      patterns.push({
        type: 'your_new_pattern',
        lineRange: [i + 1, i + 1],
        description: 'Description of the issue',
        confidence: 0.8,
      });
    }
  }
  return patterns;
}
```

3. Register it in the `detectPatterns` function's detector array:

```typescript
const detectors: Array<(lines: string[]) => DetectedPattern[]> = [
  detectNPlusOne,
  // ... existing detectors
  detectYourNewPattern,
];
```

4. Add test cases in `tests/unit/ingestion/codeParser.test.ts`.

---

## Running Tests

```bash
npm test                  # All tests
npm run test:unit         # Unit tests only
npm run test:integration  # Integration tests only
```

---

## Linting & Formatting

```bash
npm run lint
npm run lint:fix
npm run format
```

---

## License

MIT