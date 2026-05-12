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
  CountryMapChartProps,
  CountryMapTransformedProps,
} from '../types';

/**
 * Translate Superset's standard ChartProps into the shape the renderer
 * needs. Notable: derive `geoJsonUrl` from the form data so the renderer
 * can fetch the right output from the build pipeline.
 *
 * URL layout (matches the build script's output naming):
 *   <worldview>_admin0.geo.json                — world choropleth
 *   <worldview>_admin1_<adm0_a3>.geo.json      — country subdivisions
 *   regional_<adm0_a3>_<set>_<worldview>.geo.json — aggregated regions
 *   composite_<id>_<worldview>.geo.json         — composite maps
 *
 * The actual hosting path is wired up in a follow-up commit; for now
 * the renderer prefixes URLs with a stubbed base.
 */
const GEOJSON_BASE = '/static/assets/country-maps';

export default function transformProps(
  chartProps: CountryMapChartProps,
): CountryMapTransformedProps {
  const { formData, queriesData, width, height } = chartProps;
  const data = (queriesData?.[0]?.data as Record<string, unknown>[]) ?? [];

  const worldview = formData.worldview || 'ukr';
  const adminLevel = formData.admin_level ?? 0;

  let geoJsonUrl: string | null = null;
  if (formData.composite) {
    geoJsonUrl = `${GEOJSON_BASE}/composite_${formData.composite}_${worldview}.geo.json`;
  } else if (formData.region_set && formData.country) {
    geoJsonUrl =
      `${GEOJSON_BASE}/regional_${formData.country}_${formData.region_set}_${worldview}.geo.json`;
  } else if (adminLevel === 1 && formData.country) {
    geoJsonUrl =
      `${GEOJSON_BASE}/${worldview}_admin1_${formData.country}.geo.json`;
  } else if (adminLevel === 0) {
    geoJsonUrl = `${GEOJSON_BASE}/${worldview}_admin0.geo.json`;
  }

  return {
    width,
    height,
    formData,
    data,
    geoJsonUrl,
    metricName: typeof formData.metric === 'string' ? formData.metric : null,
    numberFormat: formData.number_format,
    linearColorScheme: formData.linear_color_scheme,
  };
}
