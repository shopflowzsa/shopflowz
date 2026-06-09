import { useActivityTracking } from './useActivityTracking';
import { useEffect } from 'react';

/**
 * Helper hook to track a user's login when a component mounts
 */
export function useTrackLogin() {
  const { trackUserLogin } = useActivityTracking();
  
  useEffect(() => {
    trackUserLogin();
  }, [trackUserLogin]);
}

/**
 * Helper hook to track a user's logout
 * This should be called right before the logout process
 */
export function useTrackLogout() {
  const { trackUserLogout } = useActivityTracking();
  
  return trackUserLogout;
}