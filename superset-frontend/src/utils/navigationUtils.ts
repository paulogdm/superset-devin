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
import {
  createElement,
  type AnchorHTMLAttributes,
  type ReactElement,
} from 'react';
import { ensureAppRoot, makeUrl, stripAppRoot } from './pathUtils';

// Re-export so callers that legitimately need a raw prefixed path (native
// fetch, navigator.sendBeacon, image src, third-party `href` props) have a
// single sanctioned import location. The static-invariant scan disallows
// importing from `pathUtils` directly outside this module.
export { ensureAppRoot, makeUrl, stripAppRoot };

// `navigateTo` and `navigateWithState` are declared first so the focused
// helpers below can call them without tripping oxlint's no-use-before-define
// (which does not honour function-declaration hoisting).

export function navigateTo(
  url: string,
  options?: { newWindow?: boolean; assign?: boolean },
): void {
  if (options?.newWindow) {
    window.open(ensureAppRoot(url), '_blank', 'noopener noreferrer');
  } else if (options?.assign) {
    window.location.assign(ensureAppRoot(url));
  } else {
    window.location.href = ensureAppRoot(url);
  }
}

export function navigateWithState(
  url: string,
  state: Record<string, unknown>,
  options?: { replace?: boolean },
): void {
  if (options?.replace) {
    window.history.replaceState(state, '', ensureAppRoot(url));
  } else {
    window.history.pushState(state, '', ensureAppRoot(url));
  }
}

const NEW_TAB_FEATURES = 'noopener noreferrer';

// Allow-list of safe URL shapes for navigation: relative paths, protocol-
// relative URLs, and a small set of known-safe schemes. `ensureAppRoot`
// already neutralises `javascript:` / `data:` by prefixing them as relative
// paths, but checking here gives CodeQL a locally-visible sanitiser on the
// sinks below.
const SAFE_NAVIGATION_URL_RE = /^(?:\/(?!\/)|\/\/|https?:|ftp:|mailto:|tel:)/i;

function assertSafeNavigationUrl(url: string): string {
  if (!SAFE_NAVIGATION_URL_RE.test(url)) {
    throw new Error(
      'navigationUtils refused unsafe URL: only relative paths and ' +
        'http(s):, ftp:, mailto:, tel: schemes are allowed.',
    );
  }
  return url;
}

/** Open a router-relative path in a new browser tab. */
export function openInNewTab(path: string): void {
  window.open(
    assertSafeNavigationUrl(ensureAppRoot(path)),
    '_blank',
    NEW_TAB_FEATURES,
  );
}

/**
 * Full-page redirect to a router-relative path. Use only when the destination
 * is outside the React Router tree or a hard reload is required.
 */
export function redirect(path: string): void {
  navigateTo(path);
}

/** Build a `${origin}${appRoot}${path}` URL for clipboard / share targets. */
export function getShareableUrl(path: string): string {
  const safePath = assertSafeNavigationUrl(ensureAppRoot(path));
  return `${window.location.origin}${safePath}`;
}

/**
 * Anchor element that prefixes its href with the application root. Use
 * instead of `<a href={varExpr}>` whenever the href is computed at runtime.
 */
export function AppLink(
  props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string },
): ReactElement {
  const { href, ...rest } = props;
  return createElement('a', {
    ...rest,
    href: assertSafeNavigationUrl(ensureAppRoot(href)),
  });
}
