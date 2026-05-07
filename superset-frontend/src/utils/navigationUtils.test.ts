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
import { withApplicationRoot } from 'spec/helpers/withApplicationRoot';

// =============================================================================
// Layer 1 example: openInNewTab
// =============================================================================
//
// Layer 1 covers per-helper unit behaviour. The full PR adds parallel suites
// for `redirect`, `redirectReplace`, `getShareableUrl`, and `<AppLink>`. This
// file ships a single helper as a template for the structure those follow:
//
//   1. Each helper is exercised under empty appRoot AND a non-empty appRoot.
//   2. Absolute URLs (https://, mailto:, etc.) pass through unchanged.
//   3. Already-prefixed input is idempotent (does not double-prefix).
// =============================================================================

describe('openInNewTab', () => {
  let openSpy: jest.SpyInstance;

  beforeEach(() => {
    openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  test('passes router-relative path through unchanged when application root is empty', async () => {
    await withApplicationRoot('', async () => {
      const { openInNewTab } = await import('src/utils/navigationUtils');
      openInNewTab('/sqllab?new=true');
      expect(openSpy).toHaveBeenCalledWith(
        '/sqllab?new=true',
        '_blank',
        'noopener noreferrer',
      );
    });
  });

  test('prefixes router-relative path with application root under subdirectory deployment', async () => {
    await withApplicationRoot('/superset/', async () => {
      const { openInNewTab } = await import('src/utils/navigationUtils');
      openInNewTab('/sqllab?new=true');
      expect(openSpy).toHaveBeenCalledWith(
        '/superset/sqllab?new=true',
        '_blank',
        'noopener noreferrer',
      );
    });
  });

  test('prefixes correctly for nested subdirectory roots', async () => {
    await withApplicationRoot('/a/b/c/', async () => {
      const { openInNewTab } = await import('src/utils/navigationUtils');
      openInNewTab('/dashboard/list');
      expect(openSpy).toHaveBeenCalledWith(
        '/a/b/c/dashboard/list',
        '_blank',
        'noopener noreferrer',
      );
    });
  });

  test('passes absolute URLs through unchanged regardless of application root', async () => {
    await withApplicationRoot('/superset/', async () => {
      const { openInNewTab } = await import('src/utils/navigationUtils');
      openInNewTab('https://external.example.com/docs');
      expect(openSpy).toHaveBeenCalledWith(
        'https://external.example.com/docs',
        '_blank',
        'noopener noreferrer',
      );
    });
  });

  test('passes mailto: URLs through unchanged', async () => {
    await withApplicationRoot('/superset/', async () => {
      const { openInNewTab } = await import('src/utils/navigationUtils');
      openInNewTab('mailto:owner@example.com');
      expect(openSpy).toHaveBeenCalledWith(
        'mailto:owner@example.com',
        '_blank',
        'noopener noreferrer',
      );
    });
  });

  test('uses noopener noreferrer for security on every call', async () => {
    await withApplicationRoot('/superset/', async () => {
      const { openInNewTab } = await import('src/utils/navigationUtils');
      openInNewTab('/sqllab');
      expect(openSpy).toHaveBeenCalledTimes(1);
      const features = openSpy.mock.calls[0][2] as string;
      expect(features).toContain('noopener');
      expect(features).toContain('noreferrer');
    });
  });
});
