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

  // A native JSON column, as the DFE loader writes it.
  const nativeJsonData = {
    _json: { _source: 'simple_fetcher_to_loader_kafka' },
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

  it('searches with JSONExtractString, not a bracket subscript', () => {
    render();
    clickAction('_source', 'Search');

    // _json['_source'] would be arrayElement on a JSON column, which
    // ClickHouse rejects outright.
    expect(mockGenerateSearchUrl).toHaveBeenCalledWith({
      where:
        "JSONExtractString(toString(_json), '_source') = 'simple_fetcher_to_loader_kafka'",
      whereLanguage: 'sql',
    });
  });

  it('adds a filter with the extract expression', () => {
    render();
    clickAction('_source', 'Add to Filters');

    expect(mockOnPropertyAddClick).toHaveBeenCalledWith(
      "JSONExtractString(toString(_json), '_source')",
      'simple_fetcher_to_loader_kafka',
    );
  });

  it('toggles a column with the extract expression', () => {
    render();
    clickAction('_source', 'Column');

    expect(mockToggleColumn).toHaveBeenCalledWith(
      "JSONExtractString(toString(_json), '_source')",
    );
  });
});
