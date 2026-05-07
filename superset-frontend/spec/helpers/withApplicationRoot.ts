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

/**
 * Test fixture for subdirectory-deployment scenarios.
 *
 * Bootstrap data in Superset is read once per module load via
 * `getBootstrapData()` and cached. Tests that exercise URL generation under a
 * non-empty `application_root` therefore need to rewrite the `#app` element
 * and force the relevant modules to re-import so the cache is rebuilt.
 *
 * `withApplicationRoot` centralises that ritual. Usage:
 *
 *     import { withApplicationRoot } from 'spec/helpers/withApplicationRoot';
 *
 *     test('redirects to prefixed root under subdirectory deployment', async () => {
 *       await withApplicationRoot('/superset/', async () => {
 *         const { redirect } = await import('src/utils/navigationUtils');
 *         redirect('/');
 *         expect(window.location.href).toBe('/superset/');
 *       });
 *     });
 *
 * The callback receives a freshly-reset module registry, so any imports inside
 * it observe the configured root. After the callback finishes (or throws), the
 * fixture restores the previous `<div id="app">` markup and resets modules
 * again, leaving the global state clean for the next test.
 *
 * Pass `''` (the default) to simulate a deployment with no application root.
 */
export async function withApplicationRoot<T>(
  applicationRoot: string,
  callback: () => Promise<T> | T,
): Promise<T> {
  const previousBody = document.body.innerHTML;

  try {
    const bootstrapData = {
      common: { application_root: applicationRoot },
    };
    document.body.innerHTML = `<div id="app" data-bootstrap='${JSON.stringify(bootstrapData)}'></div>`;
    jest.resetModules();

    // Touch getBootstrapData first so the cached value reflects the new DOM.
    await import('src/utils/getBootstrapData');

    return await callback();
  } finally {
    document.body.innerHTML = previousBody;
    jest.resetModules();
  }
}

/**
 * Convenience wrapper that runs the same assertion under multiple application
 * roots. Use when the assertion text doesn't depend on the prefix.
 *
 *     applicationRootScenarios([
 *       { root: '', expected: '/sqllab' },
 *       { root: '/superset/', expected: '/superset/sqllab' },
 *       { root: '/a/b/c/', expected: '/a/b/c/sqllab' },
 *     ], async ({ expected }) => {
 *       const { ensureAppRoot } = await import('src/utils/pathUtils');
 *       expect(ensureAppRoot('/sqllab')).toBe(expected);
 *     });
 */
export async function applicationRootScenarios<S extends { root: string }>(
  scenarios: S[],
  body: (scenario: S) => Promise<void> | void,
): Promise<void> {
  for (const scenario of scenarios) {
    // eslint-disable-next-line no-await-in-loop -- intentional: scenarios share document state.
    await withApplicationRoot(scenario.root, () => body(scenario));
  }
}
