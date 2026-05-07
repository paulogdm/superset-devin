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
import type { AnchorHTMLAttributes, ReactElement } from 'react';
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

const NOT_IMPLEMENTED =
  'navigationUtils helper not implemented yet — landing in the green commit of the subdirectory-helpers PR.';

/**
 * Open a router-relative path in a new browser tab.
 *
 * The path is automatically prefixed with the application root so the new tab
 * lands inside Superset on subdirectory deployments.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub
export function openInNewTab(path: string): void {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Navigate the current window to a router-relative path via `window.location`.
 *
 * Unlike `history.push`, this triggers a full page load. Use it only when the
 * destination is outside the React Router tree (e.g. a backend-rendered page)
 * or when a hard reload is required.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub
export function redirect(path: string): void {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Replace the current entry in `window.history` with a router-relative path.
 * No new history entry is pushed. Use sparingly — most navigation should go
 * through React Router's `history.replace`.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub
export function redirectReplace(path: string): void {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Build a fully-qualified URL (`<scheme>://<host><appRoot><path>`) from a
 * router-relative path. Use for clipboard / share / email targets that need
 * to round-trip through external systems back to this Superset deployment.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub
export function getShareableUrl(path: string): string {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Anchor element that prefixes its `href` with the application root.
 *
 * Use this instead of `<a href={varExpr}>` whenever the href is computed at
 * runtime. Static `<a href="https://...">` literals are fine — the static-
 * invariant test only flags non-literal hrefs.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub
export function AppLink(
  props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string },
): ReactElement {
  throw new Error(NOT_IMPLEMENTED);
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
