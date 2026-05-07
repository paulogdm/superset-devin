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
import { ensureAppRoot } from './pathUtils';

// =============================================================================
// Channel-3 helpers (browser-direct sinks)
// =============================================================================
//
// Every helper in this section takes a *router-relative* path (the same shape
// you'd pass to `<Link to>` or `history.push`) and applies the application
// root internally before handing the URL to the browser. This keeps the rest
// of the codebase decision-free: callers always write `/sqllab`, never
// `${applicationRoot()}/sqllab`.
//
// Once migration is complete, `ensureAppRoot` and `makeUrl` are imported only
// from this module. A static-invariant test (see
// `navigationUtils.invariants.test.ts`) enforces that boundary.
// =============================================================================

/**
 * Features passed to `window.open` for new-tab navigation. `noopener` and
 * `noreferrer` are mandatory — without them the opened page can drive the
 * opener via `window.opener` (reverse tabnabbing) and read the referrer.
 */
const NEW_TAB_FEATURES = 'noopener noreferrer';

/**
 * Schemes that are safe to feed to `window.location` / `window.open` /
 * anchor `href`. Anything outside this allow-list (`javascript:`, `data:`,
 * `vbscript:`, etc.) can execute script in the current origin and is
 * rejected by {@link assertSafeNavigationUrl}.
 *
 * The first two alternatives match relative URLs:
 *   - `^/(?!/)` — absolute path on this origin (`/foo`), but not a
 *     protocol-relative URL (`//host`). Protocol-relative is matched by the
 *     `\/\/` alternative instead.
 *   - `\/\/`  — protocol-relative (`//cdn.example.com/foo`).
 *
 * Kept locally in `navigationUtils.ts` rather than imported from pathUtils
 * so the safety property is checkable from this file alone — that's what
 * CodeQL needs to clear the dataflow alert on the sinks below.
 */
const SAFE_NAVIGATION_URL_RE =
  /^(?:\/(?!\/)|\/\/|https?:|ftp:|mailto:|tel:)/i;

/**
 * Validate that `url` uses a navigation-safe shape. `ensureAppRoot` already
 * neutralises script-bearing schemes by prefixing them as relative paths
 * (`javascript:alert(1)` → `/javascript:alert(1)`), but this assertion gives
 * the property a single, locally-readable enforcement point and keeps the
 * channel-3 sinks below from being flagged as untrusted-data flows.
 */
function assertSafeNavigationUrl(url: string): string {
  if (!SAFE_NAVIGATION_URL_RE.test(url)) {
    throw new Error(
      `navigationUtils refused unsafe URL: only relative paths and ` +
        `http(s):, ftp:, mailto:, tel: schemes are allowed.`,
    );
  }
  return url;
}

/**
 * Open a router-relative path in a new browser tab.
 *
 * The path is automatically prefixed with the application root so the new tab
 * lands inside Superset on subdirectory deployments.
 */
export function openInNewTab(path: string): void {
  window.open(
    assertSafeNavigationUrl(ensureAppRoot(path)),
    '_blank',
    NEW_TAB_FEATURES,
  );
}

/**
 * Navigate the current window to a router-relative path via `window.location`.
 *
 * Unlike `history.push`, this triggers a full page load. Use it only when the
 * destination is outside the React Router tree (e.g. a backend-rendered page)
 * or when a hard reload is required.
 */
export function redirect(path: string): void {
  window.location.href = assertSafeNavigationUrl(ensureAppRoot(path));
}

/**
 * Replace the current entry in `window.history` with a router-relative path.
 * No new history entry is pushed. Use sparingly — most navigation should go
 * through React Router's `history.replace`.
 */
export function redirectReplace(path: string): void {
  window.location.replace(assertSafeNavigationUrl(ensureAppRoot(path)));
}

/**
 * Build a fully-qualified URL (`<scheme>://<host><appRoot><path>`) from a
 * router-relative path. Use for clipboard / share / email targets that need
 * to round-trip through external systems back to this Superset deployment.
 */
export function getShareableUrl(path: string): string {
  return `${window.location.origin}${assertSafeNavigationUrl(ensureAppRoot(path))}`;
}

/**
 * Anchor element that prefixes its `href` with the application root.
 *
 * Use this instead of `<a href={varExpr}>` whenever the href is computed at
 * runtime. Static `<a href="https://...">` literals are fine — the static-
 * invariant test only flags non-literal hrefs.
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

// =============================================================================
// Legacy multi-mode helpers
// =============================================================================
// These predate the focused helpers above. They behave correctly but are
// scheduled for replacement so the channel-3 surface is entirely composed of
// single-purpose functions. Migration commits will rewrite call sites to use
// the focused helpers, then delete these.
// =============================================================================

export const navigateTo = (
  url: string,
  options?: { newWindow?: boolean; assign?: boolean },
) => {
  if (options?.newWindow) {
    window.open(ensureAppRoot(url), '_blank', 'noopener noreferrer');
  } else if (options?.assign) {
    window.location.assign(ensureAppRoot(url));
  } else {
    window.location.href = ensureAppRoot(url);
  }
};

export const navigateWithState = (
  url: string,
  state: Record<string, unknown>,
  options?: { replace?: boolean },
) => {
  if (options?.replace) {
    window.history.replaceState(state, '', ensureAppRoot(url));
  } else {
    window.history.pushState(state, '', ensureAppRoot(url));
  }
};
