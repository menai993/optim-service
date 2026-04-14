# optim-service

AI-powered database and backend optimisation service built with TypeScript, Node.js, Express, and the Anthropic Claude API.

---

## Tech Stack

| Layer | Tool |
|---|---|
| Language | TypeScript 5.x |
| Runtime | Node.js 20+ |
| HTTP API | Express 4.x |
| LLM | `@anthropic-ai/sdk` (Claude) |
| Validation | Zod |
| Testing | Jest + ts-jest |
| Dev runner | tsx |
| Lint/Format | ESLint + Prettier |

---

## Project Structure

```
src/
  types/          — shared TypeScript types (ingestion, agents, scoring, report)
  ingestion/      — parsers for SQL schemas, TypeScript code, and query metrics
  agents/         — LLM agents (SQL specialist, backend specialist, orchestrator)
  discussion/     — multi-agent discussion protocol and prompt templates
  scoring/        — effort/impact scoring rubric and engine
  reports/        — report generator and markdown/JSON formatters
  api/            — Express server, routes, and middleware
  pipeline.ts     — end-to-end orchestration
  index.ts        — entry point

tests/
  fixtures/       — sample SQL schema, slow-query log, and backend service file
  unit/           — unit tests for parsers and scoring engine
  integration/    — end-to-end pipeline test (mocked LLM)
```

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy the example env file and add your Anthropic API key
cp .env.example .env
# edit .env and set ANTHROPIC_API_KEY=sk-ant-...

# 3. Start in development mode
npm run dev

# 4. Build for production
npm run build
npm start
```

---

## API

### `GET /health`

Returns service health status.

```json
{ "status": "ok", "timestamp": "2024-01-01T00:00:00.000Z" }
```

### `POST /api/analyze`

Analyse one or more SQL / TypeScript files and return an optimisation report.

**Request body:**

```json
{
  "files": [
    {
      "filePath": "schema.sql",
      "content": "CREATE TABLE ...",
      "type": "sql"
    },
    {
      "filePath": "service.ts",
      "content": "import ...",
      "type": "typescript"
    }
  ],
  "title": "My Project Optimisation Report",
  "mode": "full",
  "rounds": 2
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `files` | array | ✅ | Array of file objects to analyse |
| `files[].filePath` | string | ✅ | Logical file path |
| `files[].content` | string | ✅ | File content |
| `files[].type` | `sql` \| `typescript` \| `javascript` \| `json` \| `unknown` | ✅ | File type |
| `title` | string | | Report title (default: "Optimization Report") |
| `mode` | `full` \| `summary` \| `json` | | Report verbosity (default: `full`) |
| `rounds` | number (1–5) | | Discussion rounds (default: `2`) |

**Response:** `OptimizationReport` JSON object with `recommendations`, `summary`, `markdown`, and `json` fields.

---

## Running Tests

```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration
```

---

## Linting & Formatting

```bash
npm run lint
npm run lint:fix
npm run format
```