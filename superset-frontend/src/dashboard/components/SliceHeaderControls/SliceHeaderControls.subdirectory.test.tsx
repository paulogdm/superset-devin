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
import { render, screen, userEvent } from 'spec/helpers/testing-library';
import { VizType } from '@superset-ui/core';
import mockState from 'spec/fixtures/mockState';
import SliceHeaderControls, { SliceHeaderControlsProps } from '.';

// =============================================================================
// Layer 5 example: per-site regression test for SliceHeaderControls
// =============================================================================
//
// Subdirectory-specific behaviour for SliceHeaderControls. The full PR adds
// parallel files for RedirectWarning, ResultSet, DatasourceEditor,
// SaveDatasetModal, ViewQuery, plus reinstates the regression tests from
// commits 86fe4fc8b2 (chart export) and 36a32e7b49 (SavedQueryList,
// dashboard fullscreen) which haven't merged to master yet.
//
// Why a separate file: the existing SliceHeaderControls.test.tsx is 676 lines
// of shared setup that does not mock `getBootstrapData`. Mocking it at the
// top of that file would force every existing test to consider application
// root behaviour. Putting subdirectory regressions in their own file keeps
// the mock surface explicit and discoverable by name.
//
// This test is RED today: SliceHeaderControls/index.tsx:266 calls
// `window.open(props.exploreUrl, '_blank')` without prefixing the root, so
// the assertion below fails. The migration commit replaces that call with
// `openInNewTab(props.exploreUrl)` (which prefixes internally) and the test
// goes green.
// =============================================================================

const APPLICATION_ROOT_MOCK = jest.fn<string, []>(() => '');

jest.mock('src/utils/getBootstrapData', () => ({
  applicationRoot: () => APPLICATION_ROOT_MOCK(),
}));

const SLICE_ID = 371;

const buildProps = (): SliceHeaderControlsProps =>
  ({
    addDangerToast: jest.fn(),
    addSuccessToast: jest.fn(),
    exploreChart: jest.fn(),
    exportCSV: jest.fn(),
    exportFullCSV: jest.fn(),
    exportXLSX: jest.fn(),
    exportFullXLSX: jest.fn(),
    exportPivotExcel: jest.fn(),
    forceRefresh: jest.fn(),
    handleToggleFullSize: jest.fn(),
    toggleExpandSlice: jest.fn(),
    logEvent: jest.fn(),
    logExploreChart: jest.fn(),
    slice: {
      slice_id: SLICE_ID,
      slice_url: '/explore/?form_data=%7B%22slice_id%22%3A%20371%7D',
      slice_name: 'Subdirectory regression chart',
      slice_description: '',
      form_data: {
        slice_id: SLICE_ID,
        datasource: '58__table',
        viz_type: VizType.Sunburst,
      },
      viz_type: VizType.Sunburst,
      datasource: '58__table',
      description: '',
      description_markeddown: '',
      owners: [],
      modified: '',
      changed_on: 0,
    },
    isCached: [false],
    isExpanded: false,
    cachedDttm: [''],
    updatedDttm: 0,
    supersetCanExplore: true,
    supersetCanCSV: true,
    componentId: 'CHART-subdir',
    dashboardId: 26,
    isFullSize: false,
    chartStatus: 'rendered',
    showControls: true,
    supersetCanShare: true,
    formData: {
      slice_id: SLICE_ID,
      datasource: '58__table',
      viz_type: VizType.Sunburst,
    },
    exploreUrl: '/explore/?dashboard_page_id=abc&slice_id=371',
    defaultOpen: true,
  }) as unknown as SliceHeaderControlsProps;

const renderControls = (): void => {
  render(<SliceHeaderControls {...buildProps()} />, {
    useRedux: true,
    useRouter: true,
    initialState: {
      ...mockState,
      user: {
        ...mockState.user,
        roles: { Admin: [['can_samples', 'Datasource']] },
      },
    },
  });
};

describe('SliceHeaderControls — Cmd-click "Edit chart" under subdirectory deployment', () => {
  let openSpy: jest.SpyInstance;

  beforeEach(() => {
    APPLICATION_ROOT_MOCK.mockReturnValue('');
    openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  test('opens the unprefixed exploreUrl when application root is empty', async () => {
    APPLICATION_ROOT_MOCK.mockReturnValue('');
    renderControls();

    userEvent.click(screen.getByRole('button', { name: 'More Options' }));
    const editChart = await screen.findByText('Edit chart');
    userEvent.click(editChart, { metaKey: true });

    expect(openSpy).toHaveBeenCalledWith(
      '/explore/?dashboard_page_id=abc&slice_id=371',
      '_blank',
      'noopener noreferrer',
    );
  });

  test('opens the prefixed exploreUrl when deployed under a subdirectory', async () => {
    APPLICATION_ROOT_MOCK.mockReturnValue('/superset');
    renderControls();

    userEvent.click(screen.getByRole('button', { name: 'More Options' }));
    const editChart = await screen.findByText('Edit chart');
    userEvent.click(editChart, { metaKey: true });

    expect(openSpy).toHaveBeenCalledWith(
      '/superset/explore/?dashboard_page_id=abc&slice_id=371',
      '_blank',
      'noopener noreferrer',
    );
  });
});
