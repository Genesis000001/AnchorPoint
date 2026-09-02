import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChartSkeleton } from './Skeletons';
import { MetricsChart } from './MetricsChart';
import { VolumeChart } from './VolumeChart';

/**
 * jsdom has no layout engine, so these assert the structural contract that keeps
 * the swap CLS-free — the skeleton occupies the same flex box the plot does, and
 * exactly one of the two is mounted at a time.
 */
describe('ChartSkeleton', () => {
  it('exposes a single polite loading region rather than announcing every bar', () => {
    render(<ChartSkeleton label="Loading daily volume chart" />);

    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-busy')).toBe('true');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByText('Loading daily volume chart')).toBeTruthy();
  });

  it('renders one pulsing bar per supplied height, hidden from assistive tech', () => {
    const { container } = render(<ChartSkeleton bars={[10, 20, 30]} />);

    const bars = container.querySelectorAll('.animate-pulse[style*="height"]');
    expect(bars.length).toBe(3);
    expect(Array.from(bars).every((bar) => bar.getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  it('matches its rendered shape', () => {
    const { container } = render(<ChartSkeleton bars={[40, 60]} legend />);

    expect(container.firstChild).toMatchSnapshot();
  });

  it('collapses the header row when the host chart draws no chrome', () => {
    const { container } = render(
      <ChartSkeleton title={false} subtitle={false} controls={false} bars={[50]} />,
    );

    expect(container.querySelector('.h-8.w-32')).toBeNull();
    expect(container.querySelectorAll('.animate-pulse').length).toBe(1);
  });
});

describe('MetricsChart loading state', () => {
  it('shows the skeleton and no plot while loading', () => {
    render(<MetricsChart isLoading />);

    expect(screen.getByTestId('chart-skeleton')).toBeTruthy();
    expect(screen.queryByTestId('metrics-chart-plot')).toBeNull();
    expect(screen.getByText('Loading daily volume chart')).toBeTruthy();
  });

  it('swaps to the plot with a fade once loading resolves', () => {
    const { rerender } = render(<MetricsChart isLoading />);
    rerender(<MetricsChart isLoading={false} />);

    const plot = screen.getByTestId('metrics-chart-plot');
    expect(plot.className).toContain('animate-fade-in');
    // Same flex sizing as the skeleton, so the swap shifts nothing.
    expect(plot.className).toContain('min-h-64');
    expect(screen.queryByTestId('chart-skeleton')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('VolumeChart loading state', () => {
  it('shows a legend-aware skeleton and no svg while loading', () => {
    render(<VolumeChart isLoading />);

    expect(screen.getByTestId('chart-skeleton')).toBeTruthy();
    expect(screen.queryByTestId('volume-chart-plot')).toBeNull();
    expect(screen.getByText('Loading transaction volume chart')).toBeTruthy();
  });

  it('swaps to the svg with a fade once loading resolves', () => {
    const { rerender } = render(<VolumeChart isLoading />);
    rerender(<VolumeChart isLoading={false} />);

    const plot = screen.getByTestId('volume-chart-plot');
    expect(plot.getAttribute('class')).toContain('animate-fade-in');
    expect(screen.queryByTestId('chart-skeleton')).toBeNull();
  });

  it('defaults to the rendered chart when no loading flag is passed', () => {
    render(<VolumeChart />);

    expect(screen.getByTestId('volume-chart-plot')).toBeTruthy();
    expect(screen.queryByTestId('chart-skeleton')).toBeNull();
  });
});
