# Multi-Language Verify Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make maina's verify pipeline, slop detector, and context engine work with Python, Go, and Rust projects — not just TypeScript.

**Architecture:** A `LanguageProfile` abstraction maps each language to its tools, file patterns, and slop rules. Language detection reads project marker files (go.mod, pyproject.toml, Cargo.toml). The syntax guard, slop detector, semantic collector, and retrieval search all consume the profile instead of hardcoded TS/JS patterns. Existing TypeScript behavior is preserved as the default profile.

**Tech Stack:** Bun, TypeScript, bun:test, existing `Finding` interface, existing `Result<T>` pattern.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/core/src/language/profile.ts` | **NEW** — LanguageProfile interface + 4 built-in profiles (TS, Python, Go, Rust) |
| `packages/core/src/language/detect.ts` | **NEW** — detectLanguages() from project marker files |
| `packages/core/src/language/__tests__/profile.test.ts` | **NEW** — profile tests |
| `packages/core/src/language/__tests__/detect.test.ts` | **NEW** — detection tests |
| `packages/core/src/verify/syntax-guard.ts` | Refactor to dispatch per LanguageProfile |
| `packages/core/src/verify/linters/ruff.ts` | **NEW** — ruff JSON output parser |
| `packages/core/src/verify/linters/go-vet.ts` | **NEW** — go vet text output parser |
| `packages/core/src/verify/linters/clippy.ts` | **NEW** — clippy JSON output parser |
| `packages/core/src/verify/__tests__/linters/` | **NEW** — linter parser tests |
| `packages/core/src/verify/slop.ts` | Accept language profile for patterns |
| `packages/core/src/verify/detect.ts` | Add ruff, golangci-lint, clippy, cargo-audit |
| `packages/core/src/verify/pipeline.ts` | Auto-detect language, pass to syntax guard + slop |
| `packages/core/src/context/semantic.ts` | Dynamic file extensions from profile |
| `packages/core/src/context/retrieval.ts` | Dynamic file globs from profile |
| `packages/core/src/index.ts` | Export new public API |

---

## Part 1: Foundation — Language Profiles + Detection

### Task 1: Create LanguageProfile interface and TypeScript profile

**Files:**
- Create: `packages/core/src/language/profile.ts`
- Create: `packages/core/src/language/__tests__/profile.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/core/src/language/__tests__/profile.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import {
  getProfile,
  TYPESCRIPT_PROFILE,
  type LanguageId,
} from "../profile";

