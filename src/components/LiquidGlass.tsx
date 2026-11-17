import { memo, useEffect, useId, useRef, useState, type ComponentPropsWithRef, type ElementType, type ReactNode } from "react";
import { cn } from "../lib/utils";

export interface LiquidGlassProps<T extends ElementType = "div"> {
  as?: T;
  children?: ReactNode;
  className?: string;
  contentClassName?: string;
  radius?: number;
  bevelDepth?: number;
  scale?: number;
  aberration?: number;
  frost?: number;
  /** @deprecated – no longer used; LiquidGlass never overrides the element's own background */
  tint?: number;
  style?: React.CSSProperties;
}

/** Global cache for displacement map blob URLs so identical button shapes compute only once. */
const displacementBlobCache = new Map<string, Promise<string>>();

function getCachedDisplacementBlobUrl(opts: DisplacementOptions): Promise<string> {
  const key = `${Math.round(opts.width)}x${Math.round(opts.height)}-r${Math.round(opts.radius)}-b${Math.round(opts.bevelDepth)}-dpr${opts.dpr || 1}`;
  let p = displacementBlobCache.get(key);
  if (!p) {
    p = generateDisplacementBlobUrl(opts);
    displacementBlobCache.set(key, p);
  }
  return p;
}

/**
 * Liquid glass surface — purely additive glass-refraction layer.
 *
 * This component ONLY contributes the displacement-map backdrop-filter
 * (the Snell's-law optical bend) and the hidden SVG filter element.
 * It does NOT touch background-color, border, padding, border-radius or any
 * other visual property — those all come from the caller's CSS class.
 *
 * That means you can wrap any existing button/div and it just gets optical
 * refraction on top of its normal look, without any visual clash.
 *
 * Mode fallbacks:
 *   pending → Chromium desktop path: full displacement map refraction
 *   simple  → Safari / Firefox / Mobile / Touch: native hardware-accelerated CSS backdrop blur
 *   opaque  → prefers-reduced-transparency: no filter at all
 */
function LiquidGlassBase<T extends ElementType = "div">({
  as,
  children,
  className,
  contentClassName,
  radius,          // used only for the displacement-map shape; NOT applied as border-radius
  bevelDepth = 14,
  scale = 48,
  aberration = 4,
  frost = 0.4,
  tint: _tint,     // ignored – left here so callers don't get a type error
  style,
  ...rest
}: LiquidGlassProps<T> & Omit<ComponentPropsWithRef<T>, keyof LiquidGlassProps<T>>) {
  const Component = as || "div";
  const reactId = useId().replace(/:/g, "");
  const rootRef = useRef<HTMLElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [filter, setFilter] = useState<{ id: string; svg: string } | null>(null);
  const [mode, setMode] = useState<"pending" | "simple" | "opaque">("pending");

  useEffect(() => {
    if (prefersReducedTransparency()) {
      setMode("opaque");
    } else if (isSafariLike() || isMobileOrTouch() || !supportsUrlBackdropFilter()) {
      setMode("simple");
    }
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || mode !== "pending") return;
    if (typeof ResizeObserver === "undefined") {
      setMode("simple");
      return;
    }
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const box = entry.borderBoxSize?.[0];
      const width = box?.inlineSize ?? entry.contentRect.width;
      const height = box?.blockSize ?? entry.contentRect.height;
      const w = Math.max(1, Math.round(width));
      const h = Math.max(1, Math.round(height));
      setSize(prev => (prev.w === w && prev.h === h ? prev : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode]);

  useEffect(() => {
    if (mode !== "pending" || size.w <= 1 || size.h <= 1) return;
    let cancelled = false;

    // The displacement map radius mirrors the element's actual corner radius
    // read from computed styles so the glass bevel tracks the CSS border-radius.
    const resolvedRadius = (() => {
      if (radius != null) return radius;
      const el = rootRef.current;
      if (!el) return 999;
      const r = parseFloat(getComputedStyle(el).borderRadius) || 0;
      return r;
    })();

    (async () => {
      try {
        const mapUrl = await getCachedDisplacementBlobUrl({
          width: size.w,
          height: size.h,
          radius: Math.min(resolvedRadius, size.w / 2, size.h / 2),
          bevelDepth: Math.min(bevelDepth, Math.min(size.w, size.h) / 2),
          dpr: Math.min(window.devicePixelRatio || 1, 1.5),
        });
        if (cancelled) return;

        const id = `lg-${reactId}-${size.w}x${size.h}`;
        setFilter({
          id,
          svg: buildFilterSvg({ id, mapUrl, width: size.w, height: size.h, scale, aberration, frost }),
        });
      } catch {
        setMode("simple");
      }
    })();

    return () => { cancelled = true; };
  }, [mode, size.w, size.h, radius, bevelDepth, scale, aberration, frost, reactId]);

  // ── backdrop-filter value ────────────────────────────────────────────────
  // "pending" → waiting for the displacement map; apply NO filter yet.
  //             Once the map is ready we switch straight to the full filter.
  // "simple"  → browser can't do url() backdrop-filter (or mobile/Safari); skip entirely so the
  //             button's own CSS backdrop-filter (blur-glass) handles it with 120 FPS GPU acceleration.
  // "opaque"  → reduced-transparency preference; no filter.
  const backdrop =
    mode === "opaque" || mode === "simple"
      ? undefined          // let the button's own CSS backdrop-filter handle it
      : filter
        ? `url(#${filter.id}) blur(0.5px) saturate(1.85) brightness(1.02)`
        : undefined;       // show nothing while map loads — avoids the grey flash

  const isButton = Component === "button";
  const buttonType = isButton ? ((rest as any).type || "button") : undefined;

  return (
    <Component
      ref={rootRef as any}
      type={buttonType}
      data-lg-mode={mode}
      className={cn("lg-host", className)}
      style={{
        backdropFilter: backdrop,
        WebkitBackdropFilter: backdrop,
        ...style,
      }}
      {...(rest as any)}>
      {/* Hidden SVG that defines the displacement-map filter. */}
      {filter ? (
        <span
          key={filter.id}
          aria-hidden="true"
          className="lg-filter-node pointer-events-none absolute size-0 overflow-hidden"
          dangerouslySetInnerHTML={{ __html: filter.svg }} />
      ) : null}
      {/* Rim-highlight overlay — a subtle inset shine drawn with a pseudo-
          element via .lg-host::after in CSS; no inline style needed here. */}
      {contentClassName ? (
        <div className={contentClassName}>{children}</div>
      ) : (
        children
      )}
    </Component>
  );
}

export const LiquidGlass = memo(LiquidGlassBase) as typeof LiquidGlassBase;

function supportsUrlBackdropFilter(): boolean {
  if (typeof CSS === "undefined" || !CSS.supports) return false;
  return (
    CSS.supports("backdrop-filter", "url(#x)") ||
    CSS.supports("-webkit-backdrop-filter", "url(#x)")
  );
}

function prefersReducedTransparency(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-transparency: reduce)").matches;
}

