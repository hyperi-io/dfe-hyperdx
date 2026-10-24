import {
  DFE_DEFAULT_DASHBOARD_NAMES,
  pickDefaultDashboard,
} from '@/dfe/DefaultDashboardRedirect';

const shipped = (id: string, name: string) => ({ id, name, provisioned: true });

describe('pickDefaultDashboard', () => {
  it('prefers Overview, which only the platform team is seeded with', () => {
    expect(DFE_DEFAULT_DASHBOARD_NAMES[0]).toBe('Overview');
    expect(
      pickDefaultDashboard([
        shipped('t', 'DFE Throughput'),
        shipped('o', 'Overview'),
      ])?.id,
    ).toBe('o');
  });

  it('lands a team without Overview on DFE Throughput', () => {
    expect(
      pickDefaultDashboard([
        shipped('k', 'DFE Kafka'),
        shipped('t', 'DFE Throughput'),
      ])?.id,
    ).toBe('t');
  });

  it('skips a team-owned dashboard that shares a shipped name', () => {
    expect(
      pickDefaultDashboard([
        { id: 'mine', name: 'Overview', provisioned: false },
        { id: 'copy', name: 'Overview' },
        shipped('t', 'DFE Throughput'),
      ])?.id,
    ).toBe('t');
  });

  it('returns nothing before seeding, so the page falls back to the list', () => {
    expect(pickDefaultDashboard([])).toBeUndefined();
    expect(
      pickDefaultDashboard([{ id: 'mine', name: 'DFE Throughput' }]),
    ).toBeUndefined();
  });
});
