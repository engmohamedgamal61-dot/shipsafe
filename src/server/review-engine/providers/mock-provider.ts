import type { AgentReviewOutput, ProviderFinding } from "@/domain/schemas";
import { parseUnifiedDiff, type DiffFile } from "../diff";
import type { ReviewContext } from "../types";
import type { AgentReviewInput, AgentReviewResult, AIProvider } from "./provider";

/**
 * Deterministic, heuristic-based `AIProvider`. Every finding it returns
 * is computed from the actual diff it's given — this is a real (if
 * simple) static-analysis rule engine, not a fixture. It's what backs
 * both local development and the demo review, and it's what
 * `AnthropicProvider` (Phase 2) will be a drop-in replacement for.
 */
export class MockAIProvider implements AIProvider {
  async review(input: AgentReviewInput): Promise<AgentReviewResult> {
    const startedAt = Date.now();
    const files = parseUnifiedDiff(input.context.diffText);

    const output = ((): AgentReviewOutput => {
      switch (input.reviewer) {
        case "code":
          return reviewCode(files, input.context);
        case "security":
          return reviewSecurity(files);
        case "architecture":
          return reviewArchitecture(files, input.context);
        case "database":
          return reviewDatabase(files);
        case "test":
          return reviewTests(files, input.context);
      }
    })();

    return {
      output,
      metadata: {
        provider: "mock",
        model: `heuristic-${input.reviewer}-v1`,
        requestId: null,
        inputTokens: null,
        outputTokens: null,
        latencyMs: Date.now() - startedAt,
        attempt: input.attempt,
      },
    };
  }
}

