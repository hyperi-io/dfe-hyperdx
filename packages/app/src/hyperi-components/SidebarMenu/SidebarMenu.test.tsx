import { ThemeProvider } from '@/core/contexts/ThemeContext';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SidebarMenu } from './index';

const wrapper = ({ children }: { children: React.ReactNode }) => {
  return (
    <BrowserRouter>
      <ThemeProvider>{children}</ThemeProvider>
    </BrowserRouter>
  );
};

describe('SidebarMenu', () => {
  describe('collapsed is false', () => {
    it('should render menu list', () => {
      render(<SidebarMenu collapsed={false} />, { wrapper });
      const menuItemList = screen
        .getAllByRole('link')
        .map((item) => item.textContent)
        .filter((item) => !!item);

      expect(menuItemList).toEqual([
        'Discovery',
        'Schemas',
        'Rules',
        'Hunts',
        'Ingest',
        'Settings',
      ]);
    });

    it('should navigate to the correct page when a menu item is clicked', async () => {
      const user = userEvent.setup();
      render(<SidebarMenu collapsed={false} />, { wrapper });
      const menuItemList = screen.getAllByRole('link');
      await user.click(menuItemList[0]);
      expect(window.location.pathname).toBe('/discovery');
    });

    it('should not show tooltip on hover', async () => {
      const user = userEvent.setup();
      render(<SidebarMenu collapsed={false} />, { wrapper });
      const menuItemList = screen.getAllByRole('link');
      await user.hover(menuItemList[0]);
      await waitFor(() => {
        expect(screen.getAllByText('Discovery')).toHaveLength(1);
      });
    });
  });

  describe('collapsed is true', () => {
    it('should show tooltip on hover', async () => {
      const user = userEvent.setup();
      render(<SidebarMenu collapsed={true} />, { wrapper });
      const menuItemList = screen.getAllByRole('link');
      await user.hover(menuItemList[0]);

      await waitFor(() => {
        expect(screen.getByText('Discovery')).toBeDefined();
      });
    });

    it('should render icon list', () => {
      render(<SidebarMenu collapsed={true} />, { wrapper });
      const collapsedMenuItemList = screen
        .getAllByRole('link')
        .map((item) => item.textContent)
        .filter((item) => !!item);

      expect(collapsedMenuItemList).toEqual([]);
    });

    it('should navigate to the correct page when a menu item is clicked', async () => {
      const user = userEvent.setup();
      render(<SidebarMenu collapsed={true} />, { wrapper });
      const menuItemList = screen.getAllByRole('link');
      await user.click(menuItemList[0]);
      expect(window.location.pathname).toBe('/discovery');
    });
  });
});
