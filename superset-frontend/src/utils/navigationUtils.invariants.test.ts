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

// =============================================================================
// Layer 2 example: structural invariant
// =============================================================================
//
// Layer 2 contains tests that read the source tree and assert structural
// properties — "no file outside `navigationUtils.ts` imports `ensureAppRoot`"
// is the canonical example. The full PR adds parallel scans for raw
// `window.open` / `window.location.href`, double-prefix patterns through
// `SupersetClient` and `history.push`, and `<Link to={makeUrl(...)}>`.
//
// Each test seeds an allow-list of current violations so the suite is GREEN
// on day one. Migration commits then delete entries from the allow-list,
// driving the count to zero. New violations introduced after migration fail
// the suite immediately and surface a `file:line` location in the message.
//
// The list below is the INITIAL seed — every entry will be removed by a
// subsequent migration commit. Do not extend it without an inline comment
// explaining why the file is exempt.
// =============================================================================

const PATH_UTILS_IMPORT_ALLOWLIST: string[] = [
  // Migrated by future commits. Each line listed here is a call site that
  // currently imports `ensureAppRoot` or `makeUrl` directly; the migration
  // PRs replace those imports with calls to focused helpers in
  // `src/utils/navigationUtils.ts` and remove the file from this list.
  'src/SqlLab/components/QueryTable/index.tsx',
  'src/SqlLab/components/ResultSet/index.tsx',
  'src/components/Chart/DrillDetail/DrillDetailPane.tsx',
  'src/components/Chart/chartAction.ts',
  'src/components/Datasource/components/DatasourceEditor/DatasourceEditor.tsx',
  'src/components/FacePile/index.tsx',
  'src/components/StreamingExportModal/useStreamingExport.ts',
  'src/explore/components/controls/ViewQuery.tsx',
  'src/explore/exploreUtils/index.ts',
  'src/features/databases/DatabaseModal/index.tsx',
  'src/features/datasets/AddDataset/LeftPanel/index.tsx',
  'src/features/home/EmptyState.tsx',
  'src/features/home/Menu.tsx',
  'src/features/home/RightMenu.tsx',
  'src/features/home/SavedQueries.tsx',
  'src/middleware/loggerMiddleware.ts',
  'src/pages/SavedQueryList/index.tsx',
  'src/preamble.ts',
  'src/views/CRUD/hooks.ts',
];

test('no file outside navigationUtils.ts imports ensureAppRoot or makeUrl from pathUtils', () => {
  const hits = scanSource({
    pattern: /\b(?:ensureAppRoot|makeUrl)\b/,
    allowlist: [
      // The two modules that are *allowed* to know about path prefixing.
      // `pathUtils.ts` defines the helpers; `navigationUtils.ts` is the only
      // re-export sanctioned for the rest of the codebase to consume.
      'src/utils/pathUtils.ts',
      'src/utils/navigationUtils.ts',
      // SupersetClient has its own `appRoot` configuration path — it does not
      // import from `pathUtils`. Excluded so a future occurrence of the word
      // `appRoot` in connection internals doesn't trip this scan.
      'packages/superset-ui-core/src/connection/SupersetClientClass.ts',
      'packages/superset-ui-core/src/connection/normalizeBackendUrls.ts',
      ...PATH_UTILS_IMPORT_ALLOWLIST,
    ],
  });

  expectNoHits(
    hits,
    'Found imports of ensureAppRoot / makeUrl outside navigationUtils.ts. ' +
      'Use the focused helpers (openInNewTab, redirect, getShareableUrl, AppLink) ' +
      'instead, or add the file to PATH_UTILS_IMPORT_ALLOWLIST with justification.',
  );
});
