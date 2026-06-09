/**
 * LazyImage — only starts loading when the element enters the viewport.
 * Uses IntersectionObserver with a 200px root margin so images pre-load
 * just before they become visible, making scrolling feel seamless.
 */
import { useRef, useState, useEffect, memo } from "react";
import { cn } from "@/lib/utils";

interface LazyImageProps {
  src: string;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  objectFit?: "cover" | "contain" | "fill";
}

export const LazyImage = memo(function LazyImage({
  src, alt = "", className, style, objectFit = "cover",
}: LazyImageProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Pre-load 300px before the element enters the viewport so the image is
    // ready by the time the user scrolls to it.
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={cn("relative overflow-hidden bg-muted", className)} style={style}>
      {/* Skeleton pulse until image loads */}
      {(!inView || !loaded) && (
        <div className="absolute inset-0 bg-gradient-to-r from-muted via-muted-foreground/10 to-muted animate-pulse" />
      )}
      {inView && (
        <img
          src={src}
          alt={alt}
          decoding="async"
          onLoad={() => setLoaded(true)}
          className={cn(
            "w-full h-full transition-opacity duration-200",
            objectFit === "cover" ? "object-cover" : objectFit === "contain" ? "object-contain" : "object-fill",
            loaded ? "opacity-100" : "opacity-0"
          )}
        />
      )}
    </div>
  );
});
