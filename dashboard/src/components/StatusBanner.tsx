import React, { useEffect, useState } from 'react';
import { AlertTriangle, WifiOff, X } from 'lucide-react';

interface StatusBannerProps {
  apiBaseUrl?: string;
}

export const StatusBanner: React.FC<StatusBannerProps> = ({ apiBaseUrl = 'http://localhost:3002' }) => {
  const [message, setMessage] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  // Handle online/offline network events
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      // Refresh the page when connection is restored to reload active view data
      window.location.reload();
    };

    const handleOffline = () => {
      setIsOffline(true);
    };

    // Set initial state
    setIsOffline(!navigator.onLine);

    // Add event listeners
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Cleanup event listeners
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Load server-configured banner message
  useEffect(() => {
    const dismissedSession = sessionStorage.getItem('status-banner-dismissed');
    if (dismissedSession === 'true') {
      setDismissed(true);
      setLoading(false);
      return;
    }

    const loadBanner = async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/config`);
        if (!response.ok) {
          throw new Error('Failed to load status banner');
        }

        const payload = await response.json();
        const bannerMessage = payload?.data?.ui?.bannerMessage || payload?.data?.bannerMessage || null;
        setMessage(typeof bannerMessage === 'string' && bannerMessage.trim() ? bannerMessage : null);
      } catch (error) {
        console.warn('Status banner unavailable', error);
      } finally {
        setLoading(false);
      }
    };

    void loadBanner();
  }, [apiBaseUrl]);

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem('status-banner-dismissed', 'true');
  };

  // Render offline banner if network is disconnected (this takes precedence and cannot be dismissed)
  if (isOffline) {
    return (
      <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-100 shadow-sm animate-pulse">
        <div className="flex items-center gap-2">
          <WifiOff size={18} className="mt-0.5 shrink-0 text-red-400" aria-hidden="true" />
          <p className="text-sm font-medium">Internet connection lost. Retrying...</p>
        </div>
      </div>
    );
  }

  // Render server-configured banner if not loading, not dismissed, and has message
  if (loading || dismissed || !message) {
    return null;
  }

  return (
    <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-100 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-400" aria-hidden="true" />
          <p className="text-sm font-medium">{message}</p>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="rounded p-1 text-amber-200 transition-colors hover:bg-amber-500/20 hover:text-white"
          aria-label="Dismiss notification"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

export default StatusBanner;