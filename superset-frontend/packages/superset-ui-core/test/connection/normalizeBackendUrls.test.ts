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
  normalizeBackendUrls,
  normalizeBackendUrlString,
  NORMALIZED_URL_FIELDS,
} from '../../src/connection/normalizeBackendUrls';

// =============================================================================
// Layer 3 example: backend URL normaliser
// =============================================================================
//
// Layer 3 has two halves: positive tests (the normaliser strips the
// configured root from values in `NORMALIZED_URL_FIELDS`) and negative tests
// (it leaves everything else alone). The negative half carries most of the
// safety value — it's how we prove the normaliser doesn't over-reach.
//
// The full PR adds:
//   • Per-field positive tests for every entry in NORMALIZED_URL_FIELDS
//   • Per-field negative tests for every entry in NORMALIZER_EXCLUSIONS
//   • Recursion through arrays and nested objects
//   • Idempotence: `normalize(normalize(x))` equals `normalize(x)`
//   • Per-call opt-out hook from SupersetClient
//
// This file ships one positive + one negative test as a template.
// =============================================================================

const PREFIX = '/superset';

describe('normalizeBackendUrls (Layer 3 — positive)', () => {
  test('strips configured application root from a recognised URL field', () => {
    // `explore_url` will be added to NORMALIZED_URL_FIELDS in the green commit.
    // Until then this assertion exists to drive that decision.
    const input = { id: 1, explore_url: '/superset/explore/?slice_id=1' };
    const output = normalizeBackendUrls(input, { applicationRoot: PREFIX });
    expect(output).toEqual({ id: 1, explore_url: '/explore/?slice_id=1' });
  });
});

describe('normalizeBackendUrls (Layer 3 — negative passthrough)', () => {
  test('leaves random non-allow-listed fields alone even when value looks path-shaped', () => {
    // `description` is not — and must never be — a URL field. A user could
    // legitimately type `/looks/like/a/path` into a description; stripping
    // the prefix would silently mutate user content.
    const input = { description: '/superset/just-text-from-a-user' };
    const output = normalizeBackendUrls(input, { applicationRoot: PREFIX });
    expect(output).toEqual(input);
  });

  test('leaves absolute URLs alone in recognised fields', () => {
    const input = { explore_url: 'https://other.example.com/superset/foo' };
    const output = normalizeBackendUrls(input, { applicationRoot: PREFIX });
    expect(output).toEqual(input);
  });

  test('leaves protocol-relative URLs alone', () => {
    const input = { explore_url: '//cdn.example.com/superset/foo' };
    const output = normalizeBackendUrls(input, { applicationRoot: PREFIX });
    expect(output).toEqual(input);
  });

  test('does not strip a similar-but-different prefix segment', () => {
    // `/superset-public/...` shares the `/superset` text but is a different
    // path segment. Conservative match: only `/superset` followed by `/` or
    // end-of-string is treated as the application root.
    const input = { explore_url: '/superset-public/explore/?slice_id=1' };
    const output = normalizeBackendUrls(input, { applicationRoot: PREFIX });
    expect(output).toEqual(input);
  });

  test('is a no-op when application root is empty', () => {
    const input = { explore_url: '/explore/?slice_id=1' };
    const output = normalizeBackendUrls(input, { applicationRoot: '' });
    expect(output).toEqual(input);
  });
});

describe('normalizeBackendUrlString (Layer 3 — string-level entry point)', () => {
  test('strips application root from a router-relative path', () => {
    expect(
      normalizeBackendUrlString('/superset/sqllab', {
        applicationRoot: PREFIX,
      }),
    ).toBe('/sqllab');
  });

  test('passes absolute URLs through unchanged', () => {
    expect(
      normalizeBackendUrlString('https://external.example.com/foo', {
        applicationRoot: PREFIX,
      }),
    ).toBe('https://external.example.com/foo');
  });
});

describe('NORMALIZED_URL_FIELDS (allow-list shape)', () => {
  test('is a Set so callers can rely on O(1) membership checks', () => {
    expect(NORMALIZED_URL_FIELDS).toBeInstanceOf(Set);
  });
});
