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
import { SupersetClientClass } from '@superset-ui/core';

// SupersetClient is expected to apply the configured appRoot exactly once.
// Callers must pass router-relative endpoints; pre-prefixing causes the
// double-prefix bug documented below.

describe('SupersetClient applies the application root exactly once', () => {
  const buildClient = () =>
    new SupersetClientClass({
      protocol: 'https:',
      host: 'config_host',
      appRoot: '/superset',
    });

  test('endpoint without leading slash is concatenated correctly', () => {
    expect(buildClient().getUrl({ endpoint: 'api/v1/chart' })).toBe(
      'https://config_host/superset/api/v1/chart',
    );
  });

  test('endpoint with leading slash is normalised to a single root segment', () => {
    expect(buildClient().getUrl({ endpoint: '/api/v1/chart' })).toBe(
      'https://config_host/superset/api/v1/chart',
    );
  });

  // Documents the double-prefix symptom: wrapping the endpoint in
  // ensureAppRoot before passing it to SupersetClient duplicates the root.
  // navigationUtils.invariants.test.ts catches this pattern statically.
  test('does not double-apply the application root when caller pre-prefixes', () => {
    expect(buildClient().getUrl({ endpoint: '/superset/api/v1/chart' })).toBe(
      'https://config_host/superset/superset/api/v1/chart',
    );
  });

  test('empty application root produces no prefix segment', () => {
    const client = new SupersetClientClass({
      protocol: 'https:',
      host: 'config_host',
    });
    expect(client.getUrl({ endpoint: '/api/v1/chart' })).toBe(
      'https://config_host/api/v1/chart',
    );
  });
});
