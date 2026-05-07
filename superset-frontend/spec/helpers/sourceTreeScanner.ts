/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve, sep } from 'path';

/**
 * Directories scanned by `scanSource` when `roots` is not supplied.
 * Resolved relative to the `superset-frontend` workspace.
 */
const DEFAULT_ROOTS = ['src', 'packages/superset-ui-core/src'];

/**
 * Path segments that are always excluded. We compare against path components
 * so any directory named `node_modules` (etc.) is skipped wherever it appears
 * in the tree.
 */
const ALWAYS_SKIP_SEGMENTS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '__mocks__',
  'cypress-base',
  'playwright',
]);

/**
 * Filename suffixes that legitimately mention otherwise-banned helpers (tests
 * import them, stories embed them) and should not be scanned for invariants.
 */
const ALWAYS_SKIP_SUFFIXES = [
  '.test.ts',
  '.test.tsx',
  '.stories.ts',
  '.stories.tsx',
];

/** Extensions considered source files. */
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

export interface ScanOptions {
  /**
   * Workspace-relative directory roots to scan. Defaults to the source tree.
   * Each entry is walked recursively.
   */
  roots?: string[];
  /**
   * Additional path segments to skip in addition to {@link ALWAYS_SKIP_SEGMENTS}.
   */
  ignoreSegments?: string[];
  /** Regex run against each line of each file. */
  pattern: RegExp;
  /**
   * File paths (relative to `superset-frontend`, forward slashes) that are
   * exempt from this scan. Use sparingly; every entry should justify itself
   * in a comment.
   */
  allowlist?: string[];
}

export interface ScanHit {
  /** Path relative to `superset-frontend`, with forward slashes. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** The text of the matching line, trimmed. */
  text: string;
  /** The substring captured by `pattern`. */
  match: string;
}

/**
 * Workspace root used as the base for relative paths returned by the scanner.
 * `__dirname` resolves to `<workspace>/spec/helpers`, so the parent's parent
 * is the workspace regardless of where Jest is invoked from.
 */
const WORKSPACE_ROOT = resolve(__dirname, '..', '..');

function isSourceFile(name: string): boolean {
  return (
    SOURCE_EXTENSIONS.some(ext => name.endsWith(ext)) &&
    !ALWAYS_SKIP_SUFFIXES.some(suffix => name.endsWith(suffix))
  );
}

function walk(directory: string, ignoreSegments: Set<string>): string[] {
  const found: string[] = [];

  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (ignoreSegments.has(entry.name)) continue;
    const absolute = join(directory, entry.name);

    if (entry.isDirectory()) {
      found.push(...walk(absolute, ignoreSegments));
    } else if (entry.isFile() && isSourceFile(entry.name)) {
      found.push(absolute);
    }
  }

  return found;
}

function toForwardSlashes(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/');
}

/**
 * Scan source files under `roots` for lines matching `pattern`.
 *
 * Each match is returned as a {@link ScanHit} with a workspace-relative path
 * and 1-based line number. Files listed in `allowlist` are skipped entirely.
 *
 * Scanning is deliberately textual (line-by-line regex) rather than AST-based
 * — these invariants flag forbidden *patterns*, not forbidden *expressions*.
 * False positives on string literals or comments should be addressed by
 * tightening the regex, not by parsing.
 */
export function scanSource(options: ScanOptions): ScanHit[] {
  const {
    roots = DEFAULT_ROOTS,
    ignoreSegments = [],
    pattern,
    allowlist = [],
  } = options;

  const ignoreSet = new Set([...ALWAYS_SKIP_SEGMENTS, ...ignoreSegments]);
  const allowSet = new Set(allowlist);
  const hits: ScanHit[] = [];

  const seen = new Set<string>();
  for (const root of roots) {
    const absoluteRoot = resolve(WORKSPACE_ROOT, root);
    let stat;
    try {
      stat = statSync(absoluteRoot);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    for (const absoluteFile of walk(absoluteRoot, ignoreSet)) {
      if (seen.has(absoluteFile)) continue;
      seen.add(absoluteFile);

      const relativePath = toForwardSlashes(
        relative(WORKSPACE_ROOT, absoluteFile),
      );
      if (allowSet.has(relativePath)) continue;

      const contents = readFileSync(absoluteFile, 'utf8');
      const lines = contents.split('\n');

      for (let index = 0; index < lines.length; index += 1) {
        const lineText = lines[index];
        // Re-create the regex per line so the global flag's lastIndex doesn't
        // bleed across iterations.
        const lineRegex = new RegExp(pattern.source, pattern.flags);
        const match = lineRegex.exec(lineText);
        if (match) {
          hits.push({
            file: relativePath,
            line: index + 1,
            text: lineText.trim(),
            match: match[0],
          });
        }
      }
    }
  }

  return hits;
}

/**
 * Format a list of hits as a human-readable failure message. Used by
 * invariant tests so the developer sees `file:line` for every violation.
 */
export function formatHits(hits: ScanHit[], header: string): string {
  if (hits.length === 0) return header;
  const lines = hits
    .slice(0, 50)
    .map(hit => `  ${hit.file}:${hit.line} — ${hit.text}`);
  const overflow =
    hits.length > 50 ? `\n  ... and ${hits.length - 50} more` : '';
  return `${header}\n${lines.join('\n')}${overflow}`;
}

/**
 * Helper that fails a Jest test with a formatted message when `hits` is
 * non-empty. Returns void so call sites read naturally:
 *
 *     expectNoHits(scanSource({ pattern: /window\.open\(/ }), 'Found raw window.open');
 */
export function expectNoHits(hits: ScanHit[], header: string): void {
  if (hits.length > 0) {
    throw new Error(formatHits(hits, header));
  }
}
