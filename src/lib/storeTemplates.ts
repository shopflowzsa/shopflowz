// Store design templates. Each business picks one in Ecommerce Settings → Design.
// The cart / checkout / product-detail engine is shared — templates only change
// the *visual layer*: header style, hero, product-card style, accent, layout.

export type StoreTemplateKey = "classic" | "showcase" | "boutique" | "bold" | "catalog";

export interface StoreTemplate {
  key: StoreTemplateKey;
  name: string;
  description: string;
  hero: boolean;                       // show the big hero slider at the top
  carousel: boolean;                   // show the "Latest" mini carousel
  header: "dark" | "light" | "bold";   // header treatment
  card: "flip" | "flat" | "boutique" | "bold" | "compact";
  font: "sans" | "serif";
  accent: string;                      // default accent colour (overridable per store)
  gridCols: string;                    // tailwind grid column classes
}

export const STORE_TEMPLATES: StoreTemplate[] = [
  {
    key: "classic",
    name: "Classic Grid",
    description: "The straightforward shop — dark header, flip-to-reveal product cards, latest carousel. Great all-rounder.",
    hero: false, carousel: true, header: "dark", card: "flip", font: "sans",
    accent: "#ea580c", gridCols: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5",
  },
  {
    key: "showcase",
    name: "Showcase",
    description: "A landing-page feel — full-width image slider you control, clean light header, big bold product cards.",
    hero: true, carousel: false, header: "light", card: "flat", font: "sans",
    accent: "#0ea5e9", gridCols: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  },
  {
    key: "boutique",
    name: "Boutique",
    description: "Elegant and minimal — serif headings, soft whitespace, refined cards. For a premium, curated look.",
    hero: true, carousel: false, header: "light", card: "boutique", font: "serif",
    accent: "#9333ea", gridCols: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
  },
  {
    key: "bold",
    name: "Bold",
    description: "High-impact dark theme — vibrant accents, large type, punchy hero. Stands out and grabs attention.",
    hero: true, carousel: false, header: "bold", card: "bold", font: "sans",
    accent: "#f59e0b", gridCols: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
  },
  {
    key: "catalog",
    name: "Catalog",
    description: "Dense and efficient — clean white, compact cards, search-first. Best for large ranges and parts shops.",
    hero: false, carousel: false, header: "light", card: "compact", font: "sans",
    accent: "#111827", gridCols: "grid-cols-2 sm:grid-cols-4 lg:grid-cols-6",
  },
];

export function getStoreTemplate(key?: string): StoreTemplate {
  return STORE_TEMPLATES.find((t) => t.key === key) ?? STORE_TEMPLATES[0];
}
