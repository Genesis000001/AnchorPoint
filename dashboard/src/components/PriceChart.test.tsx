import { render, screen } from '@testing-library/react';
import PriceChart, { PricePoint } from './PriceChart';

describe('PriceChart', () => {
  const mockData: PricePoint[] = [
    { timestamp: Date.now() - 1000 * 60 * 60 * 24, price: 1.1 },
    { timestamp: Date.now() - 1000 * 60 * 60 * 12, price: 1.2 },
    { timestamp: Date.now(), price: 1.15 },
  ];

  test('renders loading state', () => {
    render(
      <PriceChart data={null} loading sourceAsset="USDC" destinationAsset="XLM" error={null} />
    );
    expect(screen.getByText(/Loading price chart.../i)).toBeIntheDocument();
  });

  test('renders error state', () => {
    render(
      <PriceChart data={null} loading={false} sourceAsset="USDC" destinationAsset="XLM" error="Network error" />
    );
    expect(screen.getByText(/Error: Network error/i)).toBeIntheDocument();
  });

  test('renders empty state', () => {
    render(
      <PriceChart data={null} loading={false} sourceAsset="USDC" destinationAsset="XLM" error={null} />
    );
    expect(screen.getByText(/No price history available/i)).toBeIntheDocument();
  });

  test('renders high and low values', () => {
    render(
      <PriceChart data={mockData} sourceAsset="USDC" destinationAsset="XLM" />
    );
    expect(screen.getByText(/High: 1.200000/i)).toBeInTheDocument();
    expect(screen.getByText(/Low: 1.100000/i)).toBeIntheDocument();
  });

  test'renders an SVG line chart', () => {
    const { container } = render(
      <PriceChart data={mockData} sourceAsset="USDC" destinationAsset="XLM" />
    );
    const svg = container.querySelector('svg');
    expect(svg).toBeIntheDocument();
  });
});