/**
 * Which keys the filter sidebar asks ClickHouse for, when the table's body is a
 * native ClickHouse JSON column.
 *
 * The field list below is the REAL one from `dfe_json_demo.events` -- exactly
 * what `getAllFields` builds from `JSONAllPathsWithTypes` (13 sub-paths under
 * `_json`, four of them String-typed) plus the table's own columns. Reproducing
 * it here rather than mocking a tidy two-field table is the point: the live
 * sidebar offered only `_org_id` and `_source` against this data, and a
 * simplified fixture would not show why.
 *
 * Our tests never live in an upstream test file -- see
 * docs/fork/what-we-changed.md. The mock harness is duplicated from upstream's
 * `DBSearchPageFilters/hooks.test.tsx`, which exports none of it.
 */
/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
import React from 'react';
import { enableMapSet } from 'immer';
import { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';

import api from '@/api';
import { useFetchFacets } from '@/components/DBSearchPageFilters/hooks';
import * as useMetadataModule from '@/hooks/useMetadata';
import * as searchFiltersModule from '@/searchFilters';
import * as sourceModule from '@/source';

enableMapSet();

jest.mock('@/api', () => ({
  __esModule: true,
  default: { useMe: jest.fn() },
}));

jest.mock('@/source', () => ({
  __esModule: true,
  useSource: jest.fn(),
}));

jest.mock('@/searchFilters', () => ({
  __esModule: true,
  usePinnedFilters: jest.fn(),
  escapeFilterStateKeys: jest.fn((state: unknown) => state),
}));

jest.mock('@/hooks/useMetadata', () => ({
  __esModule: true,
  useMetadataWithSettings: jest.fn(),
  useColumns: jest.fn(),
  useDateTimeColumns: jest.fn(),
  useJsonColumns: jest.fn(),
  useMapColumns: jest.fn(),
  useAllFields: jest.fn(),
  useGetKeyValues: jest.fn(),
}));

const useMe = jest.mocked(api.useMe);
const useSource = jest.mocked(sourceModule.useSource);
const usePinnedFilters = jest.mocked(searchFiltersModule.usePinnedFilters);
const useMetadataWithSettings = jest.mocked(
  useMetadataModule.useMetadataWithSettings,
);
const useColumns = jest.mocked(useMetadataModule.useColumns);
const useDateTimeColumns = jest.mocked(useMetadataModule.useDateTimeColumns);
const useJsonColumns = jest.mocked(useMetadataModule.useJsonColumns);
const useMapColumns = jest.mocked(useMetadataModule.useMapColumns);
const useAllFields = jest.mocked(useMetadataModule.useAllFields);
const useGetKeyValues = jest.mocked(useMetadataModule.useGetKeyValues);

const DATE_RANGE: [Date, Date] = [
  new Date('2026-08-24T16:00:00Z'),
  new Date('2026-08-25T00:00:00Z'),
];

const CHART_CONFIG: BuilderChartConfigWithDateRange = {
  connection: 'conn1',
  from: { databaseName: 'dfe_json_demo', tableName: 'events' },
  timestampValueExpression: '_timestamp',
  select: '',
  where: '',
  whereLanguage: 'sql',
  dateRange: DATE_RANGE,
};

// dfe_json_demo.events, verbatim.
const COLUMNS = [
  { name: '_timestamp', type: "DateTime64(3, 'UTC')" },
  { name: '_org_id', type: 'LowCardinality(String)' },
  { name: '_source', type: 'LowCardinality(String)' },
  { name: '_raw', type: 'Nullable(String)' },
  { name: '_json', type: 'JSON' },
  { name: '_tags', type: 'JSON' },
];

// getAllFields output: the columns above, then one entry per JSON sub-path with
// the type ClickHouse reported. `duration_ms` and `src.port` are deliberately
// mixed-type in the demo data; getJSONKeys keeps typeArr[0], so which type they
// land on is arbitrary -- that is reproduced here, not tidied away.
const ALL_FIELDS = [
  ...COLUMNS.map(c => ({
    path: [c.name],
    type: c.type,
    jsType: jsTypeOf(c.type),
  })),
  ...(
    [
      ['user.name', 'String'],
      ['user.id', 'Int64'],
      ['user.admin', 'Bool'],
      ['event.action', 'String'],
      ['event.outcome', 'String'],
      ['event.severity', 'Int64'],
      ['src.ip', 'String'],
      ['src.port', 'Int64'],
      ['duration_ms', 'Float64'],
      ['bytes', 'Int64'],
      ['ok', 'Bool'],
      ['http.status_code', 'Int64'],
      ['labels', 'Array(Nullable(String))'],
    ] as const
  ).map(([key, type]) => ({
    path: ['_json', key],
    type,
    jsType: jsTypeOf(type),
  })),
  ...(
    [
      ['env', 'String'],
      ['team', 'String'],
      ['pipeline.stage', 'String'],
      ['pipeline.version', 'Int64'],
    ] as const
  ).map(([key, type]) => ({
    path: ['_tags', key],
    type,
    jsType: jsTypeOf(type),
  })),
];

// Mirrors convertCHDataTypeToJSType for the handful of types this fixture uses.
function jsTypeOf(type: string): string | null {
  if (type.startsWith('LowCardinality(')) return jsTypeOf(type.slice(15, -1));
  if (type.startsWith('Nullable(')) return jsTypeOf(type.slice(9, -1));
  if (type.startsWith('Date')) return 'date';
  if (type.startsWith('Array')) return 'array';
  if (type.startsWith('JSON')) return 'json';
  if (type === 'Bool') return 'bool';
  if (type.startsWith('Int') || type.startsWith('Float')) return 'number';
  if (type.startsWith('String')) return 'string';
  return null;
}

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function setup({ jsonColumns }: { jsonColumns: string[] }) {
  useMe.mockReturnValue({
    data: { team: { filterKeysFetchLimit: 100 } },
    isFetched: true,
  } as any);
  useSource.mockReturnValue({
    data: {
      id: 'source1',
      kind: 'log',
      name: 'JSON Demo',
      connection: 'conn1',
      from: { databaseName: 'dfe_json_demo', tableName: 'events' },
      timestampValueExpression: '_timestamp',
    },
    isLoading: false,
  } as any);
  useColumns.mockReturnValue({ data: COLUMNS, isLoading: false } as any);
  useDateTimeColumns.mockReturnValue([COLUMNS[0]] as any);
  useJsonColumns.mockReturnValue({ data: jsonColumns } as any);
  useMapColumns.mockReturnValue({ data: [] } as any);
  useAllFields.mockReturnValue({ data: ALL_FIELDS } as any);
  usePinnedFilters.mockReturnValue({
    isFieldPinned: jest.fn().mockReturnValue(false),
    isSharedFieldPinned: jest.fn().mockReturnValue(false),
  } as any);
  useMetadataWithSettings.mockReturnValue({
    getKeyValuesWithMVs: jest.fn(),
    getAllKeyValues: jest.fn(),
  } as any);
  useGetKeyValues.mockReturnValue({
    data: undefined,
    isLoading: false,
    isFetching: false,
    error: null,
  } as any);
}

/** The `keys` argument the sidebar hands to useGetKeyValues. */
function renderAndCaptureKeys(showMoreFields: boolean): string[] {
  renderHook(
    () =>
      useFetchFacets({
        chartConfig: CHART_CONFIG,
        sourceId: 'source1',
        mode: 'all',
        dateRange: DATE_RANGE,
        showMoreFields,
      }),
    { wrapper },
  );
  return useGetKeyValues.mock.calls.at(-1)?.[0]?.keys ?? [];
}

describe('filter sidebar over a native JSON body column', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setup({ jsonColumns: ['_json', '_tags'] });
  });

  it('offers the String-typed JSON sub-paths by default', () => {
    const keys = renderAndCaptureKeys(false);

    expect(keys).toEqual(
      expect.arrayContaining([
        '_json.`user`.`name`',
        '_json.`event`.`action`',
        '_json.`event`.`outcome`',
        '_json.`src`.`ip`',
        '_tags.`env`',
        '_tags.`team`',
        '_tags.`pipeline`.`stage`',
      ]),
    );
  });

  it('still offers the plain low-cardinality columns', () => {
    expect(renderAndCaptureKeys(false)).toEqual(
      expect.arrayContaining(['_org_id', '_source']),
    );
  });

  it('never emits bracket subscripts on a JSON column', () => {
    // `_json['user.name']` is arrayElement, which ClickHouse refuses outright
    // on a JSON column (Code 43).
    for (const key of renderAndCaptureKeys(true)) {
      expect(key).not.toMatch(/^_json\[|^_tags\[/);
    }
  });

  it('does not offer the JSON columns themselves as filters', () => {
    const keys = renderAndCaptureKeys(true);
    expect(keys).not.toContain('_json');
    expect(keys).not.toContain('_tags');
  });

  // useJsonColumns and useColumns are separate react-query entries, so the
  // first render can build keys before the JSON column list has arrived. Those
  // keys are bracket-form; getAllKeyValues drops them rather than emitting
  // arrayElement against a JSON column. Pinned so the transient shape stays
  // visible if this hook is ever reworked.
  it('builds bracket-form keys while useJsonColumns is still resolving', () => {
    jest.clearAllMocks();
    setup({ jsonColumns: [] });

    expect(renderAndCaptureKeys(false)).toEqual(
      expect.arrayContaining(["_json['user.name']"]),
    );
  });
});
