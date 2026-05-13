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
import { ChartProps } from '@superset-ui/core';
import transformProps from '../../src/plugin/transformProps';
import { CountryMapChartProps, CountryMapFormData } from '../../src/types';

const baseFormData: CountryMapFormData = {
  datasource: '3__table',
  viz_type: 'country_map',
};

const buildChartProps = (
  formData: Partial<CountryMapFormData>,
  data: Record<string, unknown>[] = [],
): CountryMapChartProps =>
  new ChartProps({
    formData: { ...baseFormData, ...formData },
    width: 800,
    height: 600,
    queriesData: [{ data }],
  } as any) as CountryMapChartProps;

test('Admin 0 (no country) → world choropleth URL', () => {
  const out = transformProps(
    buildChartProps({ admin_level: 0, worldview: 'ukr' }),
  );
  expect(out.geoJsonUrl).toBe(
    '/static/assets/country-maps/ukr_admin0.geo.json',
  );
});

test('Admin 1 + country → per-country file URL', () => {
  const out = transformProps(
    buildChartProps({ admin_level: 1, country: 'FRA', worldview: 'ukr' }),
  );
  expect(out.geoJsonUrl).toBe(
    '/static/assets/country-maps/ukr_admin1_FRA.geo.json',
  );
});

test('Region set + country → regional aggregation URL', () => {
  const out = transformProps(
    buildChartProps({
      admin_level: 1,
      country: 'TUR',
      region_set: 'nuts_1',
      worldview: 'ukr',
    }),
  );
  expect(out.geoJsonUrl).toBe(
    '/static/assets/country-maps/regional_TUR_nuts_1_ukr.geo.json',
  );
});

test('Composite overrides admin_level + country', () => {
  const out = transformProps(
    buildChartProps({
      admin_level: 1,
      country: 'FRA',
      composite: 'france_overseas',
      worldview: 'ukr',
    }),
  );
  expect(out.geoJsonUrl).toBe(
    '/static/assets/country-maps/composite_france_overseas_ukr.geo.json',
  );
});

test('Worldview defaults to ukr when not specified', () => {
  const out = transformProps(buildChartProps({ admin_level: 0 }));
  expect(out.geoJsonUrl).toBe(
    '/static/assets/country-maps/ukr_admin0.geo.json',
  );
});

test('Different worldview reflected in URL', () => {
  const out = transformProps(
    buildChartProps({ admin_level: 0, worldview: 'default' }),
  );
  expect(out.geoJsonUrl).toBe(
    '/static/assets/country-maps/default_admin0.geo.json',
  );
});

test('Admin 1 without country → no URL (chart UI should prompt)', () => {
  const out = transformProps(buildChartProps({ admin_level: 1 }));
  expect(out.geoJsonUrl).toBeNull();
});

test('Passes through metricName, numberFormat, linearColorScheme', () => {
  const out = transformProps(
    buildChartProps({
      admin_level: 0,
      metric: 'sum__num',
      number_format: 'SMART_NUMBER',
      linear_color_scheme: 'schemeBlues',
    }),
  );
  expect(out.metricName).toBe('sum__num');
  expect(out.numberFormat).toBe('SMART_NUMBER');
  expect(out.linearColorScheme).toBe('schemeBlues');
});

test('Passes through query data rows', () => {
  const data = [
    { iso: 'FR-75C', sum__num: 100 },
    { iso: 'FR-971', sum__num: 50 },
  ];
  const out = transformProps(buildChartProps({ admin_level: 0 }, data));
  expect(out.data).toEqual(data);
});

test('Passes through width/height', () => {
  const out = transformProps(buildChartProps({ admin_level: 0 }));
  expect(out.width).toBe(800);
  expect(out.height).toBe(600);
});
