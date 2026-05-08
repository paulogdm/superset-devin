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

const PREFIX = '/superset';

describe('normalizeBackendUrls', () => {
  test('strips application root from a recognised URL field', () => {
    const input = { id: 1, explore_url: '/superset/explore/?slice_id=1' };
    const output = normalizeBackendUrls(input, { applicationRoot: PREFIX });
    expect(output).toEqual({ id: 1, explore_url: '/explore/?slice_id=1' });
  });

  // The negative cases below prove the normaliser is conservative: it doesn't
  // mutate user content, external URLs, or path segments that merely share
  // text with the configured root.
  test('leaves non-allow-listed fields untouched even when path-shaped', () => {
    const input = { description: '/superset/just-text-from-a-user' };
    expect(normalizeBackendUrls(input, { applicationRoot: PREFIX })).toEqual(
      input,
    );
  });

  test('leaves absolute URLs untouched in recognised fields', () => {
    const input = { explore_url: 'https://other.example.com/superset/foo' };
    expect(normalizeBackendUrls(input, { applicationRoot: PREFIX })).toEqual(
      input,
    );
  });

  test('leaves protocol-relative URLs untouched', () => {
    const input = { explore_url: '//cdn.example.com/superset/foo' };
    expect(normalizeBackendUrls(input, { applicationRoot: PREFIX })).toEqual(
      input,
    );
  });

  test('does not strip a similar-but-different prefix segment', () => {
    // /superset-public/... shares text with /superset but is a different path
    // segment. Only /superset followed by / or end-of-string counts.
    const input = { explore_url: '/superset-public/explore/?slice_id=1' };
    expect(normalizeBackendUrls(input, { applicationRoot: PREFIX })).toEqual(
      input,
    );
  });

  test('is a no-op when application root is empty', () => {
    const input = { explore_url: '/explore/?slice_id=1' };
    expect(normalizeBackendUrls(input, { applicationRoot: '' })).toEqual(input);
  });
});

describe('normalizeBackendUrlString', () => {
  test('strips application root from a router-relative path', () => {
    expect(
      normalizeBackendUrlString('/superset/sqllab', { applicationRoot: PREFIX }),
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

test('NORMALIZED_URL_FIELDS is a Set for O(1) lookup', () => {
  expect(NORMALIZED_URL_FIELDS).toBeInstanceOf(Set);
});
