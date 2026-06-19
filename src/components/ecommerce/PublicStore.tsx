/**
 * Public Store — Customer-facing ecommerce interface
 * Design inspired by microrobotics.co.za
 */

import { useState, useEffect, useRef, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import {
  ShoppingCart,
  Plus,
  Minus,
  ShoppingBag,
  CreditCard,
  Phone,
  MessageCircle,
  LogIn,
  LogOut,
  Search,
  ChevronLeft,
  ChevronRight,
  X,
  Package,
  Wrench,
  Info,
  LayoutDashboard,
  User,
  Home,
  ClipboardList,
  MapPin,
  Save,
  Copy,
  DollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { loadEcommerceSettings, calculateDeliveryFee } from "@/lib/ecommerceSettingsService";
import { EcommerceSettings, DEFAULT_ECOMMERCE_SETTINGS } from "@/types/ecommerce";
import { getStoreTemplate } from "@/lib/storeTemplates";
import { PublicProduct, PublicCategory } from "@/types/ecommerce";
import { getPublicProducts, getPublicCategories } from "@/lib/productService";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY, supabaseServiceRole } from "@/lib/supabase";
import { addEcommerceNotification } from "@/lib/notificationService";
import { EcommerceChatBubble } from "@/components/ecommerce/EcommerceChatBubble";
import { trackStoreEvent, getOrCreateSessionId } from "@/lib/ecommerceAnalyticsService";

// ─── Page-turn keyframes injected once ───────────────────────────────────────
const FLIP_STYLES = `
  .flip-card { perspective: 1000px; }
  .flip-card-inner {
    position: relative;
    width: 100%;
    height: 100%;
    transition: transform 0.55s cubic-bezier(.4,0,.2,1);
    transform-style: preserve-3d;
  }
  .flip-card:hover .flip-card-inner { transform: rotateY(180deg); }
  .flip-card-front, .flip-card-back {
    position: absolute; inset: 0;
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
    border-radius: 0.5rem;
    overflow: hidden;
  }
  .flip-card-back { transform: rotateY(180deg); }

  @keyframes cardEntrance {
    from { opacity: 0; transform: rotateY(-30deg) translateY(20px); }
    to   { opacity: 1; transform: rotateY(0)   translateY(0); }
  }
  .card-enter {
    animation: cardEntrance 0.45s cubic-bezier(.4,0,.2,1) both;
  }
`;

if (typeof document !== 'undefined' && !document.getElementById('flip-card-styles')) {
  const s = document.createElement('style');
  s.id = 'flip-card-styles';
  s.textContent = FLIP_STYLES;
  document.head.appendChild(s);
}

// ─── Local cart type ──────────────────────────────────────────────────────────
interface StoreCartItem {
  productId: string;
  variantId: string;
  productName: string;
  variantName: string;
  sku: string;
  quantity: number;
  price: number;
  productImage?: string;
}

const getTaxRate = (settings?: EcommerceSettings) => Math.max(0, Number(settings?.taxRate || 0)) / 100;
const getTaxLabel = (settings?: EcommerceSettings) => Number(settings?.taxRate || 0) > 0 ? `Tax (${Number(settings?.taxRate || 0)}%)` : "Tax";
const calculateTax = (subtotal: number, settings?: EcommerceSettings) => {
  const taxRate = getTaxRate(settings);
  if (taxRate <= 0) return 0;
  if (settings?.taxIncluded) return subtotal - (subtotal / (1 + taxRate));
  return subtotal * taxRate;
};
const calculateTotal = (subtotal: number, deliveryFee: number, settings?: EcommerceSettings) => {
  if (settings?.taxIncluded) return subtotal + deliveryFee;
  return subtotal + calculateTax(subtotal, settings) + deliveryFee;
};

// ─── Stock pill ───────────────────────────────────────────────────────────────
function StockPill({ inStock, qty }: { inStock: boolean; qty?: number }) {
  if (!inStock)
    return (
      <span className="flex items-center gap-1 text-xs text-red-600 font-medium">
        <span className="inline-block w-2 h-2 rounded-full bg-red-500" />
        No Stock
      </span>
    );
  if (qty !== undefined && qty <= 5)
    return (
      <span className="flex items-center gap-1 text-xs text-orange-600 font-medium">
        <span className="inline-block w-2 h-2 rounded-full bg-orange-400" />
        Limited Stock
      </span>
    );
  return (
    <span className="flex items-center gap-1 text-xs text-green-700 font-medium">
      <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
      In Stock
    </span>
  );
}

// ─── Store Login Modal ────────────────────────────────────────────────────────
// Keeps store customers on the store — never redirects to the CRM /login page.
function StoreLoginModal({ storeName, workspaceId, onClose, onSuccess, onRegistered }: { storeName: string; workspaceId: string; onClose: () => void; onSuccess: () => void; onRegistered?: () => void }) {
  const [tab, setTab] = useState<"signin" | "register">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [registered, setRegistered] = useState(false);

  async function saveCustomerRecord(uid: string, customerName: string, customerEmail: string, isNew = false) {
    try {
      const now = new Date().toISOString();
      await supabaseServiceRole.from('customers').upsert({
        id: uid,
        workspace_id: workspaceId,
        data: { id: uid, contactPerson: customerName, email: customerEmail, phone: '', status: 'active', source: 'store_registration', createdAt: now, updatedAt: now },
      }, { onConflict: 'id' });
      if (isNew) {
        await addEcommerceNotification(workspaceId, {
          type: 'client',
          title: 'New store client registered',
          body: `${customerName || customerEmail} joined the store`,
          link: 'ecommerce',
        });
      }
    } catch { /* non-critical */ }
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (err) { setError(err.message); return; }
    if (data.user) {
      const displayName = data.user.user_metadata?.display_name || data.user.email?.split('@')[0] || '';
      await saveCustomerRecord(data.user.id, displayName, data.user.email || email, false);
    }
    onSuccess();
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { data, error: err } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: name, user_type: 'store_customer' } },
    });
    setLoading(false);
    if (err) { setError(err.message); return; }
    if (data.user) {
      await saveCustomerRecord(data.user.id, name, email, true);
      onRegistered?.();
    }
    setRegistered(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 relative" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-3 right-3 text-gray-400 hover:text-gray-600">
          <X className="h-5 w-5" />
        </button>
        <h2 className="text-lg font-bold text-gray-900 mb-1">{storeName}</h2>
        <p className="text-sm text-gray-500 mb-4">Sign in to track your orders</p>

        {registered ? (
          <div className="text-center py-4">
            <p className="text-green-700 font-medium">Account created!</p>
            <p className="text-sm text-gray-500 mt-1">Check your email to confirm, then sign in.</p>
            <button onClick={() => setRegistered(false)} className="mt-3 text-sm text-blue-600 hover:underline">Back to sign in</button>
          </div>
        ) : (
          <>
            <div className="flex rounded-lg border border-gray-200 mb-4 overflow-hidden">
              <button onClick={() => setTab("signin")} className={`flex-1 py-2 text-sm font-medium transition-colors ${tab === "signin" ? "bg-orange-500 text-white" : "text-gray-600 hover:bg-gray-50"}`}>Sign In</button>
              <button onClick={() => setTab("register")} className={`flex-1 py-2 text-sm font-medium transition-colors ${tab === "register" ? "bg-orange-500 text-white" : "text-gray-600 hover:bg-gray-50"}`}>Register</button>
            </div>

            {error && <p className="text-sm text-red-600 mb-3 bg-red-50 rounded p-2">{error}</p>}

            {tab === "signin" ? (
              <form onSubmit={handleSignIn} className="space-y-3">
                <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                <button type="submit" disabled={loading} className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-semibold py-2 rounded-lg text-sm transition-colors">
                  {loading ? "Signing in…" : "Sign In"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleRegister} className="space-y-3">
                <input type="text" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} required className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                <input type="password" placeholder="Password (min 6 chars)" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
                <button type="submit" disabled={loading} className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-semibold py-2 rounded-lg text-sm transition-colors">
                  {loading ? "Creating account…" : "Create Account"}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Public Store ─────────────────────────────────────────────────────────────
export function PublicStore({ workspaceId, previewSettings }: { workspaceId: string; previewSettings?: EcommerceSettings }) {
  const navigate = useNavigate();
  const { productId: routeProductId } = useParams();
  const { user, workspace, logout, isSystemAdmin } = useAuth();

  // Walk-in mode: staff opens the store from admin via /store?walkin=1.
  // This stays true until the tab closes so navigating to product pages
  // doesn't drop the flag.
  const [searchParams] = useSearchParams();
  const isAdminPreview = useMemo(() => {
    if (searchParams.get('admin') === '1') {
      try { sessionStorage.setItem('admin_preview', '1'); } catch {}
      return true;
    }
    try { return sessionStorage.getItem('admin_preview') === '1'; } catch { return false; }
  }, [searchParams]);
  const isWalkIn = useMemo(() => {
    if (searchParams.get('walkin') === '1') {
      try { sessionStorage.setItem('walkin_mode', '1'); } catch {}
      return true;
    }
    try { return sessionStorage.getItem('walkin_mode') === '1'; } catch { return false; }
  }, [searchParams]);

  // Exclude staff from analytics (admin preview, walk-in mode, or logged-in CRM user)
  const isStaffViewer = isAdminPreview || isWalkIn || !!workspace;

  // Google Customer Reviews badge - mount once on the storefront
  useEffect(() => {
    if (document.getElementById("merchantWidgetScript")) return;
    const s = document.createElement("script");
    s.id = "merchantWidgetScript";
    s.src = "https://www.gstatic.com/shopping/merchant/merchantwidget.js";
    s.defer = true;
    s.addEventListener("load", () => {
      const w = window as any;
      if (w.merchantwidget?.start) {
        w.merchantwidget.start({
          merchant_id: 5589844619,
          position: "BOTTOM_RIGHT",
          region: "ZA",
        });
      }
    });
    document.head.appendChild(s);
  }, []);

  // DEBUG: Log localStorage on mount
  useEffect(() => {
    console.log('===== DEBUG: CART STORAGE =====');
    
    // Log all localStorage items that start with 'cart_'
    const cartItems = Object.keys(localStorage)
      .filter(key => key.startsWith('cart_'))
      .reduce((obj, key) => {
        obj[key] = JSON.parse(localStorage.getItem(key) || '[]');
        return obj;
      }, {} as Record<string, any>);
    
    console.log('All Cart Items in localStorage:', cartItems);
    
    // Log browser ID
    console.log('Browser ID:', localStorage.getItem('browser_id'));
    
    console.log('================================');
  }, []);

  // Simple function to get or create browser ID
  // We're keeping this as simple as possible to avoid any potential issues
  const getBrowserId = () => {
    // Try to get existing browser ID
    let browserId = localStorage.getItem('browser_id');
    
    // If no ID exists, create one and save it
    if (!browserId) {
      browserId = `browser_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
      localStorage.setItem('browser_id', browserId);
      console.log('Created new browser ID:', browserId);
    }
    
    return browserId;
  };

  const getBrowserCartKey = () => `cart_${workspaceId}_${getBrowserId()}`;
  const getUserCartKey = (uid = user?.uid) => uid ? `cart_${workspaceId}_${uid}` : null;
  const getCartKey = () => getUserCartKey() || getBrowserCartKey();

  const readCartKey = (key: string): StoreCartItem[] => {
    try {
      const data = window.localStorage.getItem(key);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('Error reading cart key:', key, error);
      return [];
    }
  };

  const mergeCartItems = (...cartLists: StoreCartItem[][]): StoreCartItem[] => {
    const merged: StoreCartItem[] = [];

    for (const list of cartLists) {
      for (const item of list) {
        const existingIndex = merged.findIndex(
          existing => existing.productId === item.productId && existing.variantId === item.variantId
        );

        if (existingIndex >= 0) {
          merged[existingIndex] = {
            ...merged[existingIndex],
            ...item,
            quantity: Math.max(merged[existingIndex].quantity, item.quantity),
          };
        } else {
          merged.push(item);
        }
      }
    }

    return merged;
  };
  
  // Direct functions for cart storage
  const saveCart = (items: StoreCartItem[]) => {
    try {
      const keys = [getBrowserCartKey(), getUserCartKey()].filter(Boolean) as string[];
      for (const key of keys) {
        console.log(`Saving ${items.length} cart items with key: ${key}`);
        window.localStorage.setItem(key, JSON.stringify(items));
      }
    } catch (error) {
      console.error('Error saving cart:', error);
    }
  };
  
  const loadCart = (): StoreCartItem[] => {
    try {
      const browserCart = readCartKey(getBrowserCartKey());
      const userKey = getUserCartKey();
      const userCart = userKey ? readCartKey(userKey) : [];
      const merged = mergeCartItems(browserCart, userCart);
      console.log(`Loaded merged cart: ${merged.length} items`);
      return merged;
    } catch (error) {
      console.error('Error loading cart:', error);
    }
    return [];
  };

  // Force light mode — the public store is always customer-facing
  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    root.classList.remove("dark");
    return () => { if (wasDark) root.classList.add("dark"); };
  }, []);

  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [allProducts, setAllProducts] = useState<PublicProduct[]>([]); // full unfiltered list
  const [categories, setCategories] = useState<PublicCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [searchInput, setSearchInput] = useState<string>("");
  const [inStockOnly, setInStockOnly] = useState<boolean>(false);
  const [selectedProduct, setSelectedProduct] = useState<PublicProduct | null>(null);
  const [showCart, setShowCart] = useState<boolean>(false);
  const [showCheckout, setShowCheckout] = useState<boolean>(false);
  const [showAccount, setShowAccount] = useState<boolean>(false);
  const [showStoreLogin, setShowStoreLogin] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [ecomSettings, setEcomSettings] = useState<EcommerceSettings>(previewSettings ?? DEFAULT_ECOMMERCE_SETTINGS);

  // Live preview: when the design studio passes draft settings, mirror them so the
  // store re-renders instantly as the client edits (real products still load below).
  useEffect(() => {
    if (previewSettings) setEcomSettings(previewSettings);
  }, [previewSettings]);
  
  const carouselRef = useRef<HTMLDivElement>(null);
  const productParam = routeProductId || new URLSearchParams(window.location.search).get("product");
  
  // Initialize cart state - this will be loaded from localStorage on first render
  const [cart, setCart] = useState<StoreCartItem[]>(() => {
    // Try to load cart from localStorage during the initial state calculation
    // This happens synchronously during component initialization
    try {
      // We can't use our regular functions here because they depend on hooks
      // that aren't set up yet, so we have to duplicate some logic
      
      let browserId = localStorage.getItem('browser_id');
      if (!browserId) {
        browserId = `browser_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
        localStorage.setItem('browser_id', browserId);
      }

      const browserKey = `cart_${workspaceId}_${browserId}`;
      const merged = readCartKey(browserKey);

      if (merged.length > 0) {
        console.log('INITIAL LOAD: Restored merged cart:', merged.length);
        return merged;
      }
    } catch (error) {
      console.error('Error during initial cart load:', error);
    }
    
    // Default to empty cart if nothing found
    return [];
  });
  
  // Load cart after component mounts to ensure we have the correct cart key
  useEffect(() => {
    console.log('Loading cart after mount...');
    
    // Load cart with proper key (now that we have user object)
    const loadedCart = loadCart();
    
    // Only update if we found items
    if (loadedCart.length > 0) {
      console.log(`Setting cart state with ${loadedCart.length} items`);
      setCart(loadedCart);
    } else {
      console.log('No items in stored cart');
    }
  }, [workspaceId, user?.uid]);
  
  // Save cart whenever it changes
  useEffect(() => {
    // Don't try to save an empty cart on the first render
    if (cart.length === 0 && document.readyState !== 'complete') {
      return;
    }
    
    // Save to localStorage
    saveCart(cart);
  }, [cart]);

  // Handle user changes (login/logout) with simplified logic
  const previousUserRef = useRef(user?.uid);
  
  useEffect(() => {
    // Skip if the user hasn't actually changed
    if (previousUserRef.current === user?.uid) return;
    
    console.log('User changed:', previousUserRef.current, '->', user?.uid);
    const prevUserId = previousUserRef.current;
    const currentUserId = user?.uid;
    
    // Update the reference for next time
    previousUserRef.current = user?.uid;
    
    // User logged in (was guest, now has a user ID)
    if (!prevUserId && currentUserId) {
      console.log('User logged in, merging guest cart with user cart');
      const mergedCart = mergeCartItems(cart, readCartKey(getBrowserCartKey()), readCartKey(`cart_${workspaceId}_${currentUserId}`));
      setCart(mergedCart);
      localStorage.setItem(getBrowserCartKey(), JSON.stringify(mergedCart));
      localStorage.setItem(`cart_${workspaceId}_${currentUserId}`, JSON.stringify(mergedCart));
    }
    // User logged out (had a user ID, now doesn't)
    else if (prevUserId && !currentUserId) {
      console.log('User logged out, keeping visible cart as browser cart');
      const mergedCart = mergeCartItems(cart, readCartKey(`cart_${workspaceId}_${prevUserId}`), readCartKey(getBrowserCartKey()));
      setCart(mergedCart);
      localStorage.setItem(getBrowserCartKey(), JSON.stringify(mergedCart));
    }
    // User switched to a different account
    else if (prevUserId && currentUserId && prevUserId !== currentUserId) {
      console.log('User switched accounts, merging visible cart with new account cart');
      const mergedCart = mergeCartItems(cart, readCartKey(getBrowserCartKey()), readCartKey(`cart_${workspaceId}_${currentUserId}`));
      setCart(mergedCart);
      localStorage.setItem(getBrowserCartKey(), JSON.stringify(mergedCart));
      localStorage.setItem(`cart_${workspaceId}_${currentUserId}`, JSON.stringify(mergedCart));
    }
  }, [user, workspaceId]);
  
  // Clear the cart completely
  const clearCart = () => {
    // Clear cart state
    setCart([]);
    
    // Remove from localStorage
    try {
      Object.keys(localStorage)
        .filter(key => key.startsWith(`cart_${workspaceId}_`))
        .forEach(key => localStorage.removeItem(key));
      console.log('Cleared all cart keys for workspace:', workspaceId);
    } catch (error) {
      console.error('Error clearing cart:', error);
    }
  };

  // Load ALL products once on mount — category/search filtering is done in
  // memory to avoid a Supabase round-trip (and egress cost) on every filter change.
  useEffect(() => {
    loadStoreData();
  }, [workspaceId]);

  useEffect(() => {
    const legacyProductId = new URLSearchParams(window.location.search).get("product");
    if (!routeProductId && legacyProductId) {
      navigate(`/store/product/${encodeURIComponent(legacyProductId)}`, { replace: true });
    }
  }, [navigate, routeProductId]);

  useEffect(() => {
    if (!productParam) {
      if (selectedProduct) setSelectedProduct(null);
      return;
    }

    const productFromUrl = products.find((product) => product.id === productParam);
    if (productFromUrl && selectedProduct?.id !== productFromUrl.id) {
      setSelectedProduct(productFromUrl);
    }
  }, [productParam, products, selectedProduct?.id]);

  const loadStoreData = async () => {
    // Load ALL products + settings once. Category/search filtering happens in
    // memory via applyFilters() — no extra Supabase queries per filter change.
    const timeout = setTimeout(() => setLoading(false), 10000);
    try {
      setLoading(true);
      const [productsData, categoriesData, settingsData] = await Promise.all([
        getPublicProducts(workspaceId, {}),
        getPublicCategories(workspaceId),
        loadEcommerceSettings(workspaceId),
      ]);
      setAllProducts(productsData.products);
      setCategories(categoriesData);
      if (!previewSettings) setEcomSettings(settingsData);
    } catch (err) {
      console.error("Error loading store data:", err);
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  };

  // Filter in memory whenever category or search changes — zero Supabase egress
  useEffect(() => {
    let filtered = allProducts;
    if (selectedCategory !== "all") {
      filtered = filtered.filter(p => p.category === selectedCategory);
    }
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      filtered = filtered.filter(p =>
        p.name?.toLowerCase().includes(s) ||
        p.description?.toLowerCase().includes(s) ||
        p.variants?.some(v => v.sku?.toLowerCase().includes(s))
      );
    }
    setProducts(filtered);
  }, [allProducts, selectedCategory, searchTerm]);

  // Track page_view once on mount (staff excluded)
  useEffect(() => {
    if (isStaffViewer) return;
    void trackStoreEvent({ workspaceId, sessionId: getOrCreateSessionId(), browserId: getBrowserId(), eventType: 'page_view' });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchTerm(searchInput);
    if (!isStaffViewer && searchInput.trim().length >= 2) {
      void trackStoreEvent({ workspaceId, sessionId: getOrCreateSessionId(), browserId: getBrowserId(), eventType: 'search', searchQuery: searchInput.trim() });
    }
  };

  const addToCart = (product: PublicProduct, variantId: string, quantity = 1) => {
    const variant = product.variants.find((v) => v.id === variantId);
    if (!variant) {
      // Open product detail so customer can add from there
      setSelectedProduct(product);
      return;
    }
    
    // Define add logic in a function we can export to window for testing
    const addItemToCart = (prevCart: StoreCartItem[]): StoreCartItem[] => {
      const idx = prevCart.findIndex(
        (i) => i.productId === product.id && i.variantId === variantId
      );
      
      if (idx >= 0) {
        // Update existing item
        const next = [...prevCart];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + quantity };
        return next;
      }
      
      // Add new item
      return [
        ...prevCart,
        {
          productId: product.id,
          variantId: variant.id,
          productName: product.name,
          variantName: variant.name,
          sku: variant.sku,
          quantity,
          price: variant.price,
          productImage: product.images?.[0]?.url,
        },
      ];
    };
    
    // Update cart state
    setCart(prev => {
      const newCart = addItemToCart(prev);
      saveCart(newCart);
      return newCart;
    });
    toast.success(`${product.name} added to cart`, { duration: 1500 });
    if (!isStaffViewer) {
      void trackStoreEvent({ workspaceId, sessionId: getOrCreateSessionId(), browserId: getBrowserId(), eventType: 'add_to_cart', productId: product.id, productName: product.name });
    }
    
    // Export cart test functions to window for debugging
    if (typeof window !== 'undefined') {
      (window as any).testCartFunctions = {
        getCartKey,
        saveCart,
        loadCart,
        getBrowserId,
        viewAllCarts: () => {
          const cartKeys = Object.keys(localStorage).filter(key => key.startsWith('cart_'));
          return cartKeys.reduce((obj, key) => {
            obj[key] = JSON.parse(localStorage.getItem(key) || '[]');
            return obj;
          }, {} as Record<string, any>);
        }
      };
    }
  };

  const updateProductUrl = (productId: string | null) => {
    if (productId) {
      navigate(`/store/product/${encodeURIComponent(productId)}`);
    } else {
      navigate("/store");
    }
  };

  const openProduct = (product: PublicProduct) => {
    setSelectedProduct(product);
    updateProductUrl(product.id);
    if (!isStaffViewer) {
      void trackStoreEvent({ workspaceId, sessionId: getOrCreateSessionId(), browserId: getBrowserId(), eventType: 'product_view', productId: product.id, productName: product.name });
    }
  };

  const closeProduct = () => {
    setSelectedProduct(null);
    updateProductUrl(null);
  };

  const updateQty = (productId: string, variantId: string, qty: number) => {
    if (qty <= 0) {
      removeFromCart(productId, variantId);
    } else {
      setCart((prev) => {
        // Update cart item quantity
        const newCart = prev.map((i) =>
          i.productId === productId && i.variantId === variantId
            ? { ...i, quantity: qty }
            : i
        );
        
        // Save to localStorage immediately
        saveCart(newCart);
        
        return newCart;
      });
    }
  };

  const removeFromCart = (productId: string, variantId: string) => {
    setCart((prev) => {
      // Remove item from cart
      const newCart = prev.filter(
        (i) => !(i.productId === productId && i.variantId === variantId)
      );
      
      // Save to localStorage immediately
      saveCart(newCart);
      
      return newCart;
    });
  };
  
  // Removed database functions - using localStorage persistence only

  const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const itemCount = cart.reduce((s, i) => s + i.quantity, 0);
  const storeName = ecomSettings.storeName || "My Store";
  const storePhone = ecomSettings.storePhone || "";
  const storePhoneTel = storePhone.replace(/\D/g, "") || "";
  const storeAddress = ecomSettings.storeAddress || "";
  const storeLogo = ecomSettings.storeLogo || "";

  // ── Store design template ──────────────────────────────────────────────────
  const template = getStoreTemplate(ecomSettings.storeTemplate);
  const accent = (ecomSettings.accentColor && ecomSettings.accentColor.trim()) || template.accent;
  const heroSlides = ecomSettings.heroSlides ?? [];

  const scrollCarousel = (dir: "left" | "right") => {
    if (!carouselRef.current) return;
    carouselRef.current.scrollBy({ left: dir === "left" ? -320 : 320, behavior: "smooth" });
  };

  const visibleProducts = inStockOnly
    ? products.filter((p) => p.variants.some((v) => v.inStock))
    : products;

  return (
    <div className={cn(
      "min-h-screen bg-white text-gray-800",
      template.font === "serif" ? "font-serif" : "font-sans",
      isWalkIn && "ring-4 ring-amber-400 ring-inset"
    )}>
      {/* ── ADMIN PREVIEW BAR ───────────────────────────────────────────────── */}
      {isAdminPreview && (
        <div className="sticky top-0 z-50 bg-[#cc1818] text-white px-4 py-2 text-center text-sm font-semibold shadow-md flex items-center justify-center gap-4 flex-wrap">
          <span>You are viewing your live store</span>
          <a
            href="https://shopflowz.web.app/crm"
            className="rounded-md bg-white text-[#cc1818] px-3 py-1 text-xs font-bold hover:bg-gray-100"
            onClick={() => { try { sessionStorage.removeItem('admin_preview'); } catch {} }}
          >
            ← Back to CRM
          </a>
        </div>
      )}

      {/* ── WALK-IN MODE BANNER ─────────────────────────────────────────────── */}
      {isWalkIn && (
        <div className="sticky top-0 z-40 bg-amber-400 text-amber-950 px-4 py-2 text-center text-sm font-semibold shadow-md flex items-center justify-center gap-4 flex-wrap">
          <span>🛒 WALK-IN SALE MODE — staff counter sale</span>
          <button
            onClick={() => {
              try { sessionStorage.removeItem('walkin_mode'); } catch {}
              window.close();
            }}
            className="rounded-md bg-amber-900 text-amber-50 px-3 py-1 text-xs font-bold hover:bg-amber-800"
          >
            Exit walk-in mode
          </button>
        </div>
      )}

      {/* ── TOP HEADER ─────────────────────────────────────────────────────── */}
      <header className="bg-gradient-to-r from-slate-950 via-blue-900 to-blue-700 text-white shadow-lg">
        {/* Row 1: Logo + Search + Cart */}
        <div className="max-w-7xl mx-auto px-4 py-4 md:py-5 flex flex-col lg:flex-row lg:items-center gap-4">
          <a href="/" className="flex items-center gap-4 shrink-0 min-w-0">
            <div className="h-16 w-16 md:h-20 md:w-20 rounded-full bg-white p-1.5 shadow-lg ring-2 ring-white/20 overflow-hidden">
              <img
                src={storeLogo}
                alt={`${storeName} logo`}
                className="h-full w-full rounded-full object-contain"
              />
            </div>
            <div className="min-w-0 leading-tight">
              <div className="font-black text-xl md:text-2xl leading-tight tracking-tight">
                {storeName}
              </div>
              {(ecomSettings.storeTagline || storeAddress) && (
                <div className="text-xs md:text-sm text-blue-100 tracking-wide uppercase">
                  {ecomSettings.storeTagline ? ecomSettings.storeTagline : storeAddress}
                </div>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs md:text-sm text-blue-100">
                <a href={`tel:${storePhoneTel}`} className="inline-flex items-center gap-1.5 hover:text-orange-300">
                  <Phone className="h-3.5 w-3.5" />
                  {storePhone}
                </a>
              </div>
            </div>
          </a>

          <div className="hidden md:flex flex-wrap items-center gap-2 shrink-0 text-sm lg:justify-end lg:ml-auto">
            <a href={`tel:${storePhoneTel}`} className="inline-flex items-center gap-2 rounded-md bg-white/10 px-3 py-2 text-blue-50 hover:bg-white/15 hover:text-orange-300 text-sm font-semibold transition-colors">
              <Phone className="h-4 w-4" />{storePhone}
            </a>
            {user ? (
              <>
                {(isSystemAdmin || workspace?.hasCrmAccess) && (
                  <button
                    onClick={() => navigate(isSystemAdmin ? "/admin" : "/crm")}
                    className="inline-flex items-center gap-2 text-white text-sm bg-green-600 hover:bg-green-700 border border-green-500 px-3 py-2 rounded-md font-bold transition-colors"
                  >
                    <LayoutDashboard className="h-4 w-4" /> Back to Dashboard
                  </button>
                )}
                <button onClick={() => setShowAccount(true)} className="inline-flex items-center gap-2 rounded-md px-2.5 py-2 text-blue-50 hover:bg-white/10 hover:text-orange-300 text-sm transition-colors">
                  <User className="h-4 w-4" />
                  {(user.user_metadata?.display_name || user.displayName || user.email?.split("@")[0] || "My Account").split(" ")[0]}
                </button>
                <button onClick={() => logout()} className="inline-flex items-center gap-2 rounded-md px-2.5 py-2 text-blue-50 hover:bg-white/10 hover:text-red-300 text-sm transition-colors">
                  <LogOut className="h-4 w-4" /> Sign Out
                </button>
              </>
            ) : (
              <button onClick={() => setShowStoreLogin(true)} className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-blue-50 hover:bg-white/10 hover:text-orange-300 text-sm transition-colors">
                <LogIn className="h-4 w-4" /> Sign In
              </button>
            )}
          </div>

          <button
            onClick={() => {
              setShowCart(true);
            }}
            className="relative shrink-0 flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white text-sm md:text-base font-bold px-4 h-12 rounded-lg shadow-md transition-colors"
          >
            <ShoppingCart className="h-5 w-5" />
            <span className="hidden sm:inline">
              {`${itemCount} item${itemCount !== 1 ? "s" : ""} · R${subtotal.toFixed(2)}`}
            </span>
            {itemCount > 0 && (
              <span className="sm:hidden inline-flex items-center justify-center w-5 h-5 rounded-full bg-white text-orange-600 text-xs font-bold">
                {itemCount}
              </span>
            )}
          </button>
        </div>

        {/* Row 2: Full-width search */}
        <div className="border-t border-white/10 bg-slate-950/40">
          <div className="max-w-7xl mx-auto px-4 py-3">
            <form onSubmit={handleSearch} className="w-full">
              <div className="relative w-full">
                <Input
                  type="text"
                  placeholder="Search products, parts, SKUs…"
                  value={searchInput}
                  onChange={(e) => {
                    setSearchInput(e.target.value);
                    if (e.target.value === "") setSearchTerm("");
                  }}
                  className="w-full bg-white text-gray-800 pl-11 pr-4 h-12 text-base border-0 rounded-lg shadow-sm focus-visible:ring-2 focus-visible:ring-orange-400"
                />
                <button
                  type="submit"
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-orange-500"
                  aria-label="Search"
                >
                  <Search className="h-5 w-5" />
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Row 3: Stock filter + Nav */}
        <div className="border-t border-white/10 bg-slate-950/25">
          <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3">
            <div className="flex items-center gap-4 text-sm">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="radio" name="stock_filter" checked={!inStockOnly} onChange={() => setInStockOnly(false)} className="accent-orange-400" />
                <span className="text-blue-50">Show all products</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="radio" name="stock_filter" checked={inStockOnly} onChange={() => setInStockOnly(true)} className="accent-orange-400" />
                <span className="text-blue-50">Only show in stock products</span>
              </label>
            </div>
            <nav className="flex items-center gap-5 text-sm font-medium">
              <button
                onClick={() => { setSelectedCategory("all"); setSearchTerm(""); setSearchInput(""); }}
                className="text-white hover:text-orange-400 flex items-center gap-1 transition-colors"
              >
                <Package className="h-3.5 w-3.5" /> Shop
              </button>
              <a href="#services" className="text-blue-50 hover:text-orange-400 flex items-center gap-1 transition-colors">
                <Wrench className="h-3.5 w-3.5" /> Services
              </a>
              <a href="#contact" className="text-blue-50 hover:text-orange-400 flex items-center gap-1 transition-colors">
                <Info className="h-3.5 w-3.5" /> Contact
              </a>
              <a href={`https://wa.me/${(ecomSettings as any).storeWhatsApp || '27746511031'}`} target="_blank" rel="noopener noreferrer"
                className="text-green-400 hover:text-green-300 flex items-center gap-1 transition-colors">
                <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
              </a>
            </nav>
          </div>
        </div>
      </header>

      {/* ── HERO SLIDER (template-driven) ──────────────────────────────────── */}
      {template.hero && !searchTerm && selectedCategory === "all" && (
        <HeroSlider slides={heroSlides} storeName={storeName} tagline={ecomSettings.storeTagline} accent={accent} height={ecomSettings.heroHeight} />
      )}

      {/* ── CATEGORY PILLS ─────────────────────────────────────────────────── */}
      {categories.length > 0 && (
        <CategoryPills
          categories={categories}
          selected={selectedCategory}
          onSelect={setSelectedCategory}
        />
      )}

      {/* ── LATEST CAROUSEL ────────────────────────────────────────────────── */}
      {template.carousel && !searchTerm && selectedCategory === "all" && (
        <section className="max-w-7xl mx-auto px-4 pt-8 pb-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-800">Latest</h2>
            <div className="flex gap-2">
              <button onClick={() => scrollCarousel("left")}
                className="w-8 h-8 rounded border border-gray-200 flex items-center justify-center hover:bg-gray-50">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button onClick={() => scrollCarousel("right")}
                className="w-8 h-8 rounded bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
          {loading ? (
            <div className="flex gap-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="w-44 shrink-0 bg-gray-100 animate-pulse rounded-lg h-64" />
              ))}
            </div>
          ) : (
            <div ref={carouselRef} className="flex gap-4 overflow-x-auto pb-2" style={{ scrollSnapType: "x mandatory" }}>
              {visibleProducts.map((product) => (
                <div key={product.id} style={{ scrollSnapAlign: "start" }} className="shrink-0 w-44">
                    <MiniProductCard product={product} onAddToCart={addToCart} onViewDetails={openProduct} showBrand={(ecomSettings as any).showBrand ?? false} />
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ── MAIN PRODUCT GRID ──────────────────────────────────────────────── */}
      <section id="store-products" className="max-w-7xl mx-auto px-4 py-6">
        {(searchTerm || selectedCategory !== "all") && (
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-700">
              {searchTerm ? `Results for "${searchTerm}"` : categories.find((c) => c.id === selectedCategory)?.name || "Products"}
            </h2>
            <button onClick={() => { setSelectedCategory("all"); setSearchTerm(""); setSearchInput(""); }}
              className="text-sm text-orange-500 hover:underline flex items-center gap-1">
              <X className="h-3 w-3" /> Clear filters
            </button>
          </div>
        )}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {[...Array(10)].map((_, i) => (
              <div key={i} className="bg-gray-100 animate-pulse rounded-lg h-72" />
            ))}
          </div>
        ) : visibleProducts.length === 0 ? (
          <div className="py-20 text-center">
            <ShoppingBag className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No products found</p>
            <p className="text-gray-400 text-sm mt-1">
              {searchTerm ? "Try a different search term" : inStockOnly ? "No products currently in stock" : "Check back soon — we're adding stock"}
            </p>
          </div>
        ) : (
          <div className={cn("grid gap-4", template.gridCols)}>
            {visibleProducts.map((product, i) => (
              <ProductCard key={product.id} product={product} index={i} variant={template.card} accent={accent} onAddToCart={addToCart} onViewDetails={openProduct} showBrand={(ecomSettings as any).showBrand ?? false} showSku={(ecomSettings as any).showSku ?? true} showQuantity={(ecomSettings as any).showQuantity ?? true} />
            ))}
          </div>
        )}
      </section>

      {selectedProduct && (
        <ProductDetailOverlay
          product={selectedProduct}
          onAddToCart={addToCart}
          onClose={closeProduct}
          showSupplier={(ecomSettings as any).showBrand ?? false}
          ecommerceSettings={ecomSettings}
        />
      )}
      {showCart && (
        <CartSidebar cart={cart} onUpdateQty={updateQty} onRemove={removeFromCart}
          onClose={() => setShowCart(false)} onCheckout={() => { setShowCart(false); setShowCheckout(true); if (!isStaffViewer) { void trackStoreEvent({ workspaceId, sessionId: getOrCreateSessionId(), browserId: getBrowserId(), eventType: 'checkout_start' }); } }}
          onClearCart={clearCart} user={user} whatsappNumber={(ecomSettings as any).storeWhatsApp || '27746511031'} ecommerceSettings={ecomSettings} />
      )}
      {showCheckout && (
        <CheckoutOverlay
          workspaceId={workspaceId}
          cart={cart}
          user={user}
          isWalkIn={isWalkIn}
          onComplete={() => {
            clearCart();
            setShowCheckout(false);
            if (!isStaffViewer) { void trackStoreEvent({ workspaceId, sessionId: getOrCreateSessionId(), browserId: getBrowserId(), eventType: 'purchase' }); }
          }}
          onClose={() => setShowCheckout(false)}
        />
      )}
      {showAccount && user && (
        <AccountDrawer
          workspaceId={workspaceId}
          user={user}
          onClose={() => setShowAccount(false)}
          onLogout={() => {
            setShowAccount(false);
            logout();
          }}
        />
      )}
      {showStoreLogin && !user && (
        <StoreLoginModal
          storeName={ecomSettings.storeName || "Store"}
          workspaceId={workspaceId}
          onClose={() => setShowStoreLogin(false)}
          onSuccess={() => setShowStoreLogin(false)}
          onRegistered={isStaffViewer ? undefined : () => void trackStoreEvent({ workspaceId, sessionId: getOrCreateSessionId(), browserId: getBrowserId(), eventType: 'registration' })}
        />
      )}

      {/* ── SERVICES SECTION (optional, configured in Ecommerce Settings) ── */}
      {ecomSettings.servicesEnabled && (
        <section id="services" className="py-16 px-4 bg-gray-50 border-t border-gray-200">
          <div className="max-w-5xl mx-auto">
            {ecomSettings.servicesBadge && (
              <div className="flex justify-center mb-3">
                <span className="inline-block bg-orange-100 text-orange-700 border border-orange-200 text-xs font-semibold px-3 py-1 rounded-full">
                  {ecomSettings.servicesBadge}
                </span>
              </div>
            )}
            {ecomSettings.servicesTitle && (
              <h2 className="text-3xl md:text-4xl font-bold text-center text-gray-800 mb-3">
                {ecomSettings.servicesTitle}
              </h2>
            )}
            {ecomSettings.servicesSubtitle && (
              <p className="text-center text-gray-500 max-w-2xl mx-auto mb-10">
                {ecomSettings.servicesSubtitle}
              </p>
            )}
            {(ecomSettings.services ?? []).length > 0 && (
              <div className={`grid gap-6 ${(ecomSettings.services ?? []).length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
                {(ecomSettings.services ?? []).map((svc, i) => (
                  <div key={i} className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                    <h3 className="font-bold text-gray-800 mb-2">{svc.title}</h3>
                    {svc.description && <p className="text-sm text-gray-500 mb-3">{svc.description}</p>}
                    {svc.bullets.filter(Boolean).length > 0 && (
                      <ul className="space-y-1">
                        {svc.bullets.filter(Boolean).map((b, j) => (
                          <li key={j} className="flex items-start gap-2 text-sm text-gray-600">
                            <span className="text-orange-500 mt-0.5">›</span>{b}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
            {ecomSettings.servicesCtaText && (
              <div className="flex justify-center mt-10">
                <a
                  href={ecomSettings.servicesCtaPhone ? `tel:${ecomSettings.servicesCtaPhone.replace(/\D/g, "")}` : "#"}
                  className="inline-flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-bold px-6 py-3 rounded-lg shadow-md transition-colors"
                >
                  {ecomSettings.servicesCtaText}
                </a>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Footer — policy + contact links (Google Merchant Center expects these on every page) */}
      <footer className="mt-12 border-t border-gray-200 bg-gray-50 py-8 px-4 text-sm text-gray-600">
        <div className="max-w-6xl mx-auto grid gap-6 sm:grid-cols-3">
          <div>
            <h3 className="font-semibold text-gray-900 mb-2">{storeName}</h3>
            {storeAddress && <p>{storeAddress}</p>}
            {storePhone && (
              <p className="mt-2">
                <a href={`https://wa.me/${storePhoneTel.replace(/^0/, "27")}`} className="text-blue-600 hover:underline">WhatsApp {storePhone}</a>
              </p>
            )}
            {ecomSettings.storeEmail && (
              <p>
                <a href={`mailto:${ecomSettings.storeEmail}`} className="text-blue-600 hover:underline">{ecomSettings.storeEmail}</a>
              </p>
            )}
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 mb-2">Customer Care</h3>
            <ul className="space-y-1">
              <li><a href="/shipping-policy" className="hover:text-blue-600 hover:underline">Shipping Policy</a></li>
              <li><a href="/returns-policy" className="hover:text-blue-600 hover:underline">Returns Policy</a></li>
              <li><a href="/store" className="hover:text-blue-600 hover:underline">Browse all products</a></li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 mb-2">Trading Hours</h3>
            <p>{ecomSettings?.businessHours || 'Mon–Sat 8am–5pm'}</p>
            <p className="mt-2 text-xs text-gray-500">
              Pickup orders are usually ready within an hour during business hours.
            </p>
          </div>
        </div>
        <div className="max-w-6xl mx-auto mt-6 pt-4 border-t border-gray-200 text-xs text-gray-500 text-center">
          © {new Date().getFullYear()} {storeName}. All prices in ZAR. E&amp;OE.
        </div>
      </footer>

      {/* Public ecommerce support bot — visible only when admin enabled it */}
      <EcommerceChatBubble workspaceId={workspaceId} />
    </div>
  );
}

type CustomerOrder = {
  id: string;
  orderNumber?: string;
  customerId?: string;
  userId?: string;
  customerInfo?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  items?: Array<{
    productName?: string;
    variantName?: string;
    sku?: string;
    quantity?: number;
    unitPrice?: number;
    totalPrice?: number;
    productImage?: string;
  }>;
  subtotal?: number;
  taxAmount?: number;
  shippingCost?: number;
  totalAmount?: number;
  currency?: string;
  status?: string;
  paymentStatus?: string;
  shippingAddress?: {
    street?: string;
    address?: string;
    city?: string;
    state?: string;
    postalCode?: string;
  };
  deliveryOption?: "pickup" | "delivery";
  createdAt?: string;
  updatedAt?: string;
};

function AccountDrawer({
  workspaceId,
  user,
  onClose,
  onLogout,
}: {
  workspaceId: string;
  user: any;
  onClose: () => void;
  onLogout: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"overview" | "orders" | "profile">("overview");
  const [profile, setProfile] = useState({
    name: user.displayName || user.email?.split("@")[0] || "",
    email: user.email || "",
    phone: "",
    address: "",
  });
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    loadAccountData();
  }, [workspaceId, user?.uid]);

  const loadAccountData = async () => {
    if (!user?.uid) return;
    setLoadingOrders(true);
    setMessage(null);

    try {
      const [{ data: profileData }, { data: orderRows, error: ordersError }] = await Promise.all([
        supabase
          .from("user_profiles")
          .select("display_name, email, phone, address")
          .eq("id", user.uid)
          .maybeSingle(),
        supabase
          .from("orders")
          .select("id, data, created_at")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false }),
      ]);

      if (profileData) {
        setProfile({
          name: profileData.display_name || user.displayName || user.email?.split("@")[0] || "",
          email: profileData.email || user.email || "",
          phone: profileData.phone || "",
          address: profileData.address || "",
        });
      }

      if (ordersError) {
        console.error("Error loading customer orders:", ordersError);
      }

      const customerEmail = (profileData?.email || user.email || "").toLowerCase();
      const customerOrders = (orderRows || [])
        .map((row: any) => ({ id: row.id, createdAt: row.created_at, ...(row.data || {}) } as CustomerOrder))
        .filter((order) => {
          const orderEmail = order.customerInfo?.email?.toLowerCase();
          return order.userId === user.uid || order.customerId === user.uid || (!!customerEmail && orderEmail === customerEmail);
        });

      setOrders(customerOrders);
    } catch (error) {
      console.error("Error loading account data:", error);
      setMessage("Could not load your account details right now.");
    } finally {
      setLoadingOrders(false);
    }
  };

  const saveProfile = async () => {
    if (!user?.uid) return;
    setSavingProfile(true);
    setMessage(null);

    try {
      const profilePayload = {
        email: profile.email || user.email,
        display_name: profile.name,
        phone: profile.phone,
        address: profile.address,
      };

      const { error } = await supabase
        .from("user_profiles")
        .update(profilePayload)
        .eq("id", user.uid);

      if (error) throw error;
      setMessage("Profile updated.");
    } catch (error) {
      console.error("Error saving profile:", error);
      setMessage("Could not save your profile details.");
    } finally {
      setSavingProfile(false);
    }
  };

  const totalSpent = orders
    .filter((order) => order.paymentStatus === "paid")
    .reduce((sum, order) => sum + (order.totalAmount || 0), 0);
  const latestOrder = orders[0];

  const navItems = [
    { id: "overview" as const, label: "Overview", icon: Home },
    { id: "orders" as const, label: "Orders", icon: ClipboardList },
    { id: "profile" as const, label: "Profile Details", icon: User },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end">
      <aside className="h-full w-full max-w-md bg-white shadow-2xl flex flex-col">
        <div className="px-6 py-5 border-b border-gray-100 flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">My Account</h2>
            <div className="mt-2 flex items-center gap-2 text-sm text-gray-600">
              <User className="h-4 w-4" />
              <span>{profile.name || profile.email}</span>
            </div>
          </div>
          <button onClick={onClose} className="p-1 text-blue-700 hover:text-blue-900" aria-label="Close account">
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="grid grid-cols-[150px_1fr] min-h-0 flex-1">
          <nav className="border-r border-gray-100 p-4 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm font-semibold text-left transition-colors ${
                    activeTab === item.id
                      ? "bg-blue-50 text-blue-700"
                      : "text-gray-600 hover:bg-gray-50 hover:text-blue-700"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
            <button
              onClick={onLogout}
              className="w-full flex items-center gap-2 px-3 py-2 rounded text-sm font-semibold text-left text-red-600 hover:bg-red-50 mt-4"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign Out</span>
            </button>
          </nav>

          <div className="min-w-0 overflow-y-auto p-5">
            {message && (
              <div className="mb-4 rounded border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">
                {message}
              </div>
            )}

            {activeTab === "overview" && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Overview</h3>
                  <p className="text-sm text-gray-500">Your store account and recent purchases.</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-gray-200 p-3">
                    <p className="text-xs text-gray-500">Orders</p>
                    <p className="text-2xl font-bold text-gray-900">{orders.length}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 p-3">
                    <p className="text-xs text-gray-500">Paid Total</p>
                    <p className="text-2xl font-bold text-gray-900">R{totalSpent.toFixed(2)}</p>
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 p-4">
                  <h4 className="font-semibold text-gray-900 mb-2">Latest Order</h4>
                  {latestOrder ? (
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="font-mono text-gray-700">{latestOrder.orderNumber || latestOrder.id}</span>
                        <span className="font-semibold">R{(latestOrder.totalAmount || 0).toFixed(2)}</span>
                      </div>
                      <div className="flex gap-2">
                        <StatusPill label={latestOrder.status || "pending"} />
                        <StatusPill label={latestOrder.paymentStatus || "pending"} />
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">No orders yet.</p>
                  )}
                </div>
              </div>
            )}

            {activeTab === "orders" && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Orders</h3>
                  <p className="text-sm text-gray-500">Purchases made with this account.</p>
                </div>
                {loadingOrders ? (
                  <p className="text-sm text-gray-500">Loading orders...</p>
                ) : orders.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center">
                    <Package className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">No purchases found for this account.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {orders.map((order) => (
                      <div key={order.id} className="rounded-lg border border-gray-200 p-3 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-mono text-sm font-semibold text-gray-900">{order.orderNumber || order.id}</p>
                            <p className="text-xs text-gray-500">
                              {order.createdAt ? new Date(order.createdAt).toLocaleDateString() : "Date unavailable"}
                            </p>
                          </div>
                          <p className="font-bold text-gray-900">R{(order.totalAmount || 0).toFixed(2)}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <StatusPill label={order.status || "pending"} />
                          <StatusPill label={order.paymentStatus || "pending"} />
                          {order.deliveryOption && <StatusPill label={order.deliveryOption} />}
                        </div>
                        <div className="space-y-1">
                          {(order.items || []).slice(0, 3).map((item, index) => (
                            <div key={`${order.id}-${index}`} className="flex justify-between gap-2 text-xs text-gray-600">
                              <span className="truncate">{item.productName || item.sku || "Product"} x {item.quantity || 1}</span>
                              <span>R{(item.totalPrice || 0).toFixed(2)}</span>
                            </div>
                          ))}
                          {(order.items || []).length > 3 && (
                            <p className="text-xs text-gray-400">+{(order.items || []).length - 3} more items</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "profile" && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Profile Details</h3>
                  <p className="text-sm text-gray-500">Keep your checkout details up to date.</p>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                    <Input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} className="bg-white text-gray-900 border-gray-300 placeholder:text-gray-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                    <Input value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} className="bg-white text-gray-900 border-gray-300 placeholder:text-gray-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                    <Input value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} className="bg-white text-gray-900 border-gray-300 placeholder:text-gray-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Delivery Address</label>
                    <textarea
                      value={profile.address}
                      onChange={(e) => setProfile({ ...profile, address: e.target.value })}
                      rows={4}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900"
                    />
                  </div>
                  <Button onClick={saveProfile} disabled={savingProfile} className="w-full bg-blue-700 hover:bg-blue-800">
                    <Save className="h-4 w-4 mr-2" />
                    {savingProfile ? "Saving..." : "Save Details"}
                  </Button>
                </div>
                {profile.address && (
                  <div className="rounded-lg border border-gray-200 p-3 text-sm text-gray-600 flex gap-2">
                    <MapPin className="h-4 w-4 text-blue-700 mt-0.5 shrink-0" />
                    <span>{profile.address}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

function StatusPill({ label }: { label: string }) {
  const normalized = label.replace(/_/g, " ");
  return (
    <span className="inline-flex items-center rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold capitalize text-blue-700">
      {normalized}
    </span>
  );
}

// ─── Mini Card (carousel) ─────────────────────────────────────────────────────
function MiniProductCard({
  product,
  onAddToCart,
  onViewDetails,
  showBrand = false,
}: {
  product: PublicProduct;
  onAddToCart: (p: PublicProduct, variantId: string, qty: number) => void;
  onViewDetails: (p: PublicProduct) => void;
  showBrand?: boolean;
}) {
  const v = product.variants[0];
  const imageUrl = product.images?.[0]?.url;
  return (
    <div
      className="bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-md hover:border-orange-200 transition-all cursor-pointer group"
      onClick={() => onViewDetails(product)}
    >
      <div className="relative aspect-square bg-gray-50 overflow-hidden">
        {imageUrl ? (
          <img src={imageUrl} alt={product.name} className={`w-full h-full object-contain p-2 group-hover:scale-105 transition-transform ${!(v?.inStock ?? false) ? "opacity-60" : ""}`} />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Package className="h-8 w-8 text-gray-300" />
          </div>
        )}
        {!(v?.inStock ?? false) && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="bg-red-600 text-white text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded shadow">Sold Out</span>
          </div>
        )}
      </div>
      <div className="p-2">
        <p className="text-xs font-semibold text-gray-800 leading-tight line-clamp-2 uppercase tracking-tight mb-1">{product.name}</p>
        {showBrand && product.brand && <p className="text-[10px] text-blue-700 font-medium mb-1">{product.brand}</p>}
        <StockPill inStock={v?.inStock ?? false} />
        {v && (
          <p className="text-sm font-bold text-gray-900 mt-1 flex items-baseline gap-1.5">
            <span>R{v.price.toFixed(2)}</span>
            {v.compareAtPrice && (
              <>
                <span className="text-[10px] text-gray-400 line-through">R{v.compareAtPrice.toFixed(2)}</span>
                <span className="text-[9px] bg-red-100 text-red-700 px-1 rounded font-semibold uppercase tracking-wide">Sale</span>
              </>
            )}
          </p>
        )}
        {v && (() => {
          const hasVariants = product.variants.length > 1;
          const anyInStock = product.variants.some(v => v.inStock);
          return (
            <button
              onClick={(e) => { e.stopPropagation(); hasVariants ? onViewDetails(product) : onAddToCart(product, v.id, 1); }}
              disabled={!anyInStock}
              className="mt-2 w-full text-[10px] font-semibold py-1 rounded transition-colors disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed bg-orange-500 hover:bg-orange-600 text-white"
            >
              {anyInStock ? (hasVariants ? "Select Options" : "Add to Cart") : "Out of Stock"}
            </button>
          );
        })()}
      </div>
    </div>
  );
}

// ─── Full Product Card ────────────────────────────────────────────────────────
function ProductCard({
  product,
  onAddToCart,
  onViewDetails,
  index = 0,
  showBrand = false,
  showSku = true,
  showQuantity = true,
  variant = "flip",
  accent = "#ea580c",
}: {
  product: PublicProduct;
  onAddToCart: (p: PublicProduct, variantId: string, qty: number) => void;
  onViewDetails: (p: PublicProduct) => void;
  index?: number;
  showBrand?: boolean;
  showSku?: boolean;
  showQuantity?: boolean;
  variant?: string;
  accent?: string;
}) {
  const v = product.variants[0];
  const imageUrl = product.images?.[0]?.url;
  const hasVariants = product.variants.length > 1;
  const inStock = product.variants.some(v => v.inStock);

  // Non-classic templates use a flat (no-flip) card themed by accent + variant.
  if (variant !== "flip") {
    return (
      <FlatProductCard
        product={product} index={index} variant={variant} accent={accent}
        onAddToCart={onAddToCart} onViewDetails={onViewDetails}
        showBrand={showBrand} showSku={showSku} showQuantity={showQuantity}
      />
    );
  }

  return (
    <div
      className="flip-card card-enter h-[340px]"
      style={{ animationDelay: `${Math.min(index * 60, 600)}ms` }}
    >
      <div className="flip-card-inner">
        {/* FRONT — image + price */}
        <div className="flip-card-front bg-white border border-gray-200 flex flex-col group">
          <div className="relative flex-1 bg-gray-50 overflow-hidden cursor-pointer" onClick={() => onViewDetails(product)}>
            {imageUrl ? (
              <img src={imageUrl} alt={product.name} className={`w-full h-full object-contain p-3 transition-transform duration-300 group-hover:scale-105 ${!inStock ? "opacity-60" : ""}`} />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Package className="h-10 w-10 text-gray-300" />
              </div>
            )}
            {!inStock && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="bg-red-600 text-white text-xs font-bold uppercase tracking-wide px-3 py-1.5 rounded shadow">Sold Out</span>
              </div>
            )}
          </div>
          <div className="p-3 border-t border-gray-100">
            {showBrand && product.brand && (
              <p className="text-[10px] text-blue-700 font-semibold uppercase tracking-wide">{product.brand}</p>
            )}
            <p className="text-xs font-bold text-gray-800 uppercase leading-tight line-clamp-2 mt-0.5">{product.name}</p>
            {showSku && v?.sku && <p className="text-[10px] text-gray-400 mt-0.5">Part No: {v.sku}</p>}
            {showQuantity && product.quantityInStock !== undefined && (
              <p className="text-[10px] text-gray-500 mt-0.5">In stock: {product.quantityInStock}</p>
            )}
            <div className="flex items-center justify-between mt-2">
              {v && (
                <p className="text-base font-bold text-[#cc1818] flex items-baseline gap-1.5">
                  <span>R{v.price.toFixed(2)}</span>
                  {v.compareAtPrice && (
                    <>
                      <span className="text-[11px] text-gray-400 line-through">R{v.compareAtPrice.toFixed(2)}</span>
                      <span className="text-[9px] bg-red-100 text-red-700 px-1 rounded font-semibold uppercase tracking-wide">Sale</span>
                    </>
                  )}
                </p>
              )}
              <StockPill inStock={inStock} />
            </div>
            <p className="text-[10px] text-gray-600 mt-0.5 text-right">Hover to see details ↺</p>
          </div>
        </div>

        {/* BACK — details + add to cart */}
        <div className="flip-card-back bg-blue-600 text-white flex flex-col p-4">
          <div className="flex-1 overflow-hidden">
            {imageUrl && (
              <img src={imageUrl} alt={product.name} className="w-16 h-16 object-contain bg-white/10 rounded p-1 mb-3 mx-auto block" />
            )}
            <p className="text-xs font-bold uppercase text-orange-400 leading-tight mb-1">{product.name}</p>
            {showBrand && product.brand && <p className="text-[10px] text-blue-100 mb-2">{product.brand}</p>}
            <p className="text-[11px] text-blue-100 line-clamp-4 leading-relaxed">
              {product.description || "Quality audio component. Click for full details."}
            </p>
          </div>
          <div className="mt-3 pt-3 border-t border-white/20 space-y-2">
            {v && (
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-slate-300">Price</span>
                <span className="text-base font-bold text-orange-400 flex items-baseline gap-1.5">
                  <span>R{v.price.toFixed(2)}</span>
                  {v.compareAtPrice && (
                    <span className="text-[10px] text-slate-300 line-through">R{v.compareAtPrice.toFixed(2)}</span>
                  )}
                </span>
              </div>
            )}
            <button
              onClick={() => hasVariants ? onViewDetails(product) : (v && onAddToCart(product, v.id, 1))}
              disabled={!inStock}
              className={`w-full text-xs font-semibold py-2 rounded transition-colors ${
                inStock ? "bg-orange-500 hover:bg-orange-600 text-white" : "bg-gray-600 text-gray-400 cursor-not-allowed"
              }`}
            >
              {inStock ? (hasVariants ? "Select Options" : "+ Add to Cart") : "Out of Stock"}
            </button>
            <button
              onClick={() => onViewDetails(product)}
              className="w-full text-[11px] text-blue-200 hover:text-white transition-colors underline underline-offset-2"
            >
              Full details →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Flat Product Card (showcase / boutique / bold / catalog templates) ───────
function FlatProductCard({
  product, onAddToCart, onViewDetails, index = 0, showBrand, showSku, showQuantity, variant, accent,
}: {
  product: PublicProduct;
  onAddToCart: (p: PublicProduct, variantId: string, qty: number) => void;
  onViewDetails: (p: PublicProduct) => void;
  index?: number;
  showBrand?: boolean;
  showSku?: boolean;
  showQuantity?: boolean;
  variant?: string;
  accent: string;
}) {
  const v = product.variants[0];
  const imageUrl = product.images?.[0]?.url;
  const hasVariants = product.variants.length > 1;
  const inStock = product.variants.some(v => v.inStock);

  const dark = variant === "bold";
  const compact = variant === "compact";
  const boutique = variant === "boutique";

  return (
    <div
      className={cn(
        "card-enter group flex flex-col overflow-hidden transition-all",
        dark
          ? "bg-slate-900 text-white rounded-xl border border-slate-800 hover:border-slate-600"
          : boutique
            ? "bg-white rounded-none border border-gray-200 hover:shadow-lg"
            : "bg-white rounded-xl border border-gray-200 hover:shadow-md",
      )}
      style={{ animationDelay: `${Math.min(index * 50, 600)}ms` }}
    >
      <div
        className={cn("relative overflow-hidden cursor-pointer", dark ? "bg-slate-800" : "bg-gray-50", compact ? "aspect-square" : "aspect-[4/3]")}
        onClick={() => onViewDetails(product)}
      >
        {imageUrl ? (
          <img src={imageUrl} alt={product.name} className={cn("w-full h-full object-contain p-3 transition-transform duration-500 group-hover:scale-110", !inStock && "opacity-60")} />
        ) : (
          <div className="w-full h-full flex items-center justify-center"><Package className="h-10 w-10 text-gray-300" /></div>
        )}
        {!inStock && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="bg-red-600 text-white text-xs font-bold uppercase tracking-wide px-3 py-1.5 rounded shadow">Sold Out</span>
          </div>
        )}
        {v?.compareAtPrice && inStock && (
          <span className="absolute top-2 left-2 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded text-white" style={{ background: accent }}>Sale</span>
        )}
      </div>

      <div className={cn("flex flex-col flex-1", compact ? "p-2.5" : "p-4")}>
        {showBrand && product.brand && (
          <p className="text-[10px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: accent }}>{product.brand}</p>
        )}
        <p
          className={cn(
            "leading-tight line-clamp-2 cursor-pointer",
            boutique ? "text-sm font-medium tracking-wide" : compact ? "text-xs font-semibold uppercase" : "text-sm font-bold",
            dark ? "text-white" : "text-gray-800",
          )}
          onClick={() => onViewDetails(product)}
        >
          {product.name}
        </p>
        {showSku && v?.sku && !compact && <p className={cn("text-[10px] mt-0.5", dark ? "text-slate-400" : "text-gray-400")}>Part No: {v.sku}</p>}
        {showQuantity && product.quantityInStock !== undefined && !compact && (
          <p className={cn("text-[10px] mt-0.5", dark ? "text-slate-400" : "text-gray-500")}>In stock: {product.quantityInStock}</p>
        )}

        <div className="mt-auto pt-2.5 flex items-end justify-between gap-2">
          <div className="flex flex-col">
            {v?.compareAtPrice && <span className={cn("text-[11px] line-through", dark ? "text-slate-500" : "text-gray-400")}>R{v.compareAtPrice.toFixed(2)}</span>}
            {v && <span className={cn(boutique ? "text-base font-semibold" : "text-lg font-extrabold")} style={{ color: dark ? accent : undefined }}>R{v.price.toFixed(2)}</span>}
          </div>
          <button
            onClick={() => hasVariants ? onViewDetails(product) : (v && inStock && onAddToCart(product, v.id, 1))}
            disabled={!inStock}
            title={inStock ? (hasVariants ? "Select options" : "Add to cart") : "Out of stock"}
            className={cn(
              "shrink-0 rounded-lg font-semibold transition-transform active:scale-95 text-white disabled:opacity-40 disabled:cursor-not-allowed",
              compact ? "h-8 w-8 flex items-center justify-center text-base" : "px-3 py-2 text-xs",
            )}
            style={{ background: inStock ? accent : "#9ca3af" }}
          >
            {compact ? "+" : inStock ? (hasVariants ? "Select Options" : "Add to Cart") : "Sold Out"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Hero Slider (showcase / boutique / bold templates) ───────────────────────
const HERO_HEIGHTS: Record<string, string> = {
  compact:  "h-[220px] md:h-[320px]",
  standard: "h-[320px] md:h-[460px]",
  tall:     "h-[420px] md:h-[600px]",
  full:     "h-[70vh] md:h-[80vh]",
};

function HeroSlider({
  slides, storeName, tagline, accent, height,
}: {
  slides: Array<{ image: string; heading?: string; subheading?: string; ctaText?: string }>;
  storeName: string;
  tagline?: string;
  accent: string;
  height?: string;
}) {
  const [idx, setIdx] = useState(0);
  const hasSlides = slides && slides.length > 0;
  const count = hasSlides ? slides.length : 1;
  const heightClass = HERO_HEIGHTS[height || "standard"] ?? HERO_HEIGHTS.standard;

  useEffect(() => {
    if (count <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % count), 5000);
    return () => clearInterval(t);
  }, [count]);

  const scrollToProducts = () => {
    const el = document.getElementById("store-products");
    if (el) el.scrollIntoView({ behavior: "smooth" });
    else window.scrollBy({ top: 500, behavior: "smooth" });
  };

  // No configured slides → a styled gradient hero using the store name + accent.
  if (!hasSlides) {
    return (
      <section className={cn("relative overflow-hidden flex items-center", heightClass)} style={{ background: `linear-gradient(120deg, ${accent}, #0f172a)` }}>
        <div className="max-w-7xl mx-auto px-6 w-full text-center text-white">
          <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight drop-shadow animate-[fadeIn_0.6s_ease]">{storeName}</h1>
          {tagline && <p className="mt-3 text-base md:text-lg text-white/85 max-w-2xl mx-auto">{tagline}</p>}
          <button onClick={scrollToProducts} className="mt-7 inline-block bg-white text-gray-900 font-bold px-7 py-3 rounded-full shadow-lg hover:scale-105 transition-transform">
            Shop Now
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className={cn("relative overflow-hidden bg-slate-900", heightClass)}>
      {/* Sliding track — all slides side by side, translated horizontally */}
      <div
        className="flex h-full w-full transition-transform duration-700 ease-[cubic-bezier(0.4,0,0.2,1)]"
        style={{ transform: `translateX(-${idx * 100}%)` }}
      >
        {slides.map((s, i) => (
          <div key={i} className="relative h-full w-full shrink-0 basis-full">
            <img
              src={s.image}
              alt={s.heading || storeName}
              className="absolute inset-0 w-full h-full object-cover"
              style={{ objectPosition: "center" }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-black/10" />
            <div className="absolute inset-0 flex items-center">
              <div className="max-w-7xl mx-auto px-6 w-full text-white">
                <div className={cn("max-w-xl transition-all duration-700", i === idx ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4")}>
                  {s.heading && <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight drop-shadow-lg">{s.heading}</h1>}
                  {s.subheading && <p className="mt-3 text-base md:text-lg text-white/90 drop-shadow">{s.subheading}</p>}
                  <button onClick={scrollToProducts} className="mt-6 inline-block font-bold px-7 py-3 rounded-full shadow-lg hover:scale-105 transition-transform text-white" style={{ background: accent }}>
                    {s.ctaText || "Shop Now"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Prev / next arrows */}
      {count > 1 && (
        <>
          <button
            onClick={() => setIdx((i) => (i - 1 + count) % count)}
            aria-label="Previous slide"
            className="absolute left-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-black/35 hover:bg-black/55 text-white flex items-center justify-center backdrop-blur-sm transition-colors"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => setIdx((i) => (i + 1) % count)}
            aria-label="Next slide"
            className="absolute right-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-black/35 hover:bg-black/55 text-white flex items-center justify-center backdrop-blur-sm transition-colors"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => setIdx(i)}
                aria-label={`Slide ${i + 1}`}
                className="h-2 rounded-full transition-all"
                style={{ width: i === idx ? 22 : 8, background: i === idx ? accent : "rgba(255,255,255,0.6)" }}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// ─── Product Detail Overlay ───────────────────────────────────────────────────
function ProductDetailOverlay({
  product,
  onAddToCart,
  onClose,
  showSupplier = false,
  ecommerceSettings,
}: {
  product: PublicProduct;
  onAddToCart: (p: PublicProduct, variantId: string, qty: number) => void;
  onClose: () => void;
  showSupplier?: boolean;
  ecommerceSettings: EcommerceSettings;
}) {
  const [selectedVariant, setSelectedVariant] = useState(product.variants[0]);
  const [quantity, setQuantity] = useState(1);
  const [activeImage, setActiveImage] = useState(product.images?.[0]?.url);
  const [activeTab, setActiveTab] = useState<"description" | "details">("description");
  const inStock = selectedVariant?.inStock ?? false;
  const shareUrl = `${window.location.origin}/store/product/${encodeURIComponent(product.id)}`;
  const taxRate = getTaxRate(ecommerceSettings);
  const selectedPrice = selectedVariant?.price ?? 0;
  const selectedTax = calculateTax(selectedPrice, ecommerceSettings);

  const copyProductLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Product link copied");
    } catch (error) {
      console.error("Could not copy product link:", error);
      toast.error("Could not copy product link");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto">
      <div className="relative bg-white w-full max-w-5xl mx-4 my-8 rounded-xl shadow-2xl">
        <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
          <button
            onClick={copyProductLink}
            className="h-8 px-3 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center gap-1.5 text-xs font-medium text-gray-700"
          >
            <Copy className="h-3.5 w-3.5" />
            Copy Link
          </button>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center">
          <X className="h-4 w-4 text-gray-600" />
          </button>
        </div>
        <div className="px-6 pt-5 pb-2 border-b border-gray-100">
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <button onClick={onClose} className="hover:text-orange-500">Home</button>
            <ChevronRight className="h-3 w-3" />
            <span className="text-gray-600 truncate max-w-xs">{product.name}</span>
          </div>
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Images */}
          <div className="space-y-3">
            <div className="aspect-square bg-gray-50 rounded-lg border border-gray-100 flex items-center justify-center p-4">
              {activeImage ? (
                <img src={activeImage} alt={product.name} className="max-h-full max-w-full object-contain" />
              ) : (
                <Package className="h-20 w-20 text-gray-300" />
              )}
            </div>
            {product.images && product.images.length > 1 && (
              <div className="flex gap-2 overflow-x-auto">
                {product.images.map((img, i) => (
                  <img key={i} src={img.url} alt=""
                    className={`w-16 h-16 object-contain border-2 rounded cursor-pointer hover:border-orange-400 transition-colors ${activeImage === img.url ? "border-orange-500" : "border-gray-200"}`}
                    onClick={() => setActiveImage(img.url)} />
                ))}
              </div>
            )}
          </div>
          {/* Details */}
          <div className="space-y-4">
            <div>
              <h1 className="text-xl font-bold text-blue-800 uppercase leading-snug">{product.name}</h1>
              {showSupplier && product.brand && <p className="text-sm text-blue-700 font-medium mt-0.5">Supplier: <span className="underline">{product.brand}</span></p>}
              {selectedVariant?.sku && <p className="text-xs text-gray-500 mt-0.5">Product Code: {selectedVariant.sku}</p>}
              <p className="text-xs text-gray-500">Product Status: <span className={`font-medium ${inStock ? "text-green-600" : "text-red-500"}`}>{inStock ? "Active" : "Out of Stock"}</span></p>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700 mb-1">Stock</p>
              <table className="w-full border border-gray-200 text-sm rounded overflow-hidden">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Warehouse</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Stock Status</th>
                    {(ecommerceSettings as any).showQuantity && (
                      <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Qty</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-gray-100">
                    <td className="px-3 py-2 text-gray-700">{ecommerceSettings.storeAddress || ecommerceSettings.storeName || "Main Warehouse"}</td>
                    <td className="px-3 py-2"><StockPill inStock={selectedVariant?.inStock ?? false} /></td>
                    {(ecommerceSettings as any).showQuantity && (
                      <td className="px-3 py-2 font-medium text-gray-800">{product.quantityInStock ?? 0}</td>
                    )}
                  </tr>
                </tbody>
              </table>
            </div>
            {product.variants.length > 1 && (
              <div className="space-y-1">
                <p className="text-sm font-semibold text-gray-700">Options</p>
                {product.variants.map((variant) => (
                  <button key={variant.id} onClick={() => setSelectedVariant(variant)} disabled={!variant.inStock}
                    className={`w-full text-left px-3 py-2 border rounded text-sm flex justify-between items-center transition-colors ${
                      selectedVariant.id === variant.id ? "border-orange-500 bg-orange-50" : "border-gray-200 hover:border-gray-300"
                    } ${!variant.inStock ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    <span>{variant.name}</span>
                    <span className="font-medium">R{variant.price.toFixed(2)}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="border-t border-gray-100 pt-3">
              <p className="text-3xl font-bold text-[#cc1818]">
                R{selectedPrice.toFixed(2)}
                {taxRate > 0 && (
                  <span className="text-sm font-normal text-gray-500 ml-2">
                    {ecommerceSettings.taxIncluded
                      ? `(Includes tax: R${selectedTax.toFixed(2)})`
                      : `(+ ${getTaxLabel(ecommerceSettings)} at checkout)`}
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center border border-gray-200 rounded overflow-hidden">
                <button onClick={() => setQuantity(Math.max(1, quantity - 1))} className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 text-gray-600">
                  <Minus className="h-3 w-3" />
                </button>
                <input type="number" min={1} value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-12 h-8 text-center text-sm border-x border-gray-200 focus:outline-none" />
                <button onClick={() => setQuantity(quantity + 1)} className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 text-gray-600">
                  <Plus className="h-3 w-3" />
                </button>
              </div>
              <button
                onClick={() => { onAddToCart(product, selectedVariant.id, quantity); onClose(); }}
                disabled={!inStock}
                className={`flex-1 h-9 rounded font-semibold text-sm flex items-center justify-center gap-2 transition-colors ${
                  inStock ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-gray-100 text-gray-400 cursor-not-allowed"
                }`}
              >
                <ShoppingCart className="h-4 w-4" />
                {inStock ? "Add to Cart" : "Out of Stock"}
              </button>
            </div>
            <div className="border-t border-gray-100 pt-3">
              <div className="flex gap-4 border-b border-gray-200 mb-3">
                {(["description", "details"] as const).map((tab) => (
                  <button key={tab} onClick={() => setActiveTab(tab)}
                    className={`pb-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                      activeTab === tab ? "border-orange-500 text-orange-600" : "border-transparent text-gray-500 hover:text-gray-700"
                    }`}>{tab}</button>
                ))}
              </div>
              {activeTab === "description" ? (
                <p className="text-sm text-gray-600 leading-relaxed">{product.description || "No description available."}</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {showSupplier && product.brand && (
                      <tr className="border-b border-gray-100">
                        <td className="py-1.5 pr-4 text-gray-500 font-medium">Supplier</td>
                        <td className="py-1.5 text-gray-700">{product.brand}</td>
                      </tr>
                    )}
                    {selectedVariant?.sku && (
                      <tr className="border-b border-gray-100">
                        <td className="py-1.5 pr-4 text-gray-500 font-medium">SKU</td>
                        <td className="py-1.5 text-gray-700">{selectedVariant.sku}</td>
                      </tr>
                    )}
                    {product.category && (
                      <tr className="border-b border-gray-100">
                        <td className="py-1.5 pr-4 text-gray-500 font-medium">Category</td>
                        <td className="py-1.5 text-gray-700">{product.category}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Cart Sidebar ─────────────────────────────────────────────────────────────
function CartSidebar({
  cart, onUpdateQty, onRemove, onClose, onCheckout, onClearCart, user, whatsappNumber = '27746511031', ecommerceSettings,
}: {
  cart: StoreCartItem[];
  onUpdateQty: (productId: string, variantId: string, qty: number) => void;
  onRemove: (productId: string, variantId: string) => void;
  onClose: () => void;
  onCheckout: () => void;
  onClearCart: () => void;
  user: ReturnType<typeof useAuth>["user"];
  whatsappNumber?: string;
  ecommerceSettings: EcommerceSettings;
}) {
  const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const tax = calculateTax(subtotal, ecommerceSettings);
  const total = calculateTotal(subtotal, 0, ecommerceSettings);
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full max-w-md flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-blue-600 text-white">
          <h2 className="font-bold text-lg flex items-center gap-2"><ShoppingCart className="h-5 w-5" /> Shopping Cart</h2>
          <button onClick={onClose} className="hover:text-orange-400"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {cart.length === 0 ? (
            <div className="text-center py-16">
              <ShoppingCart className="h-12 w-12 text-gray-200 mx-auto mb-3" />
              <p className="text-gray-500">Your cart is empty</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {cart.map((item) => (
                <div key={`${item.productId}-${item.variantId}`} className="flex items-start gap-3 p-4">
                  {item.productImage ? (
                    <img src={item.productImage} alt={item.productName} className="w-14 h-14 object-contain border border-gray-100 rounded bg-gray-50" />
                  ) : (
                    <div className="w-14 h-14 bg-gray-100 rounded flex items-center justify-center">
                      <Package className="h-6 w-6 text-gray-300" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-800 uppercase leading-tight line-clamp-2">{item.productName}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">SKU: {item.sku}</p>
                    <p className="text-sm font-bold text-[#cc1818] mt-1">R{(item.price * item.quantity).toFixed(2)}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <button onClick={() => onUpdateQty(item.productId, item.variantId, item.quantity - 1)}
                        className="w-6 h-6 border border-gray-200 rounded flex items-center justify-center hover:bg-gray-50">
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="text-sm w-6 text-center">{item.quantity}</span>
                      <button onClick={() => onUpdateQty(item.productId, item.variantId, item.quantity + 1)}
                        className="w-6 h-6 border border-gray-200 rounded flex items-center justify-center hover:bg-gray-50">
                        <Plus className="h-3 w-3" />
                      </button>
                      <button onClick={() => onRemove(item.productId, item.variantId)}
                        className="ml-2 text-[10px] text-red-400 hover:text-red-600 flex items-center gap-0.5">
                        <X className="h-3 w-3" /> Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {cart.length > 0 && (
          <div className="border-t border-gray-200 p-5 space-y-3 bg-gray-50">
            <div className="flex justify-between text-sm text-gray-600">
              <span>{getTaxRate(ecommerceSettings) > 0 && !ecommerceSettings.taxIncluded ? "Subtotal (excl. tax)" : "Subtotal"}</span><span>R{subtotal.toFixed(2)}</span>
            </div>
            {getTaxRate(ecommerceSettings) > 0 && (
              <div className="flex justify-between text-sm text-gray-600">
                <span>{ecommerceSettings.taxIncluded ? `${getTaxLabel(ecommerceSettings)} included` : getTaxLabel(ecommerceSettings)}</span><span>R{tax.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-base">
              <span>Total</span>
              <span className="text-[#cc1818]">R{total.toFixed(2)}</span>
            </div>
            <button 
              onClick={() => {
                if (!user) {
                  setShowCart(false);
                  setShowStoreLogin(true);
                  return;
                }
                onCheckout();
              }}
              className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2.5 rounded flex items-center justify-center gap-2 transition-colors">
              <CreditCard className="h-4 w-4" /> {user ? 'Proceed to Checkout' : 'Sign In to Checkout'}
            </button>
            <button onClick={onClearCart}
              className="w-full bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium py-2 rounded flex items-center justify-center gap-2 transition-colors text-sm">
              <X className="h-4 w-4" /> Clear Cart
            </button>
            <p className="text-center text-xs text-gray-400">
              Or <a href={`https://wa.me/${whatsappNumber}`} target="_blank" rel="noopener noreferrer" className="text-green-600 hover:underline">order via WhatsApp</a>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Walk-in Staff Payment Panel ────────────────────────────────────────────
// Replaces the public "Pay Now with iKhokha" button when staff opens the
// store via /store?walkin=1. Three payment paths: WhatsApp paylink (sends
// the iKhokha link to the buyer's phone), Card Terminal (records the swipe
// done on the physical iKhokha terminal), and Cash (marks paid immediately).
function WalkInStaffPaymentPanel({
  workspaceId,
  cart,
  customerInfo,
  total,
  deliveryFee,
  deliveryOption,
  loading,
  setLoading,
  setError,
  onComplete,
}: {
  workspaceId: string;
  cart: StoreCartItem[];
  customerInfo: { name: string; email: string; phone: string; address?: string };
  total: number;
  deliveryFee: number;
  deliveryOption: "pickup" | "delivery";
  loading: boolean;
  setLoading: (v: boolean) => void;
  setError: (msg: string | null) => void;
  onComplete: () => void;
}) {
  const validate = (requirePhone: boolean): boolean => {
    if (cart.length === 0 || total <= 0) {
      setError("Cart is empty.");
      return false;
    }
    if (requirePhone && !customerInfo.phone) {
      setError("Phone number is required to send a WhatsApp paylink.");
      return false;
    }
    setError(null);
    return true;
  };

  // Shared: build the order shape used by createOrder
  const buildOrderArgs = (paymentLabel: string, markPaid: boolean) => {
    const buyerName = customerInfo.name?.trim() || "Walk-in Customer";
    return {
      customer: {
        id: `walkin_${Date.now()}`,
        name: buyerName,
        email: customerInfo.email || "",
        phone: customerInfo.phone || "",
      },
      items: cart,
      shippingAddress: {
        street: deliveryOption === "delivery" ? (customerInfo.address || "") : "",
        city: "",
        postalCode: "",
        province: "",
        country: "South Africa",
      },
      paymentMethod: {
        id: paymentLabel,
        type: "cash_on_delivery" as const,
        name: paymentLabel,
      },
      source: "walk_in",
      ...(markPaid && { paymentStatus: "paid" as const, status: "confirmed" as const }),
    };
  };

  // ── Path 1: WhatsApp Paylink ─────────────────────────────────────────────
  const handleWhatsAppPaylink = async () => {
    if (!validate(true)) return;
    setLoading(true);
    try {
      const { createEcommercePaymentLink } = await import("@/lib/ikhokhaPaymentService");
      const orderId = `WALKIN-${Date.now()}`;
      const orderDescription = cart.map((i) => `${i.productName} x${i.quantity}`).join(", ");
      const buyerName = customerInfo.name?.trim() || "Walk-in Customer";

      const paymentLink = await createEcommercePaymentLink(
        workspaceId,
        orderId,
        total,
        buyerName,
        customerInfo.email || "",
        customerInfo.phone,
        deliveryOption === "delivery" ? (customerInfo.address || "") : "",
        orderDescription,
        cart,
        undefined,
        deliveryOption,
        deliveryFee,
      );

      if (!paymentLink?.paylinkUrl) throw new Error("No paylink returned by iKhokha.");

      const waPhone = customerInfo.phone.replace(/\D/g, "").replace(/^0/, "27");
      const msg = encodeURIComponent(
        `Hi ${buyerName.split(" ")[0]}, here's your payment link for your purchase at ${storeName}:\n\n` +
        `Total: R${total.toFixed(2)}\n\n${paymentLink.paylinkUrl}\n\nThanks!`,
      );
      window.open(`https://wa.me/${waPhone}?text=${msg}`, "_blank", "noopener,noreferrer");

      toast.success("Paylink sent", {
        description: `WhatsApp opened for ${customerInfo.phone}. Order stays awaiting payment until iKhokha confirms.`,
      });
      onComplete();
    } catch (err: any) {
      console.error("[walk-in] WhatsApp paylink failed:", err);
      setError(err?.message || "Failed to create paylink. Try again.");
    } finally {
      setLoading(false);
    }
  };

  // ── Path 2: Card Terminal (physical iKhokha device) ──────────────────────
  const handleCardTerminal = async () => {
    if (!validate(false)) return;
    if (!confirm(`Confirm: customer paid R${total.toFixed(2)} on the iKhokha card terminal?`)) return;
    setLoading(true);
    try {
      const { createOrder } = await import("@/lib/orderService");
      await createOrder(workspaceId, buildOrderArgs("Card Terminal (iKhokha)", true));
      toast.success("Sale recorded", {
        description: `R${total.toFixed(2)} paid by card terminal.`,
      });
      onComplete();
    } catch (err: any) {
      console.error("[walk-in] card terminal sale failed:", err);
      setError(err?.message || "Failed to record sale.");
    } finally {
      setLoading(false);
    }
  };

  // ── Path 3: Cash ─────────────────────────────────────────────────────────
  const handleCash = async () => {
    if (!validate(false)) return;
    if (!confirm(`Confirm: customer paid R${total.toFixed(2)} in cash?`)) return;
    setLoading(true);
    try {
      const { createOrder } = await import("@/lib/orderService");
      await createOrder(workspaceId, buildOrderArgs("Cash", true));
      toast.success("Sale recorded", {
        description: `R${total.toFixed(2)} paid in cash.`,
      });
      onComplete();
    } catch (err: any) {
      console.error("[walk-in] cash sale failed:", err);
      setError(err?.message || "Failed to record sale.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3 rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-amber-900">
        Staff payment options
      </div>

      <button
        onClick={handleWhatsAppPaylink}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-semibold py-3 rounded text-sm transition-colors"
      >
        <MessageCircle className="h-4 w-4" />
        {loading ? "Working…" : `Send WhatsApp Paylink — R${total.toFixed(2)}`}
      </button>

      <button
        onClick={handleCardTerminal}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 bg-blue-700 hover:bg-blue-800 disabled:bg-gray-300 text-white font-semibold py-3 rounded text-sm transition-colors"
      >
        <CreditCard className="h-4 w-4" />
        {loading ? "Working…" : `Card Terminal (paid in shop) — R${total.toFixed(2)}`}
      </button>

      <button
        onClick={handleCash}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white font-semibold py-3 rounded text-sm transition-colors"
      >
        <DollarSign className="h-4 w-4" />
        {loading ? "Working…" : `Cash — R${total.toFixed(2)}`}
      </button>

      <p className="text-[11px] text-amber-800">
        WhatsApp link order stays "awaiting payment" until iKhokha confirms.
        Card and Cash mark the order paid immediately.
      </p>
    </div>
  );
}

// ─── Checkout Overlay ─────────────────────────────────────────────────────────
function CheckoutOverlay({
  workspaceId, cart, user, isWalkIn, onComplete, onClose,
}: {
  workspaceId: string;
  cart: StoreCartItem[];
  user: any;
  isWalkIn?: boolean;
  onComplete: () => void;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customerInfo, setCustomerInfo] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    street: '',
    suburb: '',
    city: '',
    postalCode: '',
  });
  const [showContactOptions, setShowContactOptions] = useState(false);
  const [deliveryOption, setDeliveryOption] = useState<'pickup' | 'delivery'>('pickup');
  const [paymentMethod, setPaymentMethod] = useState<'paylink' | 'cash_on_collection'>('paylink');
  const [ecommerceSettings, setEcommerceSettings] = useState<EcommerceSettings>(DEFAULT_ECOMMERCE_SETTINGS);
  const [courierRate, setCourierRate] = useState<number | null>(null);
  const [courierService, setCourierService] = useState<string>('');
  const [courierLoading, setCourierLoading] = useState(false);
  const [courierError, setCourierError] = useState<string | null>(null);

  // Load ecommerce settings
  useEffect(() => {
    async function loadSettings() {
      try {
        const settings = await loadEcommerceSettings(workspaceId);
        setEcommerceSettings(settings);
        // Set default delivery option based on settings
        if (!settings.enablePickup && settings.enableDelivery) {
          setDeliveryOption('delivery');
        }
      } catch (error) {
        console.error('Error loading ecommerce settings:', error);
      }
    }
    loadSettings();
  }, [workspaceId]);

  // ShipLogic live rate fetch
  const fetchCourierRate = async (street: string, suburb: string, city: string, postalCode: string) => {
    setCourierLoading(true);
    setCourierError(null);
    try {
      const itemCount = cart.reduce((s, i) => s + i.quantity, 0);
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/shiplogic-rates`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({
          workspaceId,
          deliveryStreet: street,
          deliverySuburb: suburb,
          deliveryCity: city,
          deliveryPostalCode: postalCode,
          totalWeightKg: itemCount * 0.5,
        }),
      });
      let data: any;
      try { data = await resp.json(); } catch { data = { error: 'Delivery service returned an unexpected response' }; }
      if (!resp.ok) {
        const msg = data?.error || data?.message || data?.detail || `Delivery API error (${resp.status})`;
        throw new Error(msg);
      }
      if (typeof data.rate === 'number' && data.rate > 0) {
        const markup = ecommerceSettings.shiplogicMarkupPercent ?? 0;
        const markedUp = markup > 0
          ? Math.ceil(data.rate * (1 + markup / 100))  // round up to nearest rand
          : data.rate;
        setCourierRate(markedUp);
        setCourierService(data.service || '');
      } else {
        throw new Error('No delivery rates available for this address. Please check the address or contact us.');
      }
    } catch (e) {
      setCourierRate(null);
      setCourierService('');
      setCourierError(e instanceof Error ? e.message : 'Unable to fetch delivery rate.');
    } finally {
      setCourierLoading(false);
    }
  };

  // Clear the rate whenever the address changes — user must click Calculate again
  useEffect(() => {
    if (deliveryOption !== 'delivery' || !ecommerceSettings.shiplogicEnabled) {
      setCourierRate(null);
      setCourierError(null);
    } else {
      // Address changed — clear stale rate so user knows to recalculate
      setCourierRate(null);
      setCourierError(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerInfo.street, customerInfo.suburb, customerInfo.city, customerInfo.postalCode, deliveryOption]);

  // Auto-fill customer info from user profile if logged in
  useEffect(() => {
    // In walk-in mode, never auto-fill from the staff member's profile —
    // these fields are for the customer at the counter.
    if (isWalkIn) return;
    async function loadUserProfile() {
      if (user?.uid) {
        try {
          const { data: profileData } = await supabase
            .from('user_profiles')
            .select('display_name, email, phone, address')
            .eq('id', user.uid)
            .single();
          if (profileData) {
            setCustomerInfo({
              name: profileData.display_name || user.displayName || user.email?.split('@')[0] || '',
              email: profileData.email || user.email || '',
              phone: profileData.phone || '',
              address: profileData.address || ''
            });
          } else if (user.email) {
            // Fallback to auth user data if Firestore profile doesn't exist
            setCustomerInfo({
              name: user.displayName || user.email.split('@')[0] || '',
              email: user.email,
              phone: '',
            });
          }
        } catch (error) {
          console.error('Error loading user profile:', error);
          // Fallback to basic auth data
          if (user.email) {
            setCustomerInfo({
              name: user.displayName || user.email.split('@')[0] || '',
              email: user.email,
              phone: '',
            });
          }
        }
      }
    }
    loadUserProfile();
  }, [user, isWalkIn]);

  const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const tax = calculateTax(subtotal, ecommerceSettings);
  const hasDeliveryAddress = !!(customerInfo.street || customerInfo.address);
  const usingShipLogic = !!ecommerceSettings.shiplogicEnabled;
  const deliveryFee: number | null = deliveryOption === 'delivery'
    ? (!hasDeliveryAddress
        ? null  // no address entered yet
        : usingShipLogic
          ? (courierLoading ? null : courierRate)  // Fastway only — null while loading or on error
          : calculateDeliveryFee(ecommerceSettings, customerInfo.address || customerInfo.street || '', subtotal))
    : 0;
  const total = calculateTotal(subtotal, deliveryFee ?? 0, ecommerceSettings);

  const handlePayNow = async () => {
    if (!customerInfo.name || !customerInfo.email || !customerInfo.phone) {
      setError('Please fill in all required fields');
      return;
    }

    if (deliveryOption === 'delivery' && !hasDeliveryAddress) {
      setError('Please enter a delivery address');
      return;
    }
    if (deliveryOption === 'delivery' && usingShipLogic && deliveryFee === null) {
      setError(courierError || 'Please wait for delivery rate to calculate, or check your address.');
      return;
    }

    // Check min/max order amounts
    if (ecommerceSettings.minOrderAmount && subtotal < ecommerceSettings.minOrderAmount) {
      setError(`Minimum order amount is R${ecommerceSettings.minOrderAmount.toFixed(2)}`);
      return;
    }

    if (ecommerceSettings.maxOrderAmount && subtotal > ecommerceSettings.maxOrderAmount) {
      setError(`Maximum order amount is R${ecommerceSettings.maxOrderAmount.toFixed(2)}`);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Capture user reference at the start to avoid closure issues
      const currentUser = user;
      const currentUserId = currentUser?.uid;
      
      const orderDescription = cart.map(i => `${i.productName} x${i.quantity}`).join(', ');
      const orderId = `ORDER-${Date.now()}`;

      // Handle Cash on Collection - create order directly without payment
      if (paymentMethod === 'cash_on_collection') {
        const { createOrder } = await import('@/lib/orderService');
        
        // Fetch user address if logged in
        let userAddress = '';
        if (currentUserId) {
          try {
            const { data: profileData } = await supabase
              .from('user_profiles')
              .select('address')
              .eq('id', currentUserId)
              .single();
            if (profileData) {
              userAddress = profileData.address || '';
            }
          } catch (err) {
            console.error('Error fetching user address:', err);
          }
        }

        const customer = {
          id: currentUserId || `guest_${Date.now()}`,
          name: customerInfo.name,
          email: customerInfo.email,
          phone: customerInfo.phone,
        };

        const shippingAddress = {
          street: deliveryOption === 'delivery' ? (customerInfo.street || customerInfo.address) : userAddress,
          suburb: deliveryOption === 'delivery' ? customerInfo.suburb : '',
          city: deliveryOption === 'delivery' ? customerInfo.city : '',
          postalCode: deliveryOption === 'delivery' ? customerInfo.postalCode : '',
          province: '',
          country: 'South Africa',
        };

        const paymentMethodObj = {
          id: 'cash_on_collection',
          type: 'cash_on_delivery' as const,
          name: 'Cash on Collection',
        };

        await createOrder(workspaceId, {
          customer,
          items: cart,
          shippingAddress,
          paymentMethod: paymentMethodObj,
        });

        // Redirect to success page with order details
        window.location.href = `/store/order-success?orderId=${orderId}&workspaceId=${workspaceId}&paymentMethod=cash_on_collection`;
        return;
      }

      // Standard paylink flow
      const { createEcommercePaymentLink } = await import('@/lib/ikhokhaPaymentService');
      
      // Fetch user's address from Firestore if logged in
      let userAddress = '';
      
      if (currentUserId) {
        try {
          const { data: profileData } = await supabase
            .from('user_profiles')
            .select('address')
            .eq('id', currentUserId)
            .single();
          if (profileData) {
            userAddress = profileData.address || '';
          }
        } catch (err) {
          console.error('Error fetching user address:', err);
          // Continue without address if fetch fails
        }
      }

      const paymentLink = await createEcommercePaymentLink(
        workspaceId,
        orderId,
        total, // Now includes delivery fee if selected
        customerInfo.name,
        customerInfo.email,
        customerInfo.phone,
        deliveryOption === 'delivery'
          ? [customerInfo.street, customerInfo.suburb, customerInfo.city, customerInfo.postalCode].filter(Boolean).join(', ') || customerInfo.address
          : userAddress,
        orderDescription,
        cart,
        currentUserId, // Pass userId if available
        deliveryOption,
        deliveryFee
      );

      if (paymentLink.paylinkUrl) {
        // Redirect to payment page
        window.location.href = paymentLink.paylinkUrl;
      } else {
        throw new Error('Failed to create payment link');
      }
    } catch (err) {
      console.error('Payment error:', err);
      setError('Failed to create payment link. Please try again or contact us.');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-lg rounded-xl shadow-2xl p-6 space-y-4 [&_input]:bg-white [&_input]:text-gray-900 [&_input]:border-gray-300 [&_input]:placeholder:text-gray-400 [&_textarea]:bg-white [&_textarea]:text-gray-900 [&_label]:text-gray-700">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-blue-800">
            {isWalkIn ? "Walk-in Customer Checkout" : "Checkout"}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>

        {isWalkIn && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Counter sale — enter the buyer's details if known. Only name OR phone is required.
          </div>
        )}

        {/* Customer Information Form */}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {isWalkIn ? "Customer Name" : "Full Name"}
              {isWalkIn && <span className="text-xs text-gray-400 ml-1">(optional)</span>}
            </label>
            <Input
              type="text"
              placeholder={isWalkIn ? "Walk-in Customer" : "John Doe"}
              value={customerInfo.name}
              onChange={(e) => setCustomerInfo({ ...customerInfo, name: e.target.value })}
              className="w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Email Address
              {isWalkIn && <span className="text-xs text-gray-400 ml-1">(optional)</span>}
            </label>
            <Input
              type="email"
              placeholder="john@example.com"
              value={customerInfo.email}
              onChange={(e) => setCustomerInfo({ ...customerInfo, email: e.target.value })}
              className="w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Phone Number
              {isWalkIn && <span className="text-xs text-gray-400 ml-1">(needed for WhatsApp paylink only)</span>}
            </label>
            <Input
              type="tel"
              placeholder="071 234 5678"
              value={customerInfo.phone}
              onChange={(e) => setCustomerInfo({ ...customerInfo, phone: e.target.value })}
              className="w-full"
            />
          </div>

          {/* Delivery Option */}
          {(ecommerceSettings.enablePickup || ecommerceSettings.enableDelivery) && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Delivery Option</label>
              <div className={`grid gap-3 ${ecommerceSettings.enablePickup && ecommerceSettings.enableDelivery ? 'grid-cols-2' : 'grid-cols-1'}`}>
                {ecommerceSettings.enablePickup && (
                  <button
                    type="button"
                    onClick={() => setDeliveryOption('pickup')}
                    className={`p-3 rounded-lg border-2 text-sm font-medium transition-all ${
                      deliveryOption === 'pickup'
                        ? 'border-orange-500 bg-orange-50 text-orange-700'
                        : 'border-gray-200 hover:border-gray-300 text-gray-700'
                    }`}
                  >
                    <div className="font-semibold">Pickup</div>
                    <div className="text-xs mt-1">Free</div>
                  </button>
                )}
                {ecommerceSettings.enableDelivery && (
                  <button
                    type="button"
                    onClick={() => setDeliveryOption('delivery')}
                    className={`p-3 rounded-lg border-2 text-sm font-medium transition-all ${
                      deliveryOption === 'delivery'
                        ? 'border-orange-500 bg-orange-50 text-orange-700'
                        : 'border-gray-200 hover:border-gray-300 text-gray-700'
                    }`}
                  >
                    <div className="font-semibold">Delivery</div>
                    <div className="text-xs mt-1">
                      {ecommerceSettings.freeDeliveryThreshold && subtotal >= ecommerceSettings.freeDeliveryThreshold
                        ? 'Free'
                        : ecommerceSettings.shiplogicEnabled
                          ? 'Calculated at checkout'
                          : `+R${ecommerceSettings.defaultDeliveryFee.toFixed(2)}`
                      }
                    </div>
                  </button>
                )}
              </div>
              {ecommerceSettings.freeDeliveryThreshold && subtotal < ecommerceSettings.freeDeliveryThreshold && ecommerceSettings.enableDelivery && (
                <p className="text-xs text-gray-500 mt-2">
                  Free delivery on orders over R{ecommerceSettings.freeDeliveryThreshold.toFixed(2)}
                </p>
              )}
            </div>
          )}

          {/* Delivery Address (only show if delivery selected) */}
          {deliveryOption === 'delivery' && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Delivery Address</label>
              <Input
                type="text"
                placeholder="Street address"
                value={customerInfo.street}
                onChange={(e) => setCustomerInfo({ ...customerInfo, street: e.target.value })}
                className="w-full"
                required
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="text"
                  placeholder="Suburb"
                  value={customerInfo.suburb}
                  onChange={(e) => setCustomerInfo({ ...customerInfo, suburb: e.target.value })}
                />
                <Input
                  type="text"
                  placeholder="City"
                  value={customerInfo.city}
                  onChange={(e) => setCustomerInfo({ ...customerInfo, city: e.target.value })}
                />
              </div>
              <div className="flex gap-2 items-center">
                <Input
                  type="text"
                  placeholder="Postal code"
                  value={customerInfo.postalCode}
                  onChange={(e) => setCustomerInfo({ ...customerInfo, postalCode: e.target.value })}
                  className="w-1/2"
                />
                {ecommerceSettings.shiplogicEnabled && (
                  <button
                    type="button"
                    disabled={!customerInfo.street || !customerInfo.suburb || !customerInfo.city || !customerInfo.postalCode || courierLoading}
                    onClick={() => fetchCourierRate(customerInfo.street, customerInfo.suburb, customerInfo.city, customerInfo.postalCode)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {courierLoading
                      ? <><span className="animate-spin inline-block rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" /> Calculating...</>
                      : courierRate !== null
                        ? '↻ Recalculate'
                        : 'Get Delivery Rate'
                    }
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
            {error}
          </div>
        )}

        {/* Order Summary */}
        <div className="space-y-2 bg-gray-50 rounded-lg p-4">
          {cart.map((item) => (
            <div key={`${item.productId}-${item.variantId}`} className="flex justify-between text-sm">
              <span className="text-gray-700">{item.productName} × {item.quantity}</span>
              <span className="font-medium">R{(item.price * item.quantity).toFixed(2)}</span>
            </div>
          ))}
          <Separator />
          <div className="flex justify-between text-sm text-gray-500"><span>Subtotal</span><span>R{subtotal.toFixed(2)}</span></div>
          {getTaxRate(ecommerceSettings) > 0 && (
            <div className="flex justify-between text-sm text-gray-500">
              <span>{ecommerceSettings.taxIncluded ? `${getTaxLabel(ecommerceSettings)} included` : getTaxLabel(ecommerceSettings)}</span>
              <span>R{tax.toFixed(2)}</span>
            </div>
          )}
          {deliveryOption === 'delivery' && (
            <div className="space-y-1">
              <div className="flex justify-between text-sm text-gray-500">
                <span>
                  Delivery Fee
                  {courierLoading && (
                    <span className="inline-block ml-1 align-middle">
                      <span className="animate-spin inline-block rounded-full h-3 w-3 border-2 border-gray-400 border-t-transparent" />
                    </span>
                  )}
                  {!courierLoading && courierService && (
                    <span className="text-xs text-gray-400 ml-1">via {courierService}</span>
                  )}
                </span>
                {courierLoading
                  ? <span className="text-xs text-gray-400 italic">Calculating...</span>
                  : deliveryFee === null
                    ? <span className="text-xs text-gray-400 italic">{hasDeliveryAddress ? '—' : 'Enter address to calculate'}</span>
                    : <span>R{deliveryFee.toFixed(2)}</span>
                }
              </div>
              {courierError && (
                <p className="text-xs text-red-500">{courierError}</p>
              )}
            </div>
          )}
          <div className="flex justify-between font-bold text-base">
            <span>Total</span>
            <span className="text-[#cc1818]">
              {deliveryFee === null && deliveryOption === 'delivery'
                ? <span className="text-sm font-normal text-gray-400">(+ delivery TBC)</span>
                : null}
              R{total.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Payment Method Selection — hidden in walk-in mode (staff buttons shown instead) */}
        {!isWalkIn && ecommerceSettings.enableCashOnDelivery && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Payment Method</label>
            <div className="grid gap-3 grid-cols-2">
              <button
                type="button"
                onClick={() => setPaymentMethod('paylink')}
                className={`p-3 rounded-lg border-2 text-sm font-medium transition-all ${
                  paymentMethod === 'paylink'
                    ? 'border-orange-500 bg-orange-50 text-orange-700'
                    : 'border-gray-200 hover:border-gray-300 text-gray-700'
                }`}
              >
                <div className="font-semibold">Pay Online</div>
                <div className="text-xs mt-1">Card / EFT</div>
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod('cash_on_collection')}
                className={`p-3 rounded-lg border-2 text-sm font-medium transition-all ${
                  paymentMethod === 'cash_on_collection'
                    ? 'border-orange-500 bg-orange-50 text-orange-700'
                    : 'border-gray-200 hover:border-gray-300 text-gray-700'
                }`}
              >
                <div className="font-semibold">Cash on Collection</div>
                <div className="text-xs mt-1">Pay when you pick up</div>
              </button>
            </div>
          </div>
        )}

        {/* Walk-in staff payment panel — 3 buttons replace the public iKhokha redirect */}
        {isWalkIn && (
          <WalkInStaffPaymentPanel
            workspaceId={workspaceId}
            cart={cart}
            customerInfo={customerInfo}
            total={total}
            deliveryFee={deliveryFee}
            deliveryOption={deliveryOption}
            loading={loading}
            setLoading={setLoading}
            setError={setError}
            onComplete={onComplete}
          />
        )}

        {/* Payment Options — hidden in walk-in mode */}
        {!isWalkIn && <div className="space-y-3">
          {deliveryOption === 'delivery' && deliveryFee === null && (
            <p className="text-xs text-center text-amber-600 font-medium">
              {courierLoading ? '⏳ Calculating delivery rate…' : '⚠ Get your delivery rate before paying'}
            </p>
          )}
          <button
            onClick={handlePayNow}
            disabled={loading || (deliveryOption === 'delivery' && deliveryFee === null)}
            className="w-full flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-300 text-white font-semibold py-3 rounded text-sm transition-colors"
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                Processing...
              </>
            ) : (
              <>
                <CreditCard className="h-4 w-4" /> Pay Now with iKhokha
              </>
            )}
          </button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-white px-2 text-gray-500">or contact us</span>
            </div>
          </div>

          <button
            onClick={() => setShowContactOptions(!showContactOptions)}
            className="w-full text-sm text-gray-600 hover:text-gray-800 font-medium"
          >
            {showContactOptions ? 'Hide' : 'Show'} contact options
          </button>

          {showContactOptions && (
            <div className="grid grid-cols-2 gap-3">
              <a
                href={`https://wa.me/27746511031?text=${encodeURIComponent(
                  "Hi, I'd like to order:\n" +
                  cart.map((i) => `• ${i.productName} × ${i.quantity} (R${(i.price * i.quantity).toFixed(2)})`).join("\n") +
                  `\n\nTotal: R${total.toFixed(2)}`
                )}`}
                target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white font-semibold py-2.5 rounded text-sm transition-colors"
              >
                <MessageCircle className="h-4 w-4" /> WhatsApp
              </a>
              <a href="tel:0746511031"
                className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded text-sm transition-colors">
                <Phone className="h-4 w-4" /> Call Us
              </a>
            </div>
          )}
        </div>}

        <button onClick={onComplete} className="w-full text-xs text-gray-400 hover:text-gray-600 underline">
          {isWalkIn ? "Cancel walk-in sale" : "Clear cart and close"}
        </button>
      </div>
    </div>
  );
}

// ── CategoryPills ─────────────────────────────────────────────────────────
// Horizontally scrollable chip row with bigger touch targets, mouse-wheel
// horizontal scroll, and ◂ / ▸ buttons that appear when the row overflows.
function CategoryPills({ categories, selected, onSelect }: {
  categories: Array<{ id: string; name: string; productCount?: number }>;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollButtons = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

  useEffect(() => {
    updateScrollButtons();
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => updateScrollButtons();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [categories.length]);

  const scrollBy = (delta: number) => {
    scrollRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  };

  // Translate vertical wheel scrolls into horizontal scrolls so non-Mac users
  // (and anyone with a regular mouse wheel) can browse the row easily.
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  };

  return (
    <div className="bg-gray-50 border-b border-gray-200 relative">
      <div className="max-w-7xl mx-auto px-2 sm:px-4 py-3 relative">
        {canScrollLeft && (
          <button
            type="button"
            aria-label="Scroll categories left"
            onClick={() => scrollBy(-240)}
            className="absolute left-1 sm:left-2 top-1/2 -translate-y-1/2 z-10 h-9 w-9 rounded-full bg-white shadow-md border border-gray-200 flex items-center justify-center text-gray-600 hover:text-orange-500 hover:border-orange-300"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        {canScrollRight && (
          <button
            type="button"
            aria-label="Scroll categories right"
            onClick={() => scrollBy(240)}
            className="absolute right-1 sm:right-2 top-1/2 -translate-y-1/2 z-10 h-9 w-9 rounded-full bg-white shadow-md border border-gray-200 flex items-center justify-center text-gray-600 hover:text-orange-500 hover:border-orange-300"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
        <div
          ref={scrollRef}
          onWheel={handleWheel}
          className="flex items-center gap-2 overflow-x-auto scrollbar-none scroll-smooth"
          style={{
            scrollSnapType: "x proximity",
            paddingLeft: canScrollLeft ? "2.75rem" : 0,
            paddingRight: canScrollRight ? "2.75rem" : 0,
            transition: "padding 200ms",
          }}
        >
          <button
            onClick={() => onSelect("all")}
            className={`shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-colors border whitespace-nowrap ${
              selected === "all"
                ? "bg-orange-500 text-white border-orange-500"
                : "bg-white text-gray-700 border-gray-200 hover:border-orange-300 hover:text-orange-500"
            }`}
            style={{ scrollSnapAlign: "start" }}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => onSelect(cat.id)}
              className={`shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-colors border whitespace-nowrap ${
                selected === cat.id
                  ? "bg-orange-500 text-white border-orange-500"
                  : "bg-white text-gray-700 border-gray-200 hover:border-orange-300 hover:text-orange-500"
              }`}
              style={{ scrollSnapAlign: "start" }}
            >
              {cat.name}
              {typeof cat.productCount === "number" && (
                <span className="ml-1.5 text-xs opacity-70">({cat.productCount})</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
