/**
 * useAppNav — in-app back / forward navigation + URL-hash persistence
 *
 * Uses window.history.pushState so:
 *  - Browser/in-app back/forward buttons work
 *  - Refreshing the page restores the last view (hash is preserved across reloads)
 *
 * NavState is stored as JSON in the URL hash: #nav=<base64-encoded-json>
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type NavState = {
  listId: string | null;
  taskId: string | null;
  /** One of the overlay keys, or null for the plain board view */
  overlay:
    | null
    | "taskCreationList"
    | "invoiceRegister"
    | "inventoryRegister"
    | "invoicing"
    | "quotations"
    | "customers"
    | "statements"
    | "businessOverview"
    | "salesOverview"
    | "inventoryOverview"
    | "techAssessment"
    | "outstandingRepairs"
    | "inventory"
    | "stockMovements"
    | "banking"
    | "accountsPage"
    | "spaceOverview"
    | "folderOverview"
    | "forms"
    | "businessPlanning"
    | "ecommerceOperations"
    | "expenseSlips"
    | "staffDashboard";
  /** Extra context, e.g. spaceId for spaceOverview, invoiceId for invoicing */
  extra?: string | null;
};

// ── serialise / deserialise ────────────────────────────────────────────────

function encode(state: NavState): string {
  try {
    return btoa(JSON.stringify(state));
  } catch {
    return "";
  }
}

const VALID_OVERLAYS = new Set([
  null, "taskCreationList", "invoiceRegister", "inventoryRegister",
  "invoicing", "quotations", "customers", "statements", "businessOverview",
  "salesOverview", "inventoryOverview", "techAssessment", "outstandingRepairs",
  "inventory", "stockMovements", "banking", "accountsPage", "spaceOverview",
  "folderOverview", "forms", "businessPlanning", "ecommerceOperations",
  "expenseSlips", "staffDashboard",
]);

function decode(hash: string): NavState | null {
  try {
    const m = hash.match(/[#&]?nav=([^&]*)/);
    if (!m) return null;
    const state = JSON.parse(atob(decodeURIComponent(m[1]))) as NavState;
    // Sanitize: if overlay is unknown (e.g. old "banking"), reset it
    if (!VALID_OVERLAYS.has(state.overlay)) {
      state.overlay = null;
    }
    return state;
  } catch {
    return null;
  }
}

function buildHash(state: NavState): string {
  return `nav=${encodeURIComponent(encode(state))}`;
}

// ── hook ──────────────────────────────────────────────────────────────────

export function useAppNav(onRestore: (state: NavState) => void) {
  // Track whether we can go back / forward using the browser's own history length
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);

  // We keep a local shadow stack so we can infer forward availability
  // (window.history.length doesn't tell us where we *are*)
  const shadowStack = useRef<NavState[]>([]);
  const shadowIndex = useRef<number>(-1);
  const isRestoring = useRef(false); // prevent loops when popstate fires

  // ── Update arrow states ──────────────────────────────────────────────
  const syncArrows = useCallback(() => {
    setCanGoBack(shadowIndex.current > 0);
    setCanGoForward(shadowIndex.current < shadowStack.current.length - 1);
  }, []);

  // ── Push a new navigation entry ──────────────────────────────────────
  const push = useCallback(
    (state: NavState) => {
      if (isRestoring.current) return;

      // Trim any forward entries (same as normal browser behaviour)
      shadowStack.current = shadowStack.current.slice(0, shadowIndex.current + 1);
      shadowStack.current.push(state);
      shadowIndex.current = shadowStack.current.length - 1;

      window.history.pushState({ navIdx: shadowIndex.current }, "", "#" + buildHash(state));
      syncArrows();
    },
    [syncArrows]
  );

  // ── Replace current entry (no new history entry) ─────────────────────
  const replace = useCallback(
    (state: NavState) => {
      if (shadowIndex.current >= 0) {
        shadowStack.current[shadowIndex.current] = state;
      } else {
        shadowStack.current = [state];
        shadowIndex.current = 0;
      }
      window.history.replaceState({ navIdx: shadowIndex.current }, "", "#" + buildHash(state));
      syncArrows();
    },
    [syncArrows]
  );

  // ── Back ─────────────────────────────────────────────────────────────
  const back = useCallback(() => {
    if (shadowIndex.current <= 0) return;
    shadowIndex.current -= 1;
    syncArrows();
    window.history.back();
  }, [syncArrows]);

  // ── Forward ──────────────────────────────────────────────────────────
  const forward = useCallback(() => {
    if (shadowIndex.current >= shadowStack.current.length - 1) return;
    shadowIndex.current += 1;
    syncArrows();
    window.history.forward();
  }, [syncArrows]);

  // ── Handle browser popstate (back/forward) ───────────────────────────
  useEffect(() => {
    const handler = (e: PopStateEvent) => {
      const state = decode(window.location.hash);
      if (!state) return;

      // Sync our shadow index from the browser's stored navIdx if available
      if (e.state && typeof e.state.navIdx === "number") {
        shadowIndex.current = e.state.navIdx;
      }
      syncArrows();

      isRestoring.current = true;
      onRestore(state);
      // Small delay to ensure state setters have settled before allowing new pushes
      setTimeout(() => { isRestoring.current = false; }, 50);
    };

    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [onRestore, syncArrows]);

  // ── Restore from hash on initial mount (handles page refresh) ────────
  const initialRestoreDone = useRef(false);
  const restoreOnMount = useCallback(() => {
    if (initialRestoreDone.current) return null;
    initialRestoreDone.current = true;
    const state = decode(window.location.hash);
    if (!state) return null;
    // Seed shadow stack with the restored entry
    shadowStack.current = [state];
    shadowIndex.current = 0;
    syncArrows();
    return state;
  }, [syncArrows]);

  return { push, replace, back, forward, canGoBack, canGoForward, restoreOnMount };
}
