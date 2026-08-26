/**
 * Component-level coverage for native ClickHouse JSON columns in the row viewer.
 *
 * These assertions USED to live inside upstream's DBRowJsonViewer.test.tsx.
 * They are here instead because upstream churns that file harder than almost
 * any other in the fork's surface (11 commits, with #2561 queued in
 * upstream/main right now), and `git rerere` only replays a resolution when the
 * conflict preimage matches exactly. Our assertions in their file meant a
 * guaranteed hand-resolve on every sync, for tests upstream has no stake in.
 *
 * The house rule this encodes: OUR TESTS NEVER LIVE IN AN UPSTREAM TEST FILE.
 * See docs/fork/what-we-changed.md.
 *
 * The helpers below are duplicated from upstream's test file rather than
 * imported, because it exports none of them. That is deliberate - a few lines
 * of duplication in a file we own beats a permanent conflict in one we do not.
 */
import React from 'react';
import { fireEvent, screen, within } from '@testing-library/react';

import { DBRowJsonViewer } from '@/components/DBRowJsonViewer';
import { RowSidePanelContext } from '@/components/DBRowSidePanel';

jest.mock('next/router', () => ({
  __esModule: true,
  default: { push: jest.fn() },
}));

jest.mock('@/useFormatTime', () => ({
  useFormatTime: () => jest.fn((t: unknown) => String(t)),
  FormatTime: jest.fn(() => null),
}));

const ACTION_TITLE: Record<string, string> = {
  Search: 'search for this value only',
  'Add to Filters': 'add to filters',
  Exclude: 'exclude this value',
  Column: 'column to results table',
};

describe('DBRowJsonViewer - native ClickHouse JSON columns', () => {
  const mockGenerateSearchUrl = jest.fn();
  const mockOnPropertyAddClick = jest.fn();
  const mockToggleColumn = jest.fn();

  const context = {
    generateSearchUrl: mockGenerateSearchUrl,
    onPropertyAddClick: mockOnPropertyAddClick,
    toggleColumn: mockToggleColumn,
    displayedColumns: [],
    generateChartUrl: jest.fn(),
  };

  // A native JSON column, as the DFE loader writes it. The port and the flag
  // are here because JSONExtractString returns '' for anything that is not a
  // JSON string, so a non-string field used to filter to zero rows.
  const nativeJsonData = {
    _json: { _source: 'simple_fetcher_to_loader_kafka', port: 8080, ok: true },
  };

  beforeEach(() => jest.clearAllMocks());

  const render = () =>
    renderWithMantine(
      <RowSidePanelContext value={context}>
        <DBRowJsonViewer data={nativeJsonData} jsonColumns={['_json']} />
      </RowSidePanelContext>,
    );

  // The tree renders expanded by default - clicking the parent COLLAPSES it.
  const clickAction = (fieldText: string, action: string) => {
    const line = screen.getByText(fieldText).closest('.line')! as HTMLElement;
    fireEvent.mouseEnter(line);
    const needle = ACTION_TITLE[action].toLowerCase();
    fireEvent.click(
      within(line).getByTitle((content: string) =>
        (content ?? '').toLowerCase().includes(needle),
      ),
    );
  };

  it('searches on the sub-path, not a bracket subscript', () => {
    render();
    clickAction('_source', 'Search');

    // _json['_source'] would be arrayElement on a JSON column, which
    // ClickHouse rejects outright.
    expect(mockGenerateSearchUrl).toHaveBeenCalledWith({
      where: "toString(_json.`_source`) = 'simple_fetcher_to_loader_kafka'",
      whereLanguage: 'sql',
    });
  });

  it('adds a filter with the sub-path expression', () => {
    render();
    clickAction('_source', 'Add to Filters');

    expect(mockOnPropertyAddClick).toHaveBeenCalledWith(
      'toString(_json.`_source`)',
      'simple_fetcher_to_loader_kafka',
    );
  });

  it('excludes with the same expression the include action filters on', () => {
    render();
    clickAction('_source', 'Exclude');

    expect(mockOnPropertyAddClick).toHaveBeenCalledWith(
      'toString(_json.`_source`)',
      'simple_fetcher_to_loader_kafka',
      'exclude',
    );
  });

  it('toggles a column with the sub-path expression', () => {
    render();
    clickAction('_source', 'Column');

    expect(mockToggleColumn).toHaveBeenCalledWith('toString(_json.`_source`)');
  });

  it('filters a numeric field on its text form rather than an empty string', () => {
    render();
    clickAction('port', 'Add to Filters');

    expect(mockOnPropertyAddClick).toHaveBeenCalledWith(
      'toString(_json.`port`)',
      '8080',
    );
  });

  it('filters a boolean field the same way', () => {
    render();
    clickAction('ok', 'Exclude');

    expect(mockOnPropertyAddClick).toHaveBeenCalledWith(
      'toString(_json.`ok`)',
      'true',
      'exclude',
    );
  });
});
