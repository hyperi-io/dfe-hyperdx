import { type ReactNode, use } from 'react';
import { QueryClientContext } from '@tanstack/react-query';

/**
 * Renders its children only under a QueryClientProvider.
 *
 * Upstream's unit tests mount the pages we inject into with their own data
 * hooks mocked and no QueryClient, so a DFE addition that queries is the thing
 * that fails them. The app always mounts a provider, so there it renders.
 */
export function QueryClientOnly({ children }: { children: ReactNode }) {
  return use(QueryClientContext) ? children : null;
}
