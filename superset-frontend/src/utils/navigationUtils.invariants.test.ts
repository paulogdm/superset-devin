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
import { expectNoHits, scanSource } from 'spec/helpers/sourceTreeScanner';

test('no file outside navigationUtils.ts imports from pathUtils', () => {
  // pathUtils.ts is the implementation module; navigationUtils.ts re-exports
  // its helpers as the single sanctioned entry point for the rest of the
  // codebase. Callers should `import { ensureAppRoot } from
  // 'src/utils/navigationUtils'` (or use the focused helpers there).
  const hits = scanSource({
    pattern: /from\s+['"](?:src\/utils\/pathUtils|\.\.?\/[\w./]*pathUtils)['"]/,
    allowlist: ['src/utils/navigationUtils.ts'],
  });

  expectNoHits(
    hits,
    'Found direct imports from src/utils/pathUtils. Import from ' +
      'src/utils/navigationUtils instead — it re-exports ensureAppRoot ' +
      'and makeUrl, and exposes focused helpers (openInNewTab, redirect, ' +
      'getShareableUrl, AppLink) for most call sites.',
  );
});

// Raw absolute-from-root anchor hrefs (`href="/foo"`, `href={`/foo`}`, etc.)
// bypass React Router's basename when rendered with `target="_blank"` and
// produce 404s under subdirectory deployment. Migrate to either
// `<AppLink href={...}>` or wrap with `ensureAppRoot()` so the application
// root is applied exactly once.
//
// The negative lookbehind `(?<!\.)` excludes `obj.href = '/'` — that case
// belongs to the navigateTo / window.location migration. Negative lookahead
// `(?!\/)` excludes protocol-relative URLs (`href="//cdn..."`).
const RAW_HREF_ABSOLUTE_PATH_PATTERN =
  /(?<!\.)\bhref\s*=\s*(?:["']\/(?!\/)|\{\s*["']\/(?!\/)|\{\s*`\/(?!\/))/;

const RAW_HREF_ABSOLUTE_PATH_ALLOWLIST: string[] = [
  'src/explore/components/controls/AnnotationLayerControl/AnnotationLayer.tsx',
  'src/pages/AnnotationLayerList/index.tsx',
  'src/pages/AnnotationList/index.tsx',
  'src/pages/DatabaseList/index.tsx',
  'src/pages/DatasetList/index.tsx',
  'src/pages/Login/index.tsx',
  'src/pages/Register/index.tsx',
];

test('no raw absolute-path href in JSX outside the migration allow-list', () => {
  const hits = scanSource({
    pattern: RAW_HREF_ABSOLUTE_PATH_PATTERN,
    allowlist: RAW_HREF_ABSOLUTE_PATH_ALLOWLIST,
  });

  expectNoHits(
    hits,
    'Found raw absolute-path href anchors. With target="_blank" these ' +
      "bypass React Router's basename and 404 under /superset deployment. " +
      'Migrate to <AppLink href={...}> from src/utils/navigationUtils, or ' +
      'wrap the value with ensureAppRoot().',
  );
});

test('RAW_HREF_ABSOLUTE_PATH_ALLOWLIST has no stale entries', () => {
  // Every allow-listed file must still contain at least one raw-href
  // violation. When a migration commit removes the last violation from a
  // file, that file must be dropped from the allow-list in the same commit
  // — otherwise the scan silently stops protecting the rest of the tree
  // from regressions in that file.
  const hitFiles = new Set(
    scanSource({ pattern: RAW_HREF_ABSOLUTE_PATH_PATTERN }).map(
      hit => hit.file,
    ),
  );

  const stale = RAW_HREF_ABSOLUTE_PATH_ALLOWLIST.filter(
    file => !hitFiles.has(file),
  );

  expect(stale).toEqual([]);
});