describe("LanguageProfile", () => {
  it("should return TypeScript profile by default", () => {
    const profile = getProfile("typescript");
    expect(profile.id).toBe("typescript");
    expect(profile.extensions).toContain(".ts");
    expect(profile.extensions).toContain(".tsx");
    expect(profile.syntaxTool).toBe("biome");
    expect(profile.commentPrefixes).toContain("//");
  });

  it("should return Python profile", () => {
    const profile = getProfile("python");
    expect(profile.id).toBe("python");
    expect(profile.extensions).toContain(".py");
    expect(profile.syntaxTool).toBe("ruff");
    expect(profile.commentPrefixes).toContain("#");
  });

  it("should return Go profile", () => {
    const profile = getProfile("go");
    expect(profile.id).toBe("go");
    expect(profile.extensions).toContain(".go");
    expect(profile.syntaxTool).toBe("go-vet");
    expect(profile.commentPrefixes).toContain("//");
  });

  it("should return Rust profile", () => {
    const profile = getProfile("rust");
    expect(profile.id).toBe("rust");
    expect(profile.extensions).toContain(".rs");
    expect(profile.syntaxTool).toBe("clippy");
    expect(profile.commentPrefixes).toContain("//");
  });

  it("should have test file pattern for each language", () => {
    expect(TYPESCRIPT_PROFILE.testFilePattern.test("app.test.ts")).toBe(true);
    expect(getProfile("python").testFilePattern.test("test_app.py")).toBe(true);
    expect(getProfile("go").testFilePattern.test("app_test.go")).toBe(true);
    expect(getProfile("rust").testFilePattern.test("tests/mod.rs")).toBe(true);
  });

  it("should have console/print patterns for slop detection", () => {
    expect(TYPESCRIPT_PROFILE.printPattern.test("console.log('x')")).toBe(true);
    expect(getProfile("python").printPattern.test("print('x')")).toBe(true);
    expect(getProfile("go").printPattern.test("fmt.Println(x)")).toBe(true);
    expect(getProfile("rust").printPattern.test("println!(x)")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --filter "LanguageProfile"`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement LanguageProfile**

Create `packages/core/src/language/profile.ts`:

```typescript
/**
 * Language Profiles — maps each supported language to its tools,
 * file patterns, and slop detection rules.
 */

// ─── Types ────────────────────────────────────────────────────────────────

export type LanguageId = "typescript" | "python" | "go" | "rust";

export interface LanguageProfile {
  id: LanguageId;
  displayName: string;
  extensions: string[];
  syntaxTool: string;
  syntaxArgs: (files: string[], cwd: string) => string[];
  commentPrefixes: string[];
  testFilePattern: RegExp;
  printPattern: RegExp;
  lintIgnorePattern: RegExp;
  importPattern: RegExp;
  fileGlobs: string[];
}

// ─── Profiles ─────────────────────────────────────────────────────────────

export const TYPESCRIPT_PROFILE: LanguageProfile = {
  id: "typescript",
  displayName: "TypeScript",
  extensions: [".ts", ".tsx", ".js", ".jsx"],
  syntaxTool: "biome",
  syntaxArgs: (files, _cwd) => [
    "biome", "check", "--reporter=json", "--no-errors-on-unmatched", "--colors=off", ...files,
  ],
  commentPrefixes: ["//", "/*"],
  testFilePattern: /\.(test|spec)\.[jt]sx?$/,
  printPattern: /console\.(log|warn|error|debug|info)\s*\(/,
  lintIgnorePattern: /@ts-ignore|@ts-expect-error|noinspection/,
  importPattern: /^import\s+(?:type\s+)?(?:\{[^}]+\}|\*\s+as\s+\w+|\w+)\s+from\s+["']([^"']+)["']/,
  fileGlobs: ["*.ts", "*.tsx", "*.js", "*.jsx"],
};

export const PYTHON_PROFILE: LanguageProfile = {
  id: "python",
  displayName: "Python",
  extensions: [".py", ".pyi"],
  syntaxTool: "ruff",
  syntaxArgs: (files, _cwd) => [
    "ruff", "check", "--output-format=json", ...files,
  ],
  commentPrefixes: ["#"],
  testFilePattern: /(?:^test_|_test\.py$|tests\/)/,
  printPattern: /\bprint\s*\(/,
  lintIgnorePattern: /# type:\s*ignore|# noqa|# pragma:\s*no cover/,
  importPattern: /^(?:from\s+(\S+)\s+import|import\s+(\S+))/,
  fileGlobs: ["*.py", "*.pyi"],
};

export const GO_PROFILE: LanguageProfile = {
  id: "go",
  displayName: "Go",
  extensions: [".go"],
  syntaxTool: "go-vet",
  syntaxArgs: (files, _cwd) => ["go", "vet", ...files],
  commentPrefixes: ["//"],
  testFilePattern: /_test\.go$/,
  printPattern: /fmt\.Print(?:ln|f)?\s*\(/,
  lintIgnorePattern: /\/\/\s*nolint/,
  importPattern: /^\s*"([^"]+)"/,
  fileGlobs: ["*.go"],
};

export const RUST_PROFILE: LanguageProfile = {
  id: "rust",
  displayName: "Rust",
  extensions: [".rs"],
  syntaxTool: "clippy",
  syntaxArgs: (files, _cwd) => [
    "cargo", "clippy", "--message-format=json", "--", ...files,
  ],
  commentPrefixes: ["//"],
  testFilePattern: /(?:tests\/|_test\.rs$|#\[cfg\(test\)\])/,
  printPattern: /(?:println!|print!|eprintln!|eprint!)\s*\(/,
  lintIgnorePattern: /#\[allow\(|#!\[allow\(/,
  importPattern: /^use\s+(\S+)/,
  fileGlobs: ["*.rs"],
};

// ─── Registry ─────────────────────────────────────────────────────────────

const PROFILES: Record<LanguageId, LanguageProfile> = {
  typescript: TYPESCRIPT_PROFILE,
  python: PYTHON_PROFILE,
  go: GO_PROFILE,
  rust: RUST_PROFILE,
};

/**
 * Get the language profile for a given language ID.
 */
export function getProfile(id: LanguageId): LanguageProfile {
  return PROFILES[id];
}

/**
 * Get all registered language IDs.
 */
export function getSupportedLanguages(): LanguageId[] {
  return Object.keys(PROFILES) as LanguageId[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test --filter "LanguageProfile"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/language/
bun packages/cli/dist/index.js commit -m "feat(core): add LanguageProfile abstraction for multi-language support"
```

---

### Task 2: Implement language detection from project marker files

**Files:**
- Create: `packages/core/src/language/detect.ts`
- Create: `packages/core/src/language/__tests__/detect.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/core/src/language/__tests__/detect.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectLanguages } from "../detect";

describe("detectLanguages", () => {
  const testDir = join(import.meta.dir, "__fixtures__/detect");

  function setup(files: Record<string, string>) {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
    mkdirSync(testDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(testDir, name), content);
    }
  }

  function cleanup() {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
  }

  it("should detect TypeScript from tsconfig.json", () => {
    setup({ "tsconfig.json": "{}" });
    const result = detectLanguages(testDir);
    expect(result).toContain("typescript");
    cleanup();
  });

  it("should detect Python from pyproject.toml", () => {
    setup({ "pyproject.toml": "[tool.ruff]" });
    const result = detectLanguages(testDir);
    expect(result).toContain("python");
    cleanup();
  });

  it("should detect Go from go.mod", () => {
    setup({ "go.mod": "module example.com/foo" });
    const result = detectLanguages(testDir);
    expect(result).toContain("go");
    cleanup();
  });

  it("should detect Rust from Cargo.toml", () => {
    setup({ "Cargo.toml": "[package]\nname = \"test\"" });
    const result = detectLanguages(testDir);
    expect(result).toContain("rust");
    cleanup();
  });

  it("should detect multiple languages in polyglot repo", () => {
    setup({ "tsconfig.json": "{}", "pyproject.toml": "" });
    const result = detectLanguages(testDir);
    expect(result).toContain("typescript");
    expect(result).toContain("python");
    cleanup();
  });

  it("should return empty array for unknown project", () => {
    setup({ "README.md": "hello" });
    const result = detectLanguages(testDir);
    expect(result).toHaveLength(0);
    cleanup();
  });

  it("should detect Python from requirements.txt", () => {
    setup({ "requirements.txt": "flask==2.0" });
    const result = detectLanguages(testDir);
    expect(result).toContain("python");
    cleanup();
  });

  it("should detect Python from setup.py", () => {
    setup({ "setup.py": "from setuptools import setup" });
    const result = detectLanguages(testDir);
    expect(result).toContain("python");
    cleanup();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --filter "detectLanguages"`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement detectLanguages**

Create `packages/core/src/language/detect.ts`:

```typescript
/**
 * Language Detection — detects project languages from marker files.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { LanguageId } from "./profile";

// ─── Marker Files ─────────────────────────────────────────────────────────

const LANGUAGE_MARKERS: Record<LanguageId, string[]> = {
  typescript: ["tsconfig.json", "tsconfig.build.json"],
  python: ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile"],
  go: ["go.mod", "go.sum"],
  rust: ["Cargo.toml", "Cargo.lock"],
};

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Detect languages present in a project directory by checking for marker files.
 * Returns an array of detected LanguageIds, ordered by detection priority.
 *
 * Also detects TypeScript from package.json if it has a "typescript" dependency.
 */
export function detectLanguages(cwd: string): LanguageId[] {
  const detected: LanguageId[] = [];

  for (const [lang, markers] of Object.entries(LANGUAGE_MARKERS) as [LanguageId, string[]][]) {
    for (const marker of markers) {
      if (existsSync(join(cwd, marker))) {
        detected.push(lang);
        break;
      }
    }
  }

  // Also check package.json for TypeScript dependency
  if (!detected.includes("typescript")) {
    const pkgPath = join(cwd, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(require("node:fs").readFileSync(pkgPath, "utf-8"));
        const allDeps = {
          ...pkg.dependencies,
          ...pkg.devDependencies,
        };
        if (allDeps.typescript) {
          detected.push("typescript");
        }
      } catch {
        // Malformed package.json — skip
      }
    }
  }

  return detected;
}

/**
 * Get the primary (first detected) language, or "typescript" as fallback.
 */
export function getPrimaryLanguage(cwd: string): LanguageId {
  const languages = detectLanguages(cwd);
  return languages[0] ?? "typescript";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test --filter "detectLanguages"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/language/
bun packages/cli/dist/index.js commit -m "feat(core): add language detection from project marker files"
```

---

### Task 3: Add language-specific linter tools to tool registry

**Files:**
- Modify: `packages/core/src/verify/detect.ts`
- Modify: `packages/core/src/verify/__tests__/detect.test.ts`

- [ ] **Step 1: Write failing test**

Add to `packages/core/src/verify/__tests__/detect.test.ts`:

```typescript
it("should have ruff in tool registry", () => {
  expect(TOOL_REGISTRY.ruff).toBeDefined();
  expect(TOOL_REGISTRY.ruff.command).toBe("ruff");
});

it("should have golangci-lint in tool registry", () => {
  expect(TOOL_REGISTRY["golangci-lint"]).toBeDefined();
});

it("should have cargo-clippy in tool registry", () => {
  expect(TOOL_REGISTRY["cargo-clippy"]).toBeDefined();
});

it("should have cargo-audit in tool registry", () => {
  expect(TOOL_REGISTRY["cargo-audit"]).toBeDefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --filter "detect" packages/core/src/verify/__tests__/detect.test.ts`
Expected: FAIL — ruff not in registry

- [ ] **Step 3: Add language tools to registry**

In `packages/core/src/verify/detect.ts`:

Update `ToolName` type:

```typescript
export type ToolName =
  | "biome"
  | "semgrep"
  | "trivy"
  | "secretlint"
  | "sonarqube"
  | "stryker"
  | "diff-cover"
  | "ruff"
  | "golangci-lint"
  | "cargo-clippy"
  | "cargo-audit";
```

Add to `TOOL_REGISTRY`:

```typescript
ruff: { command: "ruff", versionFlag: "--version" },
"golangci-lint": { command: "golangci-lint", versionFlag: "--version" },
"cargo-clippy": { command: "cargo", versionFlag: "clippy --version" },
"cargo-audit": { command: "cargo-audit", versionFlag: "--version" },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test --filter "detect" packages/core/src/verify/__tests__/detect.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/verify/detect.ts packages/core/src/verify/__tests__/detect.test.ts
bun packages/cli/dist/index.js commit -m "feat(core): add ruff, golangci-lint, clippy, cargo-audit to tool registry"
```

---

### Task 4: Create ruff linter output parser

**Files:**
- Create: `packages/core/src/verify/linters/ruff.ts`
- Create: `packages/core/src/verify/__tests__/linters/ruff.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/core/src/verify/__tests__/linters/ruff.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { parseRuffOutput } from "../../linters/ruff";

describe("parseRuffOutput", () => {
  it("should parse ruff JSON output into SyntaxDiagnostic[]", () => {
    const json = JSON.stringify([
      {
        code: "E501",
        message: "Line too long (120 > 88)",
        filename: "src/app.py",
        location: { row: 10, column: 1 },
        end_location: { row: 10, column: 120 },
        fix: null,
        noqa_row: 10,
      },
      {
        code: "F401",
        message: "os imported but unused",
        filename: "src/utils.py",
        location: { row: 3, column: 1 },
        end_location: { row: 3, column: 10 },
        fix: { applicability: "safe" },
        noqa_row: 3,
      },
    ]);

    const diagnostics = parseRuffOutput(json);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]?.file).toBe("src/app.py");
    expect(diagnostics[0]?.line).toBe(10);
    expect(diagnostics[0]?.severity).toBe("warning");
    expect(diagnostics[1]?.file).toBe("src/utils.py");
  });

  it("should map E-codes to warning and F-codes to error", () => {
    const json = JSON.stringify([
      { code: "E501", message: "style", filename: "a.py", location: { row: 1, column: 1 }, end_location: { row: 1, column: 1 } },
      { code: "F811", message: "redefined", filename: "a.py", location: { row: 2, column: 1 }, end_location: { row: 2, column: 1 } },
    ]);
    const diagnostics = parseRuffOutput(json);
    expect(diagnostics[0]?.severity).toBe("warning");
    expect(diagnostics[1]?.severity).toBe("error");
  });

  it("should handle empty array", () => {
    expect(parseRuffOutput("[]")).toHaveLength(0);
  });

  it("should handle malformed JSON", () => {
    expect(parseRuffOutput("not json")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --filter "parseRuffOutput"`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement ruff parser**

Create `packages/core/src/verify/linters/ruff.ts`:

```typescript
/**
 * Ruff output parser for Python syntax/lint checking.
 * Parses `ruff check --output-format=json` output.
 */

import type { SyntaxDiagnostic } from "../syntax-guard";

/**
 * Parse ruff JSON output into SyntaxDiagnostic[].
 * F-codes (pyflakes) are errors, E-codes (pycodestyle) are warnings.
 */
export function parseRuffOutput(json: string): SyntaxDiagnostic[] {
  let items: unknown[];
  try {
    items = JSON.parse(json);
  } catch {
    return [];
  }

  if (!Array.isArray(items)) return [];

  const diagnostics: SyntaxDiagnostic[] = [];

  for (const item of items) {
    const i = item as Record<string, unknown>;
    const code = (i.code as string) ?? "";
    const message = (i.message as string) ?? "";
    const filename = (i.filename as string) ?? "";
    const location = i.location as Record<string, number> | undefined;
    const row = location?.row ?? 0;
    const column = location?.column ?? 0;

    // F-codes (pyflakes) = errors, E/W-codes = warnings
    const severity: "error" | "warning" = code.startsWith("F")
      ? "error"
      : "warning";

    diagnostics.push({
      file: filename,
      line: row,
      column,
      message: `${code}: ${message}`,
      severity,
    });
  }

  return diagnostics;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test --filter "parseRuffOutput"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/verify/linters/ packages/core/src/verify/__tests__/linters/
bun packages/cli/dist/index.js commit -m "feat(core): add ruff output parser for Python linting"
```

---

### Task 5: Create go vet and clippy output parsers

**Files:**
- Create: `packages/core/src/verify/linters/go-vet.ts`
- Create: `packages/core/src/verify/linters/clippy.ts`
- Create: `packages/core/src/verify/__tests__/linters/go-vet.test.ts`
- Create: `packages/core/src/verify/__tests__/linters/clippy.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/verify/__tests__/linters/go-vet.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { parseGoVetOutput } from "../../linters/go-vet";

describe("parseGoVetOutput", () => {
  it("should parse go vet text output", () => {
    const output = `# example.com/pkg
./main.go:15:2: unreachable code
./utils.go:8:4: loop variable captured by func literal`;

    const diagnostics = parseGoVetOutput(output);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]?.file).toBe("./main.go");
    expect(diagnostics[0]?.line).toBe(15);
    expect(diagnostics[0]?.severity).toBe("error");
    expect(diagnostics[0]?.message).toContain("unreachable code");
  });

  it("should handle empty output", () => {
    expect(parseGoVetOutput("")).toHaveLength(0);
  });

  it("should skip package header lines", () => {
    const output = `# example.com/pkg
vet: checking...`;
    expect(parseGoVetOutput(output)).toHaveLength(0);
  });
});
```

Create `packages/core/src/verify/__tests__/linters/clippy.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { parseClippyOutput } from "../../linters/clippy";

describe("parseClippyOutput", () => {
  it("should parse clippy JSON messages", () => {
    const lines = [
      JSON.stringify({
        reason: "compiler-message",
        message: {
          code: { code: "clippy::unwrap_used" },
          level: "warning",
          message: "used `unwrap()` on a `Result` value",
          spans: [{ file_name: "src/main.rs", line_start: 10, column_start: 5 }],
        },
      }),
      JSON.stringify({ reason: "build-finished", success: true }),
    ].join("\n");

    const diagnostics = parseClippyOutput(lines);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.file).toBe("src/main.rs");
    expect(diagnostics[0]?.line).toBe(10);
    expect(diagnostics[0]?.severity).toBe("warning");
  });

  it("should handle empty output", () => {
    expect(parseClippyOutput("")).toHaveLength(0);
  });

  it("should map error level correctly", () => {
    const line = JSON.stringify({
      reason: "compiler-message",
      message: {
        code: { code: "E0308" },
        level: "error",
        message: "mismatched types",
        spans: [{ file_name: "src/lib.rs", line_start: 5, column_start: 1 }],
      },
    });
    const diagnostics = parseClippyOutput(line);
    expect(diagnostics[0]?.severity).toBe("error");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test --filter "parseGoVetOutput|parseClippyOutput"`
Expected: FAIL — modules don't exist

- [ ] **Step 3: Implement go-vet parser**

Create `packages/core/src/verify/linters/go-vet.ts`:

```typescript
/**
 * Go vet output parser.
 * Parses `go vet` stderr text output (format: file:line:col: message).
 */

import type { SyntaxDiagnostic } from "../syntax-guard";

export function parseGoVetOutput(output: string): SyntaxDiagnostic[] {
  const diagnostics: SyntaxDiagnostic[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    if (!line.trim() || line.startsWith("#") || line.startsWith("vet:")) continue;

    // Format: ./file.go:line:col: message
    const match = line.match(/^(.+?):(\d+):(\d+):\s+(.+)$/);
    if (!match) continue;

    const [, file, lineStr, colStr, message] = match;
    if (!file || !lineStr || !message) continue;

    diagnostics.push({
      file,
      line: Number.parseInt(lineStr, 10),
      column: Number.parseInt(colStr ?? "0", 10),
      message,
      severity: "error",
    });
  }

  return diagnostics;
}
```

- [ ] **Step 4: Implement clippy parser**

Create `packages/core/src/verify/linters/clippy.ts`:

```typescript
/**
 * Clippy output parser for Rust linting.
 * Parses `cargo clippy --message-format=json` output.
 */

import type { SyntaxDiagnostic } from "../syntax-guard";

export function parseClippyOutput(output: string): SyntaxDiagnostic[] {
  const diagnostics: SyntaxDiagnostic[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (parsed.reason !== "compiler-message") continue;

    const msg = parsed.message as Record<string, unknown> | undefined;
    if (!msg) continue;

    const level = (msg.level as string) ?? "warning";
    const message = (msg.message as string) ?? "";
    const code = (msg.code as Record<string, string> | undefined)?.code ?? "";
    const spans = msg.spans as Array<Record<string, unknown>> | undefined;

    if (!spans || spans.length === 0) continue;

    const span = spans[0] as Record<string, unknown>;
    const fileName = (span.file_name as string) ?? "";
    const lineStart = (span.line_start as number) ?? 0;
    const columnStart = (span.column_start as number) ?? 0;

    const severity: "error" | "warning" = level === "error" ? "error" : "warning";

    diagnostics.push({
      file: fileName,
      line: lineStart,
      column: columnStart,
      message: code ? `${code}: ${message}` : message,
      severity,
    });
  }

  return diagnostics;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test --filter "parseGoVetOutput|parseClippyOutput"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/verify/linters/ packages/core/src/verify/__tests__/linters/
bun packages/cli/dist/index.js commit -m "feat(core): add go vet and clippy output parsers"
```

---

### Task 6: Refactor syntax guard to dispatch per language

**Files:**
- Modify: `packages/core/src/verify/syntax-guard.ts`
- Modify: `packages/core/src/verify/__tests__/syntax-guard.test.ts`

- [ ] **Step 1: Write failing test — syntax guard accepts language parameter**

Add to existing tests in `packages/core/src/verify/__tests__/syntax-guard.test.ts`:

```typescript
import { getProfile } from "../../language/profile";

describe("syntaxGuard with language profile", () => {
  it("should accept a language profile parameter", async () => {
    const profile = getProfile("typescript");
    const result = await syntaxGuard([], undefined, profile);
    expect(result.ok).toBe(true);
  });

  it("should use biome for typescript profile (default behavior)", async () => {
    const result = await syntaxGuard(["nonexistent.ts"]);
    // Should still work with default (biome) — backward compatible
    expect(result).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --filter "syntax-guard"`
Expected: FAIL — syntaxGuard doesn't accept 3rd parameter

- [ ] **Step 3: Refactor syntaxGuard to accept LanguageProfile**

In `packages/core/src/verify/syntax-guard.ts`:

Add import:
```typescript
import type { LanguageProfile } from "../language/profile";
import { TYPESCRIPT_PROFILE } from "../language/profile";
import { parseRuffOutput } from "./linters/ruff";
import { parseGoVetOutput } from "./linters/go-vet";
import { parseClippyOutput } from "./linters/clippy";
```

Change the `syntaxGuard` function signature from:
```typescript
export async function syntaxGuard(files: string[], cwd?: string): Promise<SyntaxGuardResult>
```
To:
```typescript
export async function syntaxGuard(
  files: string[],
  cwd?: string,
  profile?: LanguageProfile,
): Promise<SyntaxGuardResult>
```

At the top of the function body, add:
```typescript
const lang = profile ?? TYPESCRIPT_PROFILE;
```

Then add a routing block after the `workDir` assignment:
```typescript
// Route to language-specific linter
if (lang.id !== "typescript") {
  return runLanguageLinter(files, workDir, lang);
}
```

Add a new function `runLanguageLinter`:
```typescript
async function runLanguageLinter(
  files: string[],
  cwd: string,
  profile: LanguageProfile,
): Promise<SyntaxGuardResult> {
  const args = profile.syntaxArgs(files, cwd);

  try {
    const proc = Bun.spawn(args, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    let diagnostics: SyntaxDiagnostic[] = [];

    switch (profile.id) {
      case "python":
        diagnostics = parseRuffOutput(stdout);
        break;
      case "go":
        diagnostics = parseGoVetOutput(stderr); // go vet outputs to stderr
        break;
      case "rust":
        diagnostics = parseClippyOutput(stdout);
        break;
    }

    const errors = diagnostics.filter((d) => d.severity === "error");
    if (errors.length === 0) {
      return { ok: true, value: undefined };
    }

    return { ok: false, error: diagnostics };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: [{
        file: "",
        line: 0,
        column: 0,
        message: `Failed to run ${profile.syntaxTool}: ${message}`,
        severity: "error",
      }],
    };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test --filter "syntax-guard"`
Expected: PASS — all existing tests still work (backward compatible)

- [ ] **Step 5: Run full test suite**

Run: `bun run test`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/verify/syntax-guard.ts packages/core/src/verify/__tests__/syntax-guard.test.ts
bun packages/cli/dist/index.js commit -m "feat(core): refactor syntax guard to dispatch per language profile"
```

---

### Task 7: Wire language detection into pipeline

**Files:**
- Modify: `packages/core/src/verify/pipeline.ts`
- Modify: `packages/core/src/verify/__tests__/pipeline.test.ts`

- [ ] **Step 1: Write failing test**

Add to `packages/core/src/verify/__tests__/pipeline.test.ts`:

```typescript
it("should accept languages option and pass to syntax guard", async () => {
  const result = await runPipeline({
    files: ["src/app.ts"],
    languages: ["typescript"],
  });
  expect(result.syntaxPassed).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --filter "pipeline"`
Expected: FAIL — `languages` not in PipelineOptions

- [ ] **Step 3: Wire language detection into pipeline**

In `packages/core/src/verify/pipeline.ts`:

Add imports:
```typescript
import { detectLanguages } from "../language/detect";
import { getProfile } from "../language/profile";
```

Update `PipelineOptions`:
```typescript
export interface PipelineOptions {
  files?: string[];
  baseBranch?: string;
  diffOnly?: boolean;
  deep?: boolean;
  languages?: string[];  // NEW — override auto-detected languages
  cwd?: string;
  mainaDir?: string;
}
```

After the syntax guard call (line ~117), replace:
```typescript
const syntaxResult = await syntaxGuard(files, cwd);
```
With:
```typescript
// Detect languages or use provided override
const languages = options?.languages ?? detectLanguages(cwd);
const primaryLang = languages[0] ?? "typescript";
const profile = getProfile(primaryLang as import("../language/profile").LanguageId);

const syntaxResult = await syntaxGuard(files, cwd, profile);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test --filter "pipeline"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/verify/pipeline.ts packages/core/src/verify/__tests__/pipeline.test.ts
bun packages/cli/dist/index.js commit -m "feat(core): wire language detection into verify pipeline"
```

---

### Task 8: Update semantic collector and retrieval for multi-language file globs

**Files:**
- Modify: `packages/core/src/context/semantic.ts`
- Modify: `packages/core/src/context/retrieval.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Update `collectSourceFiles` in semantic.ts**

In `packages/core/src/context/semantic.ts`, change the hardcoded extension check (line 55):

From:
```typescript
if (entry.endsWith(".ts") || entry.endsWith(".js")) {
  results.push(fullPath);
}
```

To:
```typescript
const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx",
  ".py", ".pyi",
  ".go",
  ".rs",
]);
// ... (move this constant outside the function)

if (SOURCE_EXTENSIONS.has(ext)) {
  results.push(fullPath);
}
```

Extract the extension with:
```typescript
const dotIdx = entry.lastIndexOf(".");
const ext = dotIdx >= 0 ? entry.slice(dotIdx) : "";
```

- [ ] **Step 2: Update retrieval.ts grep globs**

In `packages/core/src/context/retrieval.ts`, change `searchWithGrep` (around line 176) from hardcoded TS globs:

```typescript
"--include=*.ts",
"--include=*.tsx",
"--include=*.js",
"--include=*.jsx",
```

To:
```typescript
"--include=*.ts",
"--include=*.tsx",
"--include=*.js",
"--include=*.jsx",
"--include=*.py",
"--include=*.go",
"--include=*.rs",
```

- [ ] **Step 3: Export language modules from core index**

In `packages/core/src/index.ts`, add:

```typescript
// Language
export {
  type LanguageId,
  type LanguageProfile,
  getProfile,
  getSupportedLanguages,
  TYPESCRIPT_PROFILE,
  PYTHON_PROFILE,
  GO_PROFILE,
  RUST_PROFILE,
} from "./language/profile";
export {
  detectLanguages,
  getPrimaryLanguage,
} from "./language/detect";
```

- [ ] **Step 4: Run full test suite + typecheck**

Run: `bun run typecheck && bun run test`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/context/semantic.ts packages/core/src/context/retrieval.ts packages/core/src/index.ts
bun packages/cli/dist/index.js commit -m "feat(core): extend semantic + retrieval for multi-language file support"
```

---

### Task 9: Language-aware slop detection

**Files:**
- Modify: `packages/core/src/verify/slop.ts`
- Modify: `packages/core/src/verify/__tests__/slop.test.ts`

- [ ] **Step 1: Write failing tests for language-aware slop**

Add to `packages/core/src/verify/__tests__/slop.test.ts`:

```typescript
import { getProfile } from "../../language/profile";

describe("language-aware slop detection", () => {
  it("should detect print() in Python files", () => {
    const findings = detectConsoleLogs("x = 1\nprint('debug')\ny = 2", "app.py", getProfile("python"));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.ruleId).toBe("slop/console-log");
  });

  it("should detect fmt.Println in Go files", () => {
    const findings = detectConsoleLogs("package main\nfmt.Println(x)\n", "main.go", getProfile("go"));
    expect(findings).toHaveLength(1);
  });

  it("should detect println! in Rust files", () => {
    const findings = detectConsoleLogs("fn main() {\n  println!(\"debug\");\n}", "main.rs", getProfile("rust"));
    expect(findings).toHaveLength(1);
  });

  it("should skip Python test files", () => {
    const findings = detectConsoleLogs("print('ok')", "test_app.py", getProfile("python"));
    expect(findings).toHaveLength(0);
  });

  it("should skip Go test files", () => {
    const findings = detectConsoleLogs("fmt.Println(x)", "app_test.go", getProfile("go"));
    expect(findings).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test --filter "language-aware slop"`
Expected: FAIL — detectConsoleLogs doesn't accept profile parameter

- [ ] **Step 3: Refactor `detectConsoleLogs` to accept LanguageProfile**

In `packages/core/src/verify/slop.ts`:

Add import:
```typescript
import type { LanguageProfile } from "../language/profile";
import { TYPESCRIPT_PROFILE } from "../language/profile";
```

Change `detectConsoleLogs` signature to accept optional profile:
```typescript
export function detectConsoleLogs(
  content: string,
  file: string,
  profile?: LanguageProfile,
): Finding[] {
  const lang = profile ?? TYPESCRIPT_PROFILE;

  // Skip test files using language-specific pattern
  if (lang.testFilePattern.test(file)) {
    return [];
  }

  const findings: Finding[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const prevLine = i > 0 ? (lines[i - 1] ?? "") : "";
    if (lang.lintIgnorePattern.test(prevLine)) {
      continue;
    }
    const match = lang.printPattern.exec(line);
    if (match) {
      findings.push({
        tool: "slop",
        file,
        line: i + 1,
        column: (match.index ?? 0) + 1,
        message: `Print/log statement found in production code`,
        severity: "warning",
        ruleId: "slop/console-log",
      });
    }
  }

  return findings;
}
```

Do the same for `detectEmptyBodies` and `detectTodosWithoutTickets` — add optional profile parameter, use `lang.testFilePattern` instead of hardcoded regex, use `lang.commentPrefixes` for TODO pattern. The existing behavior is preserved when profile is not passed (defaults to TYPESCRIPT_PROFILE).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test --filter "slop"`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/verify/slop.ts packages/core/src/verify/__tests__/slop.test.ts
bun packages/cli/dist/index.js commit -m "feat(core): language-aware slop detection for Python, Go, Rust"
```

---

### Task 10: Language-aware import resolution in relevance.ts

**Files:**
- Modify: `packages/core/src/context/relevance.ts`

- [ ] **Step 1: Update `resolveImportPath` to handle multi-language extensions**

In `packages/core/src/context/relevance.ts`, change the candidates array in `resolveImportPath` (line 33):

From:
```typescript
const candidates = [
  base,
  `${base}.ts`,
  `${base}.js`,
  `${base}/index.ts`,
  `${base}/index.js`,
];
```

To:
```typescript
const candidates = [
  base,
  // TypeScript/JavaScript
  `${base}.ts`,
  `${base}.tsx`,
  `${base}.js`,
  `${base}.jsx`,
  `${base}/index.ts`,
  `${base}/index.js`,
  // Python
  `${base}.py`,
  `${base}/__init__.py`,
  // Go
  `${base}.go`,
  // Rust
  `${base}.rs`,
  `${base}/mod.rs`,
];
```

- [ ] **Step 2: Run tests**

Run: `bun run test`
Expected: All pass (this is backward compatible — just adds more candidates)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/context/relevance.ts
bun packages/cli/dist/index.js commit -m "feat(core): extend import resolution for Python, Go, Rust file extensions"
```

---

### Task 11: Full verification and integration

- [ ] **Step 1: Run typecheck**

Run: `bun run typecheck`

- [ ] **Step 2: Run biome check**

Run: `bun run check`

- [ ] **Step 3: Run full test suite**

Run: `bun run test`

- [ ] **Step 4: Run maina verify**

Run: `bun packages/cli/dist/index.js verify --all --base master`

- [ ] **Step 5: Run maina stats**

Run: `bun packages/cli/dist/index.js stats`

- [ ] **Step 6: Final commit**

```bash
bun packages/cli/dist/index.js commit -m "feat(core,cli): multi-language verify support — Python, Go, Rust"
```

- [ ] **Step 1: Run typecheck**

Run: `bun run typecheck`

- [ ] **Step 2: Run biome check**

Run: `bun run check`

- [ ] **Step 3: Run full test suite**

Run: `bun run test`

- [ ] **Step 4: Run maina verify**

Run: `bun packages/cli/dist/index.js verify --all --base master`

- [ ] **Step 5: Run maina learn**

Run: `bun packages/cli/dist/index.js learn --no-interactive` (if available, otherwise skip)

- [ ] **Step 6: Final commit**

```bash
bun packages/cli/dist/index.js commit -m "feat(core,cli): multi-language verify support — Python, Go, Rust"
```
