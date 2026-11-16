/**
 * The row viewer hides null and blank fields until the viewer turns them back
 * on. A DFE row carries every typed column of its vendor table, and most are
 * null on any one message, so the full list buries the few that hold data.
 *
 * Upstream already ships the filter and its "Hide blank values" menu item. The
 * fork flips the default in DEFAULT_VIEWER_OPTIONS, so a viewer who never chose
 * an option gets it on. Kept here, not in upstream's DBRowJsonViewer tests.
 */
import React from 'react';
import { screen } from '@testing-library/react';

import {
  DBRowJsonViewer,
  migrateViewerOptions,
} from '@/components/DBRowJsonViewer';
import { RowSidePanelContext } from '@/components/DBRowSidePanel';

jest.mock('next/router', () => ({
  __esModule: true,
  default: { push: jest.fn() },
}));

jest.mock('@/useFormatTime', () => ({
  useFormatTime: () => jest.fn((t: unknown) => String(t)),
  FormatTime: jest.fn(() => null),
}));

const context = {
  generateSearchUrl: jest.fn(),
  onPropertyAddClick: jest.fn(),
  toggleColumn: jest.fn(),
  displayedColumns: [],
  generateChartUrl: jest.fn(),
};

const row = {
  message_id: 'asa-302013',
  cisco_asa_aaa_type: null,
  cisco_asa_burst_rate: '',
  nested: { kept: 'yes', dropped: null },
};

const render = () =>
  renderWithMantine(
    <RowSidePanelContext value={context}>
      <DBRowJsonViewer data={row} />
    </RowSidePanelContext>,
  );

describe('DBRowJsonViewer - hide blank values by default', () => {
  beforeEach(() => localStorage.clear());

  it('shows fields with data and hides null and empty ones', () => {
    render();

    expect(screen.getByText('message_id')).toBeInTheDocument();
    expect(screen.getByText('kept')).toBeInTheDocument();
    expect(screen.queryByText('cisco_asa_aaa_type')).not.toBeInTheDocument();
    expect(screen.queryByText('cisco_asa_burst_rate')).not.toBeInTheDocument();
    expect(screen.queryByText('dropped')).not.toBeInTheDocument();
  });

  it('shows the blank fields for a viewer who stored the option off', () => {
    localStorage.setItem(
      'hdx_json_viewer_options',
      JSON.stringify({
        normallyExpanded: true,
        whiteSpace: 'pre-wrap',
        tabulate: true,
        filterBlanks: false,
      }),
    );
    render();

    expect(screen.getByText('cisco_asa_aaa_type')).toBeInTheDocument();
    expect(screen.getByText('cisco_asa_burst_rate')).toBeInTheDocument();
    expect(screen.getByText('dropped')).toBeInTheDocument();
  });

  it('keeps a stored choice of on', () => {
    const stored = JSON.stringify({ filterBlanks: true });

    expect(migrateViewerOptions(stored)?.filterBlanks).toBe(true);
  });

  it('defaults filterBlanks to true when nothing is stored', () => {
    expect(migrateViewerOptions(null)).toBeNull();
    expect(
      migrateViewerOptions(JSON.stringify({ lineWrap: true }))?.filterBlanks,
    ).toBe(true);
  });
});
