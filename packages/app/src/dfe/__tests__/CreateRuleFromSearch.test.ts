jest.mock('@/api', () => ({ hdxServer: jest.fn() }));
jest.mock('@/config', () => ({ DFE_UI_BASE_URL: 'http://dfe-ui.test' }));

import { isChartConfigStale } from '@/dfe/components/CreateRuleFromSearch';

const config = (source: string) => ({ source });

describe('isChartConfigStale', () => {
  it.each([
    ['source on screen matches the config', config('a'), 'a', false],
    ['picker moved on, config still on the old source', config('a'), 'b', true],
    ['no config yet', null, 'a', true],
    ['no source on screen', config('a'), undefined, false],
  ])('%s', (_name, chartConfig, sourceId, expected) => {
    expect(isChartConfigStale(chartConfig, sourceId)).toBe(expected);
  });
});