function isSafariLike(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR/.test(ua);
}

function isMobileOrTouch(): boolean {
  if (typeof window === "undefined") return false;
  const isCoarse = window.matchMedia && window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  const isSmallScreen = window.innerWidth <= 768;
  return !!(isCoarse || isSmallScreen);
}

/** Signed distance to a rounded box centred at the origin. <0 inside. */
function sdRoundedBox(
  px: number,
  py: number,
  halfW: number,
  halfH: number,
  r: number
): number {
  const qx = Math.abs(px) - halfW + r;
  const qy = Math.abs(py) - halfH + r;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return inside + outside - r;
}

/** Squircle-dome slope → Snell's-law bend. `x` = 0 at the rim, 1 at centre. */
function bendFromDepth(x: number): number {
  const u = 1 - Math.min(1, Math.max(0, x));
  const denom = (1 - u ** 4) ** 0.75;
  if (denom < 1e-6) return 0;
  const thetaI = Math.atan(Math.min(u ** 3 / denom, 8));
  const sinT = Math.sin(thetaI) / 1.5;
  if (sinT >= 1) return Math.sin(thetaI);
  return Math.sin(thetaI - Math.asin(sinT));
}

/** φ(d) = ∫ bend along the distance from the rim. */
function buildPhiTable(bevelPx: number): Float32Array {
  const n = Math.max(1, Math.ceil(bevelPx));
  const phi = new Float32Array(n + 1);
  for (let d = 1; d <= n; d++) phi[d] = phi[d - 1] + bendFromDepth(d / n);
  return phi;
}

function samplePhi(phi: Float32Array, depth: number): number {
  const max = phi.length - 1;
  if (depth <= 0) return phi[0];
  if (depth >= max) return phi[max];
  const i = Math.floor(depth);
  const f = depth - i;
  return phi[i] * (1 - f) + phi[i + 1] * f;
}

interface DisplacementOptions {
  width: number;
  height: number;
  radius: number;
  bevelDepth: number;
  dpr?: number;
  gain?: number;
  light?: { x: number; y: number };
}

