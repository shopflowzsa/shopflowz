import { useEffect } from "react";
import { App as CapApp } from "@capacitor/app";

/**
 * Android system back-button handler for the Capacitor APK.
 *
 * Order of operations:
 *   1. Close the topmost open modal/dialog (anything Radix renders with
 *      [data-state="open"] inside [role="dialog"]) by sending an Escape key.
 *   2. Otherwise, if there's app history, navigate back with window.history.back().
 *   3. Otherwise, ask Android to exit the app (default Android home-screen behaviour).
 *
 * No-ops on web — only fires inside the native shell.
 */
export function useAndroidBackButton() {
  useEffect(() => {
    let unsub: (() => void) | null = null;
    let mounted = true;

    (async () => {
      try {
        const handle = await CapApp.addListener("backButton", () => {
          // 1. Dismiss the top-most Radix dialog if one is open.
          const openDialog = document.querySelector<HTMLElement>('[role="dialog"][data-state="open"]');
          if (openDialog) {
            const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
            openDialog.dispatchEvent(escape);
            return;
          }
          // 2. Pop one nav-history entry if we have one.
          if (window.history.length > 1) {
            window.history.back();
            return;
          }
          // 3. Nothing to back out of — exit the app.
          void CapApp.exitApp();
        });

        if (!mounted) {
          handle.remove();
          return;
        }
        unsub = () => handle.remove();
      } catch {
        // Not running in a Capacitor native shell — quietly no-op.
      }
    })();

    return () => {
      mounted = false;
      unsub?.();
    };
  }, []);
}