function finding(partial: Omit<ProviderFinding, "filePath" | "lineStart" | "lineEnd"> & {
  filePath?: string | null;
  lineStart?: number | null;
  lineEnd?: number | null;
}): ProviderFinding {
  return {
    filePath: partial.filePath ?? null,
    lineStart: partial.lineStart ?? null,
    lineEnd: partial.lineEnd ?? null,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Code Reviewer — correctness, logic, swallowed errors, sloppy patterns.
// ---------------------------------------------------------------------------

function reviewCode(files: DiffFile[], context: ReviewContext): AgentReviewOutput {
  const findings: ProviderFinding[] = [];

  for (const file of files) {
    if (isTestFile(file.path) || isMigrationFile(file.path)) continue;

    for (const line of file.addedLines) {
      if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line.content)) {
        findings.push(
          finding({
            severity: "P1",
            title: "Empty catch block swallows errors",
            description:
              "This catch block discards the error silently. At minimum log it, or rethrow if the caller needs to react to it — otherwise failures here will be invisible in production.",
            category: "error-handling",
            filePath: file.path,
            lineStart: line.lineNumber,
            lineEnd: line.lineNumber,
          }),
        );
      }

      if (/console\.(log|debug)\(/.test(line.content)) {
        findings.push(
          finding({
            severity: "NIT",
            title: "Leftover console statement",
            description:
              "Looks like a debug console statement was left in. Remove it or replace it with the structured logger before merging.",
            category: "code-quality",
            filePath: file.path,
            lineStart: line.lineNumber,
            lineEnd: line.lineNumber,
          }),
        );
      }

      if (/\bTODO\b|\bFIXME\b/.test(line.content)) {
        findings.push(
          finding({
            severity: "NIT",
            title: "Unresolved TODO/FIXME introduced",
            description:
              "A TODO/FIXME was added in this PR. Either resolve it now or file a tracked issue so it doesn't get lost.",
            category: "code-quality",
            filePath: file.path,
            lineStart: line.lineNumber,
            lineEnd: line.lineNumber,
          }),
        );
      }

      const looseEquality = /[^=!]==[^=]|[^=!]!=[^=]/.exec(line.content);
      if (looseEquality && !line.content.trim().startsWith("//")) {
        findings.push(
          finding({
            severity: "P2",
            title: "Loose equality operator",
            description:
              "Use strict equality (`===`/`!==`) to avoid surprising type-coercion bugs, e.g. `0 == \"\"` being true.",
            category: "correctness",
            filePath: file.path,
            lineStart: line.lineNumber,
            lineEnd: line.lineNumber,
          }),
        );
      }
    }
  }

  const summary = findings.length
    ? `Found ${findings.length} correctness/code-quality issue(s) across ${context.changedFiles.length} changed file(s).`
    : "No correctness issues detected in the changed lines.";

  return { summary, findings };
}

// ---------------------------------------------------------------------------
// Security Reviewer — secrets, injection, XSS, dangerous eval.
// ---------------------------------------------------------------------------

const SECRET_PATTERN =
  /(api[_-]?key|secret|password|token|access[_-]?key)\s*[:=]\s*["'`][A-Za-z0-9\-_./+=]{8,}["'`]/i;

function reviewSecurity(files: DiffFile[]): AgentReviewOutput {
  const findings: ProviderFinding[] = [];

  for (const file of files) {
    for (const line of file.addedLines) {
      if (SECRET_PATTERN.test(line.content) && !/process\.env/.test(line.content)) {
        findings.push(
          finding({
            severity: "P0",
            title: "Possible hardcoded secret",
            description:
              "This line looks like it embeds a credential or key directly in source. Move it to an environment variable and rotate the exposed value if it was ever real.",
            category: "hardcoded-secret",
            filePath: file.path,
            lineStart: line.lineNumber,
            lineEnd: line.lineNumber,
          }),
        );
      }

      if (/`[^`]*\b(SELECT|INSERT|UPDATE|DELETE)\b[^`]*\$\{/i.test(line.content)) {
        findings.push(
          finding({
            severity: "P0",
            title: "SQL query built with string interpolation",
            description:
              "Interpolating a value directly into a SQL string is a SQL-injection risk. Use a parameterized query / query builder placeholder instead.",
            category: "sql-injection",
            filePath: file.path,
            lineStart: line.lineNumber,
            lineEnd: line.lineNumber,
          }),
        );
      }

      if (/\beval\s*\(/.test(line.content)) {
        findings.push(
          finding({
            severity: "P0",
            title: "Use of eval()",
            description:
              "`eval()` executes arbitrary strings as code. If any part of the input can be influenced by a user, this is a remote-code-execution risk.",
            category: "code-injection",
            filePath: file.path,
            lineStart: line.lineNumber,
            lineEnd: line.lineNumber,
          }),
        );
      }

      if (/dangerouslySetInnerHTML/.test(line.content)) {
        findings.push(
          finding({
            severity: "P1",
            title: "dangerouslySetInnerHTML without visible sanitization",
            description:
              "Rendering raw HTML opens an XSS vector unless the content is sanitized first (e.g. with DOMPurify). Confirm the source is trusted or sanitize it.",
            category: "xss",
            filePath: file.path,
            lineStart: line.lineNumber,
            lineEnd: line.lineNumber,
          }),
        );
      }
    }
  }

  const summary = findings.length
    ? `Found ${findings.length} security issue(s), including ${
        findings.filter((f) => f.severity === "P0").length
      } critical.`
    : "No security issues detected in the changed lines.";

  return { summary, findings };
}

// ---------------------------------------------------------------------------
// Architecture Reviewer — layering violations, oversized files.
// ---------------------------------------------------------------------------

const LARGE_FILE_ADDITIONS_THRESHOLD = 300;

function reviewArchitecture(files: DiffFile[], context: ReviewContext): AgentReviewOutput {
  const findings: ProviderFinding[] = [];

  for (const file of files) {
    if (file.additions > LARGE_FILE_ADDITIONS_THRESHOLD) {
      findings.push(
        finding({
          severity: "P2",
          title: "Large file change — consider splitting",
          description: `This change adds ${file.additions} lines to a single file. Large files tend to accumulate multiple responsibilities; consider whether this should be split along a clearer boundary.`,
          category: "coupling",
          filePath: file.path,
        }),
      );
    }

    const isAppLayer = file.path.startsWith("src/app/");
    for (const line of file.addedLines) {
      if (
        isAppLayer &&
        /from\s+["'].*\/(supabase|postgres)[^"']*adapter["']/.test(line.content)
      ) {
        findings.push(
          finding({
            severity: "P2",
            title: "Route/UI layer imports a concrete persistence adapter directly",
            description:
              "App Router code should depend on the repository port (`src/server/repositories`) rather than a concrete Supabase/Postgres adapter, so the data source can be swapped without touching UI/route code.",
            category: "layering-violation",
            filePath: file.path,
            lineStart: line.lineNumber,
            lineEnd: line.lineNumber,
          }),
        );
      }
    }
  }

  const summary = findings.length
    ? `Found ${findings.length} architecture concern(s) across ${context.changedFiles.length} changed file(s).`
    : "No architecture or layering concerns detected.";

  return { summary, findings };
}

// ---------------------------------------------------------------------------
// Database Reviewer — destructive migrations, locking risk.
// ---------------------------------------------------------------------------

function reviewDatabase(files: DiffFile[]): AgentReviewOutput {
  const findings: ProviderFinding[] = [];

  for (const file of files) {
    if (!isMigrationFile(file.path)) continue;

    for (const line of file.addedLines) {
      if (/drop\s+table/i.test(line.content) || /drop\s+column/i.test(line.content)) {
        findings.push(
          finding({
            severity: "P0",
            title: "Destructive schema change (DROP)",
            description:
              "This migration drops a table or column. Confirm there's a backup/backfill plan and that nothing still reads this data — a DROP is not reversible once it ships.",
            category: "destructive-migration",
            filePath: file.path,
            lineStart: line.lineNumber,
            lineEnd: line.lineNumber,
          }),
        );
      }

      if (/add\s+column/i.test(line.content) && /not\s+null/i.test(line.content) && !/default/i.test(line.content)) {
        findings.push(
          finding({
            severity: "P1",
            title: "NOT NULL column added without a DEFAULT",
            description:
              "Adding a NOT NULL column with no default will fail (or lock the table for the duration of a backfill) on a table that already has rows. Add a DEFAULT or backfill before adding the constraint.",
            category: "migration-risk",
            filePath: file.path,
            lineStart: line.lineNumber,
            lineEnd: line.lineNumber,
          }),
        );
      }

      if (/select\s+\*/i.test(line.content)) {
        findings.push(
          finding({
            severity: "P2",
            title: "SELECT * in migration/query",
            description:
              "Selecting all columns couples this query to the full table shape — a later column add/rename can silently change behavior. Select only the columns you need.",
            category: "query-quality",
            filePath: file.path,
            lineStart: line.lineNumber,
            lineEnd: line.lineNumber,
          }),
        );
      }
    }
  }

  const summary = findings.length
    ? `Found ${findings.length} database/migration risk(s).`
    : "No migration or schema risks detected.";

  return { summary, findings };
}

// ---------------------------------------------------------------------------
// Test Reviewer — missing coverage for changed source files.
// ---------------------------------------------------------------------------

function reviewTests(files: DiffFile[], context: ReviewContext): AgentReviewOutput {
  const findings: ProviderFinding[] = [];

  const testedPaths = new Set(
    files.filter((f) => isTestFile(f.path)).map((f) => testTargetPath(f.path)),
  );

  for (const file of files) {
    if (isTestFile(file.path) || isMigrationFile(file.path)) continue;
    if (!isSourceFile(file.path)) continue;
    if (file.additions < 15) continue; // small changes aren't worth flagging

    if (!testedPaths.has(file.path)) {
      findings.push(
        finding({
          severity: "P1",
          title: "Substantial change with no corresponding test update",
          description: `${file.path} changed by ${file.additions} line(s) but no test file in this PR covers it. Add or update a test so this logic has coverage.`,
          category: "missing-test",
          filePath: file.path,
        }),
      );
    }
  }

  const summary = findings.length
    ? `Found ${findings.length} file(s) with substantial changes and no matching test update.`
    : `Test coverage looks proportionate to the ${context.changedFiles.length} file(s) changed.`;

  return { summary, findings };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function isTestFile(path: string): boolean {
  return /\.(test|spec)\.[tj]sx?$/.test(path);
}

function isMigrationFile(path: string): boolean {
  return path.includes("migrations/") && path.endsWith(".sql");
}

function isSourceFile(path: string): boolean {
  return /\.[tj]sx?$/.test(path);
}

/** Maps `foo.test.ts` back to the source path it's presumed to cover: `foo.ts`. */
function testTargetPath(testPath: string): string {
  return testPath.replace(/\.(test|spec)\.([tj]sx?)$/, ".$2");
}
