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
import { t } from '@apache-superset/core/translation';
import {
  ControlPanelConfig,
  sections,
} from '@superset-ui/chart-controls';

/**
 * Minimal first-pass control panel. Subsequent commits will:
 * - Populate the worldview + admin-level + country selectors with
 *   options derived from the build pipeline's manifest
 * - Add region include/exclude multi-selects, flying-islands toggle,
 *   name-language picker, and the regional/composite layer pickers
 * - Wire up dependent visibility (country only when admin_level=1, etc.)
 */
const config: ControlPanelConfig = {
  controlPanelSections: [
    sections.legacyTimeseriesTime,
    {
      label: t('Query'),
      expanded: true,
      controlSetRows: [
        ['metric'],
        ['adhoc_filters'],
        ['row_limit'],
      ],
    },
    {
      label: t('Map'),
      expanded: true,
      controlSetRows: [
        // TODO: worldview selector — pull options from the build manifest.
        // TODO: admin_level segmented control (0 / 1 / Aggregated).
        // TODO: country picker (visible when admin_level !== 0).
        // TODO: region_set selector (when 'Aggregated' chosen).
        // TODO: composite selector (when applicable).
        // TODO: region_includes / region_excludes multi-selects.
        // TODO: show_flying_islands toggle (default: true).
        // TODO: name_language selector.
        [
          {
            name: 'select_country_placeholder',
            config: {
              type: 'TextControl',
              label: t('Country (placeholder)'),
              description: t(
                'Placeholder field — replaced in next commit with the full ' +
                  'control set (worldview, admin level, country picker, etc.)',
              ),
              default: '',
              renderTrigger: false,
            },
          },
        ],
      ],
    },
    {
      label: t('Chart Options'),
      expanded: true,
      controlSetRows: [
        ['linear_color_scheme'],
        ['number_format'],
      ],
    },
  ],
};

export default config;
