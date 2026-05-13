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
 * @fileoverview Standalone views registry implementation.
 *
 * Stores view metadata and providers as module-level state.
 * Extensions register views as side effects at import time.
 */

import React, { ReactElement } from 'react';
import type { views as viewsApi } from '@apache-superset/core';
import { ErrorBoundary } from 'src/components/ErrorBoundary';
import ExtensionPlaceholder from 'src/extensions/ExtensionPlaceholder';
import { Disposable } from '../models';

type View = viewsApi.View;

const viewRegistry: Map<
  string,
  { view: View; location: string; provider: () => ReactElement }
> = new Map();

const locationIndex: Map<string, Set<string>> = new Map();

// Subscribers notified when views at a specific location change
const locationListeners: Map<string, Set<() => void>> = new Map();

/**
 * Subscribe to view registrations at a given location.
 * Returns an unsubscribe function. Useful for components that need to
 * re-render when an extension registers a view after async load.
 */
export const onViewsChange = (
  location: string,
  cb: () => void,
): (() => void) => {
  const listeners = locationListeners.get(location) ?? new Set();
  listeners.add(cb);
  locationListeners.set(location, listeners);
  return () => listeners.delete(cb);
};

const registerView: typeof viewsApi.registerView = (
  view: View,
  location: string,
  provider: () => ReactElement,
): Disposable => {
  const { id } = view;

  viewRegistry.set(id, { view, location, provider });

  const ids = locationIndex.get(location) ?? new Set();
  ids.add(id);
  locationIndex.set(location, ids);

  // Notify any React components waiting on this location
  locationListeners.get(location)?.forEach(cb => cb());

  return new Disposable(() => {
    viewRegistry.delete(id);
    locationIndex.get(location)?.delete(id);
    locationListeners.get(location)?.forEach(cb => cb());
  });
};

export const resolveView = (id: string): ReactElement => {
  const provider = viewRegistry.get(id)?.provider;
  if (!provider) {
    return React.createElement(ExtensionPlaceholder, { id });
  }
  return React.createElement(ErrorBoundary, null, provider());
};

const getViews: typeof viewsApi.getViews = (
  location: string,
): View[] | undefined => {
  const ids = locationIndex.get(location);
  if (!ids || ids.size === 0) return undefined;

  return Array.from(ids)
    .map(id => viewRegistry.get(id)?.view)
    .filter((c): c is View => !!c);
};

export const views: typeof viewsApi = {
  registerView,
  getViews,
};
