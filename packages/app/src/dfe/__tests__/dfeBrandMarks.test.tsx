/**
 * The DFE marks render in the nav on every page, so an attribute React does not
 * know logs a console error on every page load.
 */
import { render } from '@testing-library/react';

import Logomark from '@/theme/themes/dfe/Logomark';
import Wordmark from '@/theme/themes/dfe/Wordmark';

describe('DFE brand marks', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it.each([
    ['Wordmark', Wordmark],
    ['Logomark', Logomark],
  ])('%s renders with no React console error', (_name, Mark) => {
    const { container } = render(<Mark />);

    expect(container.querySelector('svg')).not.toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
