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
import { FC, useEffect, useRef, useState } from 'react';
import { CountryMapTransformedProps } from './types';

/**
 * Placeholder renderer. Real implementation in the next commit will
 * port the legacy plugin's D3 rendering logic, then progressively
 * incorporate:
 *   - region include/exclude client-side filtering
 *   - flying-islands toggle (drop matched features when off)
 *   - fit-to-selection projection refit
 *   - tooltip + cross-filter integration
 *   - composite projections (geoAlbersUsa etc.) when configured
 */
const CountryMap: FC<CountryMapTransformedProps> = props => {
  const { width, height, geoJsonUrl, data, metricName } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [featureCount, setFeatureCount] = useState<number | null>(null);

  useEffect(() => {
    if (!geoJsonUrl) {
      setError('No GeoJSON URL resolved (check worldview / admin_level / country).');
      return;
    }
    setError(null);
    fetch(geoJsonUrl)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${geoJsonUrl}`);
        return r.json();
      })
      .then((geo: GeoJSON.FeatureCollection) => {
        setFeatureCount(geo.features?.length ?? 0);
      })
      .catch(e => setError(String(e)));
  }, [geoJsonUrl]);

  return (
    <div
      ref={ref}
      style={{
        width,
        height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        fontFamily: 'monospace',
        fontSize: 12,
        color: '#666',
        border: '1px dashed #ccc',
      }}
    >
      <div style={{ fontWeight: 'bold', marginBottom: 8 }}>
        Country Map (scaffold)
      </div>
      <div>geoJsonUrl: {geoJsonUrl ?? '(none)'}</div>
      <div>features loaded: {featureCount ?? '(loading)'}</div>
      <div>data rows: {data.length}</div>
      <div>metric: {metricName ?? '(none)'}</div>
      {error && (
        <div style={{ color: '#c00', marginTop: 8 }}>error: {error}</div>
      )}
    </div>
  );
};

export default CountryMap;
