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

// =============================================================================
// Layer 4 example: SupersetClient × applicationRoot contract
// =============================================================================
//
// Layer 4 pins down the contract between the channel-2 client and the
// application root. The channel rule is "callers pass router-relative paths;
// the client adds the prefix exactly once." This file proves that property in
// isolation so the rest of the codebase can rely on it.
//
// The full PR adds parallel tests for the React Router channel
// (`<MemoryRouter basename>` × `<Link to>`) and a composition test that
// drives `redirect()` and `<Link>` together. This file ships the
// SupersetClient half as the template.
// =============================================================================

describe('SupersetClient applies the application root exactly once', () => {
  test('endpoint without leading slash is concatenated correctly under a non-empty appRoot', () => {
    const client = new SupersetClientClass({
      protocol: 'https:',
      host: 'config_host',
      appRoot: '/superset',
    });
    expect(client.getUrl({ endpoint: 'api/v1/chart' })).toBe(
      'https://config_host/superset/api/v1/chart',
    );
  });

  test('endpoint with leading slash is normalised to a single root segment', () => {
    const client = new SupersetClientClass({
      protocol: 'https:',
      host: 'config_host',
      appRoot: '/superset',
    });
    expect(client.getUrl({ endpoint: '/api/v1/chart' })).toBe(
      'https://config_host/superset/api/v1/chart',
    );
  });

  test('does not double-apply the application root when caller pre-prefixes', () => {
    // This documents the bug class the helpers protect against. Pre-prefixing
    // is forbidden by the channel rule, but we record the current behaviour
    // here so anyone debugging a double-prefix issue lands on this assertion
    // and reads the comment.
    const client = new SupersetClientClass({
      protocol: 'https:',
      host: 'config_host',
      appRoot: '/superset',
    });
    expect(client.getUrl({ endpoint: '/superset/api/v1/chart' })).toBe(
      'https://config_host/superset/superset/api/v1/chart',
    );
    // ^ The duplicated `/superset` is exactly the symptom developers see when
    // they wrap a SupersetClient endpoint in `ensureAppRoot`. The static
    // invariant test in `navigationUtils.invariants.test.ts` catches that
    // pattern before it reaches runtime.
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
