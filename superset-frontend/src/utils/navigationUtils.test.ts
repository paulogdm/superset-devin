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

// Surface any future hang as a Jest timeout instead of stalling CI.
jest.setTimeout(20000);

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

describe('redirect', () => {
  let originalLocation: Location;

  beforeEach(() => {
    originalLocation = window.location;
    delete (window as unknown as { location?: Location }).location;
    (window as unknown as { location: { href: string } }).location = {
      href: '',
    } as Location;
  });

  afterEach(() => {
    (window as unknown as { location: Location }).location = originalLocation;
  });

  test('sets window.location.href to the unprefixed path under empty root', async () => {
    await withApplicationRoot('', async () => {
      const { redirect } = await import('src/utils/navigationUtils');
      redirect('/');
      expect(window.location.href).toBe('/');
    });
  });

  test('prefixes the path under a subdirectory deployment', async () => {
    await withApplicationRoot('/superset/', async () => {
      const { redirect } = await import('src/utils/navigationUtils');
      redirect('/');
      expect(window.location.href).toBe('/superset/');
    });
  });

  test('passes absolute URLs through unchanged', async () => {
    await withApplicationRoot('/superset/', async () => {
      const { redirect } = await import('src/utils/navigationUtils');
      redirect('https://external.example.com/foo');
      expect(window.location.href).toBe('https://external.example.com/foo');
    });
  });
});

describe('getShareableUrl', () => {
  test('returns origin + unprefixed path under empty root', async () => {
    await withApplicationRoot('', async () => {
      const { getShareableUrl } = await import('src/utils/navigationUtils');
      expect(getShareableUrl('/sqllab?id=1')).toBe(
        `${window.location.origin}/sqllab?id=1`,
      );
    });
  });

  test('returns origin + prefixed path under subdirectory deployment', async () => {
    await withApplicationRoot('/superset/', async () => {
      const { getShareableUrl } = await import('src/utils/navigationUtils');
      expect(getShareableUrl('/sqllab?id=1')).toBe(
        `${window.location.origin}/superset/sqllab?id=1`,
      );
    });
  });
});

describe('AppLink', () => {
  test('renders an anchor with prefixed href under subdirectory deployment', async () => {
    await withApplicationRoot('/superset/', async () => {
      const { AppLink } = await import('src/utils/navigationUtils');
      const { render } = await import('@testing-library/react');
      const { container } = render(AppLink({ href: '/foo', children: 'go' }));
      const anchor = container.querySelector('a');
      expect(anchor).not.toBeNull();
      expect(anchor?.getAttribute('href')).toBe('/superset/foo');
    });
  });

  test('passes through other anchor props', async () => {
    await withApplicationRoot('', async () => {
      const { AppLink } = await import('src/utils/navigationUtils');
      const { render } = await import('@testing-library/react');
      const { container } = render(
        AppLink({ href: '/foo', target: '_blank', rel: 'noreferrer' }),
      );
      const anchor = container.querySelector('a');
      expect(anchor?.getAttribute('target')).toBe('_blank');
      expect(anchor?.getAttribute('rel')).toBe('noreferrer');
    });
  });

  test('passes absolute URLs through without prefixing', async () => {
    await withApplicationRoot('/superset/', async () => {
      const { AppLink } = await import('src/utils/navigationUtils');
      const { render } = await import('@testing-library/react');
      const { container } = render(
        AppLink({ href: 'https://external.example.com', children: 'x' }),
      );
      expect(container.querySelector('a')?.getAttribute('href')).toBe(
        'https://external.example.com',
      );
    });
  });
});
