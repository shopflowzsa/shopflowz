import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const checkMobile = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      // More comprehensive mobile detection
      const isMobileWidth = width < MOBILE_BREAKPOINT;
      const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      
      // Conservative approach: prioritize screen size over touch for desktop
      // Consider as mobile if:
      // 1. Width is less than 768px (standard mobile breakpoint)
      // 2. It's a small touch device (width < 600px with touch)
      const shouldBeMobile = isMobileWidth || (isTouchDevice && width < 600);
      
      setIsMobile(shouldBeMobile);
    };
    
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    mql.addEventListener("change", checkMobile);
    checkMobile();
    
    // Also listen to resize events for more accurate detection
    window.addEventListener('resize', checkMobile);
    
    return () => {
      mql.removeEventListener("change", checkMobile);
      window.removeEventListener('resize', checkMobile);
    };
  }, []);

  return !!isMobile;
}
