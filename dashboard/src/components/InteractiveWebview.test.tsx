import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { InteractiveWebview } from './InteractiveWebview';

// Mock framer-motion to simplify testing
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div className={className} {...props}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('InteractiveWebview', () => {
  const defaultProps = {
    anchorName: 'Test Anchor',
    onComplete: vi.fn(),
  };

  it('renders idle state initially', () => {
    render(<InteractiveWebview {...defaultProps} />);
    expect(screen.getByText('Test Anchor Secure Portal')).toBeInTheDocument();
    expect(screen.getByText('Launch KYC Portal')).toBeInTheDocument();
  });

  it('can launch the webview and show active state', async () => {
    render(<InteractiveWebview {...defaultProps} />);
    
    fireEvent.click(screen.getByText('Launch KYC Portal'));
    
    // Should show loading steps first
    await waitFor(() => {
      expect(screen.getByText('Establishing secure channel…')).toBeInTheDocument();
    }, { timeout: 3000 });
    
    // Then should transition to active state
    await waitFor(() => {
      expect(screen.getByText('Identity Verification')).toBeInTheDocument();
      expect(screen.getByLabelText('Enter fullscreen')).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('toggles fullscreen mode correctly', async () => {
    render(<InteractiveWebview {...defaultProps} />);
    
    // Launch the webview first
    fireEvent.click(screen.getByText('Launch KYC Portal'));
    
    // Wait for active state with fullscreen button
    await waitFor(() => {
      expect(screen.getByLabelText('Enter fullscreen')).toBeInTheDocument();
    }, { timeout: 5000 });
    
    // Click fullscreen button
    const fullscreenButton = screen.getByLabelText('Enter fullscreen');
    fireEvent.click(fullscreenButton);
    
    // Should now show exit fullscreen button
    await waitFor(() => {
      expect(screen.getByLabelText('Exit fullscreen')).toBeInTheDocument();
    });
    
    // Webview container should have fullscreen classes
    const webviewContainer = screen.getByRole('region', { name: /Anchor Interactive Flow interactive panel/ });
    expect(webviewContainer.className).toContain('fixed inset-4 z-50');
    
    // Click exit fullscreen
    fireEvent.click(screen.getByLabelText('Exit fullscreen'));
    
    // Should go back to normal mode
    await waitFor(() => {
      expect(screen.getByLabelText('Enter fullscreen')).toBeInTheDocument();
    });
    expect(webviewContainer.className).toContain('aspect-video');
  });

  it('handles close button correctly', async () => {
    const onDismiss = vi.fn();
    render(<InteractiveWebview {...defaultProps} onDismiss={onDismiss} />);
    
    fireEvent.click(screen.getByText('Launch KYC Portal'));
    
    await waitFor(() => {
      expect(screen.getByLabelText('Close webview')).toBeInTheDocument();
    }, { timeout: 5000 });
    
    fireEvent.click(screen.getByLabelText('Close webview'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('maintains iframe state when resizing (no re-render issues)', async () => {
    const { container } = render(<InteractiveWebview {...defaultProps} />);
    
    fireEvent.click(screen.getByText('Launch KYC Portal'));
    
    await waitFor(() => {
      expect(screen.getByLabelText('Enter fullscreen')).toBeInTheDocument();
    }, { timeout: 5000 });
    
    // Simulate window resize
    window.dispatchEvent(new Event('resize'));
    
    // Toggle fullscreen multiple times
    const fullscreenButton = screen.getByLabelText('Enter fullscreen');
    for (let i = 0; i < 3; i++) {
      fireEvent.click(fullscreenButton);
      // Input field should still exist (no unmounting)
      const fullnameInput = screen.queryByLabelText('Full Name');
      expect(fullnameInput).toBeInTheDocument();
    }
  });
});