function computeDisplacementData(opts: DisplacementOptions) {
  const dpr = opts.dpr ?? 1;
  const gain = opts.gain ?? 1.35;
  const light = opts.light ?? { x: -0.55, y: -0.85 };
  const lightLen = Math.hypot(light.x, light.y) || 1;
  const lx = light.x / lightLen;
  const ly = light.y / lightLen;

  const W = Math.max(1, Math.round(opts.width * dpr));
  const H = Math.max(1, Math.round(opts.height * dpr));
  const halfW = W / 2;
  const halfH = H / 2;
  const r = Math.min(opts.radius * dpr, halfW, halfH);
  const bevel = Math.max(1, opts.bevelDepth * dpr);
  const phi = buildPhiTable(bevel);

  // Height field over the shape, then displace along its gradient.
  const field = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const py = y - halfH + 0.5;
    for (let x = 0; x < W; x++) {
      const d = sdRoundedBox(x - halfW + 0.5, py, halfW, halfH, r);
      field[y * W + x] = d > 0 ? 0 : samplePhi(phi, Math.min(bevel, -d));
    }
  }

  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const py = y - halfH + 0.5;
    for (let x = 0; x < W; x++) {
      const px = x - halfW + 0.5;
      const i = (y * W + x) << 2;
      const d = sdRoundedBox(px, py, halfW, halfH, r);

      if (d > 0) {
        data[i] = data[i + 1] = data[i + 2] = 128;
        data[i + 3] = 0;
        continue;
      }

      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(W - 1, x + 1);
      const y0 = Math.max(0, y - 1);
      const y1 = Math.min(H - 1, y + 1);
      const dPhiX = (field[y * W + x1] - field[y * W + x0]) / (x1 - x0 || 1);
      const dPhiY = (field[y1 * W + x] - field[y0 * W + x]) / (y1 - y0 || 1);

      // Cap so the rim compresses but never folds over itself.
      const dx = Math.max(-1, Math.min(1, dPhiX * gain));
      const dy = Math.max(-1, Math.min(1, dPhiY * gain));

      let specular = 0;
      if (d >= -bevel) {
        const gx =
          sdRoundedBox(px + 1, py, halfW, halfH, r) -
          sdRoundedBox(px - 1, py, halfW, halfH, r);
        const gy =
          sdRoundedBox(px, py + 1, halfW, halfH, r) -
          sdRoundedBox(px, py - 1, halfW, halfH, r);
        const len = Math.hypot(gx, gy) || 1;
        const dot = (gx / len) * lx + (gy / len) * ly;
        const rim = 1 - Math.min(1, -d / bevel);
        specular = (Math.max(0, dot) + Math.max(0, -dot) * 0.35) * rim;
      }

      data[i] = 128 + dx * 127;
      data[i + 1] = 128 + dy * 127;
      data[i + 2] = Math.round(specular * 255);
      data[i + 3] = 255;
    }
  }

  return { data, width: W, height: H };
}

/** PNG blob URL for feImage (WebKit rejects data: URIs inside feImage). */
async function generateDisplacementBlobUrl(opts: DisplacementOptions): Promise<string> {
  const { data, width, height } = computeDisplacementData(opts);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  ctx.putImageData(new ImageData(data, width, height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png")
  );
  if (!blob) throw new Error("Failed to encode displacement map");
  return URL.createObjectURL(blob);
}

interface FilterSvgOptions {
  id: string;
  mapUrl: string;
  width: number;
  height: number;
  scale: number;
  aberration: number;
  frost: number;
}

function buildFilterSvg({
  id,
  mapUrl,
  width,
  height,
  scale,
  aberration,
  frost,
}: FilterSvgOptions): string {
  const pad = Math.ceil(scale + aberration + 4);
  const px = (pad / Math.max(1, width)) * 100;
  const py = (pad / Math.max(1, height)) * 100;
  const region = `x="-${px.toFixed(3)}%" y="-${py.toFixed(3)}%" width="${(100 + 2 * px).toFixed(3)}%" height="${(100 + 2 * py).toFixed(3)}%"`;

  // Pixel-sized map matched to the lens; % units wash out the rim bend.
  const map = `<feImage href="${mapUrl}" xlink:href="${mapUrl}" x="0" y="0" width="${width}" height="${height}" result="map" preserveAspectRatio="none"/>`;
  const displace = (s: number, result: string) =>
    `<feDisplacementMap in="SourceGraphic" in2="map" scale="${s}" xChannelSelector="R" yChannelSelector="G" result="${result}"/>`;

  // One pass without aberration, so no screen-blend seams.
  const body =
    aberration <= 0
      ? `${displace(scale, "rgb")}`
      : `${displace(scale + aberration, "dispR")}
  <feColorMatrix in="dispR" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="red"/>
  ${displace(scale, "dispG")}
  <feColorMatrix in="dispG" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="green"/>
  ${displace(Math.max(0, scale - aberration), "dispB")}
  <feColorMatrix in="dispB" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="blue"/>
  <feBlend in="red" in2="green" mode="screen" result="rg"/>
  <feBlend in="rg" in2="blue" mode="screen" result="rgb"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="0" height="0" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden"><filter id="${id}" color-interpolation-filters="sRGB" ${region}>
  ${map}
  ${body}
  <feGaussianBlur in="rgb" stdDeviation="${frost}"/>
</filter></svg>`;
}
