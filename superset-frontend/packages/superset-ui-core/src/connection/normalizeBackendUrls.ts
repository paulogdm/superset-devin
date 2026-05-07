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
 * Normalises backend-supplied URL fields so the frontend speaks one shape
 * (router-relative paths) regardless of whether Superset is deployed at the
 * web root or under a subdirectory.
 *
 * The backend renders absolute paths that include the application root, e.g.
 * `/superset/explore/?slice_id=1`. Channel-3 helpers (window.open, redirect,
 * AppLink) and channel-2 (`SupersetClient`) re-apply the root themselves;
 * leaving the prefix on a backend value would double it. So we strip the
 * configured root on the way in and let the consumers re-add it.
 *
 * # Why this is conservative by design
 *
 * The normaliser **only touches fields whose name appears in
 * `NORMALIZED_URL_FIELDS`**. It does not heuristically detect URLs by content
 * — a `description` field containing `/looks/like/a/path` is left alone.
 * Adding a new URL field to the backend therefore requires an explicit
 * one-line change here. Drift requires intentional opt-in.
 *
 * Exact-segment prefix matching prevents false positives where a value
 * happens to share a prefix with the application root (e.g.
 * `/superset-public/...` is not stripped when the root is `/superset`).
 *
 * Absolute URLs (`https://...`, `mailto:`, protocol-relative `//cdn`) and
 * already-router-relative paths are passed through unchanged.
 */

const NOT_IMPLEMENTED =
  'normalizeBackendUrls is not implemented yet — landing in the green commit of the subdirectory-helpers PR.';

/**
 * Field names whose values are router-relative URLs to this Superset
 * deployment and therefore safe to normalise.
 *
 * Curated, not heuristic. Add a field here only after confirming:
 *
 *   1. The backend always sets it to a path within this Superset instance
 *      (never an external URL or a path with a different prefix).
 *   2. Every consumer expects to feed the value to a channel-3 helper or
 *      `SupersetClient`, both of which re-apply the application root.
 *
 * Fields that have been *deliberately excluded* are listed in
 * `NORMALIZER_EXCLUSIONS` below with the reason — keep that list in sync.
 */
export const NORMALIZED_URL_FIELDS = new Set<string>([
  // Concrete entries are added in the green commit after the per-endpoint
  // audit. The skeleton commit only ships the constant so static-invariant
  // tests have a stable import target.
]);

/**
 * URL-shaped field names that we have deliberately *not* added to
 * `NORMALIZED_URL_FIELDS`, with the reason. The negative tests in
 * `normalizeBackendUrls.test.ts` assert that values for these names are
 * passed through unchanged even when the value happens to begin with the
 * configured application root.
 *
 * This list is informational — code does not read it. Its purpose is to
 * preserve institutional knowledge so a future contributor doesn't add an
 * exclusion to the allow-list by mistake.
 */
export const NORMALIZER_EXCLUSIONS: ReadonlyArray<{
  field: string;
  reason: string;
}> = [
  { field: 'bug_report_url', reason: 'External (GitHub)' },
  { field: 'documentation_url', reason: 'External (docs site)' },
  { field: 'external_url', reason: 'External by name' },
  {
    field: 'bundle_url',
    reason: 'CDN / static asset host, not a Superset route',
  },
  { field: 'tracking_url', reason: 'External (analytics)' },
  { field: 'user_login_url', reason: 'OAuth / SSO endpoints, may be external' },
  {
    field: 'user_logout_url',
    reason: 'OAuth / SSO endpoints, may be external',
  },
  { field: 'user_info_url', reason: 'OAuth / SSO endpoints, may be external' },
  {
    field: 'thumbnail_url',
    reason:
      'Storage host varies (S3 / local) — needs per-endpoint audit before normalising',
  },
  {
    field: 'creator_url',
    reason: 'User-profile destination varies by deployment',
  },
];

export interface NormalizeOptions {
  /**
   * Application root to strip. Pass an empty string to disable normalisation.
   * Trailing slash is tolerated; the strip logic compares whole path segments.
   */
  applicationRoot: string;
}

/**
 * Recursively normalise URL fields in a JSON-shaped value.
 *
 * Returns a new value when normalisation changed anything; otherwise returns
 * the input by reference so consumers can compare with `===`.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub
export function normalizeBackendUrls<T>(
  value: T,
  options: NormalizeOptions,
): T {
  throw new Error(NOT_IMPLEMENTED);
}

/**
 * Normalise a single URL string. Exposed for use cases that read a URL
 * directly (e.g. bootstrap data) without going through the recursive walker.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub
export function normalizeBackendUrlString(
  value: string,
  options: NormalizeOptions,
): string {
  throw new Error(NOT_IMPLEMENTED);
}
