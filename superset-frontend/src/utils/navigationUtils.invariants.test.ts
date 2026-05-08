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

// Call sites that still import ensureAppRoot / makeUrl directly. Migration
// PRs replace each one with the focused helpers in navigationUtils.ts and
// drop its entry here. New entries should not be added without justification.
const PATH_UTILS_IMPORT_ALLOWLIST: string[] = [
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

test('PATH_UTILS_IMPORT_ALLOWLIST entries are workspace-relative paths', () => {
  for (const entry of PATH_UTILS_IMPORT_ALLOWLIST) {
    expect(entry.startsWith('/')).toBe(false);
    expect(entry.includes('\\')).toBe(false);
  }
});

test('no file outside navigationUtils.ts imports ensureAppRoot or makeUrl from pathUtils', () => {
  const hits = scanSource({
    pattern: /\b(?:ensureAppRoot|makeUrl)\b/,
    allowlist: [
      // pathUtils.ts defines the helpers; navigationUtils.ts is the only
      // sanctioned re-export point for the rest of the codebase.
      'src/utils/pathUtils.ts',
      'src/utils/navigationUtils.ts',
      // SupersetClient has its own appRoot configuration path that doesn't
      // import from pathUtils. Excluded so any internal mention of `appRoot`
      // doesn't trip the scan.
      'packages/superset-ui-core/src/connection/SupersetClientClass.ts',
      'packages/superset-ui-core/src/connection/normalizeBackendUrls.ts',
      ...PATH_UTILS_IMPORT_ALLOWLIST,
    ],
  });

  expectNoHits(
    hits,
    'Found imports of ensureAppRoot / makeUrl outside navigationUtils.ts. ' +
      'Use the focused helpers (openInNewTab, redirect, getShareableUrl, AppLink) ' +
      'or add the file to PATH_UTILS_IMPORT_ALLOWLIST with justification.',
  );
});
