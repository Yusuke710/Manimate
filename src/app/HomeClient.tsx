"use client";

import { useReducer, useEffect, useCallback, useRef, useState, Suspense, useMemo, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import SplitPanel from "@/components/SplitPanel";
import ChatInput from "@/components/ChatInput";
import ChatMessages from "@/components/ChatMessages";
import PreviewPanel from "@/components/PreviewPanel";
import { CloudAuthGate } from "@/components/CloudAuthGate";
import { SessionsSidebar } from "@/components/SessionsSidebar";
import { LibraryView } from "@/components/LibraryView";
import { StudioPlanPill } from "@/components/StudioStatus";
import { SSEEvent, ActivityEvent, Message, DBActivityEvent, ActiveRun, dbActivityEventToUI, ImageAttachment } from "@/lib/types";
import { useBrowserPreviewBadge } from "@/lib/useBrowserPreviewBadge";
import { useIsMobile } from "@/lib/useIsMobile";
import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  getModelDisplayLabel,
  isRegisteredModelId,
} from "@/lib/models";
import { AVAILABLE_VOICES, DEFAULT_VOICE_ID, NONE_VOICE_ID, getVoicePageUrl } from "@/lib/voices";
import {
  ASPECT_RATIO_OPTIONS,
  isAspectRatio,
  type AspectRatio,
} from "@/lib/aspect-ratio";
import { readUploadErrorResponse } from "@/lib/chat-upload-response";
import { parseUrlLaunchIntent } from "@/lib/url-launch-intent";
import { usePreferredAspectRatio } from "@/lib/usePreferredAspectRatio";
import {
  shouldAbortLingeringPreviewStream,
  shouldAcceptPolledPreviewUpdate,
  shouldShowBrowserPreviewBadge,
} from "@/lib/preview-load";
import {
  ALL_BRAND_KIT_FONT_NAMES,
  BRAND_KIT_FONT_OPTIONS,
  isSupportedBrandKitImageType,
  SUPPORTED_BRAND_KIT_IMAGE_TYPES,
  type BrandKitAnalysisResult,
} from "@/lib/brand-kit-analysis";
import type { CloudAuthStatus } from "@/lib/studio-cloud-auth";
import { useStudioCloudAuth } from "@/lib/useStudioCloudAuth";

const MODEL_PREF_KEY = "manimate-preferred-model";
const VOICE_PREF_KEY = "manimate-preferred-voice";
const VOICE_NAMES_KEY = "manimate-voice-names";
const ELEVENLABS_SETTINGS_ENDPOINT = "/api/settings/elevenlabs";

function usePreferredModel() {
  const [model, setModel] = useState(DEFAULT_MODEL);

  useEffect(() => {
    let timer: number | null = null;
    try {
      const saved = localStorage.getItem(MODEL_PREF_KEY);
      if (saved && isRegisteredModelId(saved)) {
        timer = window.setTimeout(() => setModel(saved), 0);
      }
    } catch {}
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  const set = useCallback((m: string) => {
    setModel(m);
    try { localStorage.setItem(MODEL_PREF_KEY, m); } catch {}
  }, []);
  return [model, set] as const;
}

// Manus-style model selector dropdown
function ModelSelector({ model, onChange, disabled }: { model: string; onChange: (model: string) => void; disabled?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button
        onClick={() => { if (!disabled && AVAILABLE_MODELS.length > 1) setIsOpen(!isOpen); }}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          background: "var(--bg-white)", border: "1px solid var(--border-main)",
          borderRadius: 20,
          padding: "4px 10px 4px 10px",
          cursor: disabled || AVAILABLE_MODELS.length <= 1 ? "default" : "pointer",
          fontFamily: "var(--font)",
          transition: "border-color 0.12s",
        }}
      >
        {/* CPU/Chip icon */}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
        </svg>
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>
          {getModelDisplayLabel(model)}
        </span>
        {AVAILABLE_MODELS.length > 1 && (
          <svg width="11" height="11" viewBox="0 0 20 20" fill="var(--text-tertiary)" style={{ transition: "transform 0.15s", transform: isOpen ? "rotate(180deg)" : "none" }}>
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
          </svg>
        )}
      </button>
      {isOpen && (
        <div style={{
          position: "absolute", top: "100%", left: 0,
          marginTop: 4,
          background: "var(--bg-white)",
          border: "1px solid var(--border-main)",
          borderRadius: 10,
          boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          zIndex: 50, overflow: "hidden",
          minWidth: 180,
        }}>
          {AVAILABLE_MODELS.map((m) => (
            <button
              key={m.id}
              onClick={() => { onChange(m.id); setIsOpen(false); }}
              style={{
                display: "flex", flexDirection: "column", gap: 1,
                width: "100%", padding: "8px 14px",
                border: "none",
                background: m.id === model ? "var(--bg-active)" : "transparent",
                cursor: "pointer",
                fontFamily: "var(--font)",
                transition: "background 0.12s",
                textAlign: "left",
              }}
              onMouseEnter={(e) => { if (m.id !== model) e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { if (m.id !== model) e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ fontSize: 13, fontWeight: m.id === model ? 600 : 400, color: m.id === model ? "var(--text-primary)" : "var(--text-secondary)" }}>
                {m.label}
              </span>
              <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                {m.description}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Aspect ratio icon: renders a rectangle/square outline proportional to the ratio
function AspectRatioIcon({ ratio, size = 14, color = "currentColor" }: { ratio: AspectRatio; size?: number; color?: string }) {
  // Compute rect dimensions proportional to the ratio, fitting within `size`
  let w: number, h: number;
  if (ratio === "9:16") { h = size; w = Math.round(size * 9 / 16); }
  else if (ratio === "1:1") { w = size; h = size; }
  else { w = size; h = Math.round(size * 9 / 16); } // 16:9 default
  const x = (size - w) / 2;
  const y = (size - h) / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none">
      <rect x={x} y={y} width={w} height={h} rx={1.5} stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

// Aspect ratio selector dropdown (Manus-style, parallels ModelSelector)
function AspectRatioSelector({ ratio, onChange, disabled }: { ratio: AspectRatio; onChange: (ratio: AspectRatio) => void; disabled?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button
        onClick={() => { if (!disabled) setIsOpen(!isOpen); }}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          background: "var(--bg-white)", border: "1px solid var(--border-main)",
          borderRadius: 20,
          padding: "4px 10px",
          cursor: disabled ? "default" : "pointer",
          fontFamily: "var(--font)",
          transition: "border-color 0.12s",
        }}
      >
        <AspectRatioIcon ratio={ratio} size={14} color="var(--text-tertiary)" />
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>
          {ASPECT_RATIO_OPTIONS.find((o) => o.id === ratio)?.label ?? ratio}
        </span>
        <svg width="11" height="11" viewBox="0 0 20 20" fill="var(--text-tertiary)" style={{ transition: "transform 0.15s", transform: isOpen ? "rotate(180deg)" : "none" }}>
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      {isOpen && (
        <div style={{
          position: "absolute", top: "100%", left: 0,
          marginTop: 4,
          background: "var(--bg-white)",
          border: "1px solid var(--border-main)",
          borderRadius: 10,
          boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          zIndex: 50, overflow: "hidden",
          minWidth: 120,
        }}>
          {ASPECT_RATIO_OPTIONS.map((r) => (
            <button
              key={r.id}
              onClick={() => { onChange(r.id); setIsOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "8px 14px",
                border: "none",
                background: r.id === ratio ? "var(--bg-active)" : "transparent",
                fontSize: 13, fontWeight: r.id === ratio ? 600 : 400,
                color: r.id === ratio ? "var(--text-primary)" : "var(--text-secondary)",
                cursor: "pointer",
                fontFamily: "var(--font)",
                transition: "background 0.12s",
              }}
              onMouseEnter={(e) => { if (r.id !== ratio) e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { if (r.id !== ratio) e.currentTarget.style.background = "transparent"; }}
            >
              <AspectRatioIcon ratio={r.id} size={16} color={r.id === ratio ? "var(--text-primary)" : "var(--text-secondary)"} />
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Brand Kit ───────────────────────────────────────────────────────────────

interface BrandLogo { name: string; dataUrl: string }
interface BrandKit {
  logos: { primary: BrandLogo | null };
  colors: { primary: string[]; accent: string[]; background: string[] };
  fonts: { heading: string; body: string; accent: string };
  voice: string;
  styleNotes: string;
  styleTags: string[];
}

const BRAND_KIT_KEY = "manimate:brand-kit-v3";
const STYLE_TAG_OPTIONS = ["Minimal", "Bold", "Clean", "Playful", "Elegant", "Technical", "Dark", "Vibrant", "Flat", "3D", "Retro", "Modern"];

function emptyBrandKit(): BrandKit {
  return {
    logos: { primary: null },
    colors: { primary: [], accent: [], background: [] },
    fonts: { heading: "", body: "", accent: "" },
    voice: "", styleNotes: "", styleTags: [],
  };
}

function deepCloneBrandKit(k: BrandKit): BrandKit {
  const c = k.colors ?? { primary: [], accent: [], background: [] };
  return {
    logos: { ...k.logos },
    colors: { primary: [...(c.primary ?? [])], accent: [...(c.accent ?? [])], background: [...(c.background ?? [])] },
    fonts: { ...k.fonts },
    voice: k.voice ?? "", styleNotes: k.styleNotes ?? "", styleTags: [...(k.styleTags ?? [])],
  };
}

function useBrandKit(): [BrandKit | null, (kit: BrandKit | null) => void, boolean, (enabled: boolean) => void] {
  const [kit, setKit] = useState<BrandKit | null>(null);
  const [enabled, setEnabledState] = useState(true);
  useEffect(() => {
    try {
      const s = localStorage.getItem(BRAND_KIT_KEY);
      if (s) {
        const parsed = JSON.parse(s);
        // Support old format (plain BrandKit) and new format ({ kit, enabled })
        if (parsed && "kit" in parsed) {
          setKit(parsed.kit);
          setEnabledState(parsed.enabled ?? true);
        } else {
          setKit(parsed);
        }
      }
    } catch {}
  }, []);
  const save = useCallback((newKit: BrandKit | null) => {
    setKit(newKit);
    try {
      if (newKit) localStorage.setItem(BRAND_KIT_KEY, JSON.stringify({ kit: newKit, enabled: true }));
      else localStorage.removeItem(BRAND_KIT_KEY);
    } catch {}
    setEnabledState(true);
  }, []);
  const setEnabled = useCallback((val: boolean) => {
    setEnabledState(val);
    try {
      const s = localStorage.getItem(BRAND_KIT_KEY);
      if (s) {
        const parsed = JSON.parse(s);
        const kitData = parsed && "kit" in parsed ? parsed.kit : parsed;
        localStorage.setItem(BRAND_KIT_KEY, JSON.stringify({ kit: kitData, enabled: val }));
      }
    } catch {}
  }, []);
  return [kit, save, enabled, setEnabled];
}

function buildBrandGuideline(kit: BrandKit | null): string {
  if (!kit) return "";
  const parts: string[] = [];
  const logoParts: string[] = [];
  if (kit.logos.primary) logoParts.push(`primary logo "${kit.logos.primary.name}"`);
  if (logoParts.length > 0) parts.push(`Logo — ${logoParts.join(", ")} provided`);
  const colorParts: string[] = [];
  if (kit.colors.primary.length > 0) colorParts.push(`primary: ${kit.colors.primary.join(", ")}`);
  if (kit.colors.accent.length > 0) colorParts.push(`accent: ${kit.colors.accent.join(", ")}`);
  if (kit.colors.background.length > 0) colorParts.push(`background: ${kit.colors.background.join(", ")}`);
  if (colorParts.length > 0) parts.push(`Brand colors — ${colorParts.join("; ")}`);
  const fontParts: string[] = [];
  if (kit.fonts.heading) fontParts.push(`heading: ${kit.fonts.heading}`);
  if (kit.fonts.body) fontParts.push(`body: ${kit.fonts.body}`);
  if (kit.fonts.accent) fontParts.push(`accent: ${kit.fonts.accent}`);
  if (fontParts.length > 0) parts.push(`Fonts — ${fontParts.join(", ")}`);
  const styleAll = [...(kit.styleTags ?? []), (kit.styleNotes ?? "").trim()].filter(Boolean);
  if (styleAll.length > 0) parts.push(`Visual style — ${styleAll.join(", ")}`);
  if ((kit.voice ?? "").trim()) parts.push(`Brand voice — ${kit.voice.trim()}`);
  if (parts.length === 0) return "";
  return `\n\nBrand Guideline: ${parts.join(". ")}.`;
}

type BKTab = "auto" | "colors" | "fonts" | "logos" | "voice";

const FONT_OPTIONS = BRAND_KIT_FONT_OPTIONS;
const ALL_FONT_NAMES = ALL_BRAND_KIT_FONT_NAMES;

// ─── Color-space utilities ───────────────────────────────────────────────────
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  s /= 100; v /= 100;
  const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
}
function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map(x => x.toString(16).padStart(2, "0")).join("").toUpperCase();
}
function hexToHsv(hex: string): [number, number, number] {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) { switch (max) { case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break; case g: h = ((b - r) / d + 2) * 60; break; default: h = ((r - g) / d + 4) * 60; } }
  return [h, max ? d / max * 100 : 0, max * 100];
}

// ─── Canvas-based dominant color extraction ───────────────────────────────────
function extractDominantColors(dataUrl: string, count = 3): Promise<string[]> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const SIZE = 80; // downsample to 80×80 for speed
      const canvas = document.createElement("canvas");
      canvas.width = SIZE; canvas.height = SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve([]); return; }
      ctx.drawImage(img, 0, 0, SIZE, SIZE);
      const { data } = ctx.getImageData(0, 0, SIZE, SIZE);

      // Collect non-transparent, non-near-white, non-near-black pixels
      const pixels: [number, number, number][] = [];
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b, a] = [data[i], data[i+1], data[i+2], data[i+3]];
        if (a < 128) continue; // transparent
        const brightness = (r + g + b) / 3;
        if (brightness > 240) continue; // near-white
        if (brightness < 15) continue; // near-black
        pixels.push([r, g, b]);
      }
      if (pixels.length === 0) { resolve([]); return; }

      // Simple k-means with k=count, 10 iterations
      let centers: [number, number, number][] = [];
      for (let k = 0; k < count; k++) {
        centers.push(pixels[Math.floor(pixels.length * k / count)]);
      }
      for (let iter = 0; iter < 10; iter++) {
        const sums: [number, number, number, number][] = Array.from({ length: count }, () => [0, 0, 0, 0]);
        for (const [r, g, b] of pixels) {
          let best = 0, bestDist = Infinity;
          for (let k = 0; k < count; k++) {
            const dr = r - centers[k][0], dg = g - centers[k][1], db = b - centers[k][2];
            const d = dr*dr + dg*dg + db*db;
            if (d < bestDist) { bestDist = d; best = k; }
          }
          sums[best][0] += r; sums[best][1] += g; sums[best][2] += b; sums[best][3]++;
        }
        for (let k = 0; k < count; k++) {
          if (sums[k][3] > 0) centers[k] = [sums[k][0]/sums[k][3], sums[k][1]/sums[k][3], sums[k][2]/sums[k][3]];
        }
      }
      resolve(centers.map(([r, g, b]) => rgbToHex(Math.round(r), Math.round(g), Math.round(b))));
    };
    img.onerror = () => resolve([]);
    img.src = dataUrl;
  });
}

// ─── Canva-style inline color picker ─────────────────────────────────────────
function BrandColorPicker({ hex, onChange, onDelete, onClose }: {
  hex: string; onChange: (h: string) => void; onDelete: () => void; onClose: () => void;
}) {
  const init = /^#[0-9A-Fa-f]{6}$/i.test(hex) ? hex.toUpperCase() : "#3B82F6";
  const hsvRef = useRef<[number, number, number]>(hexToHsv(init));
  const [hsv, setHsvState] = useState<[number, number, number]>(hsvRef.current);
  const [hexText, setHexText] = useState(init.replace("#", ""));
  const gradRef = useRef<HTMLDivElement>(null);
  const hueRef  = useRef<HTMLDivElement>(null);
  const hexInputRef = useRef<HTMLInputElement>(null);

  const setHsv = (next: [number, number, number]) => { hsvRef.current = next; setHsvState(next); };

  const emitHsv = (h: number, s: number, v: number) => {
    const [r, g, b] = hsvToRgb(h, s, v);
    const newHex = rgbToHex(r, g, b);
    setHexText(newHex.replace("#", ""));
    onChange(newHex);
  };

  const makeDrag = (onMove: (cx: number, cy: number) => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    onMove(e.clientX, e.clientY);
    const mm = (ev: MouseEvent) => onMove(ev.clientX, ev.clientY);
    const mu = () => { document.removeEventListener("mousemove", mm); document.removeEventListener("mouseup", mu); };
    document.addEventListener("mousemove", mm);
    document.addEventListener("mouseup", mu);
  };

  const onGradDrag = makeDrag((cx, cy) => {
    if (!gradRef.current) return;
    const r = gradRef.current.getBoundingClientRect();
    const s = Math.max(0, Math.min(100, (cx - r.left) / r.width  * 100));
    const v = Math.max(0, Math.min(100, 100 - (cy - r.top) / r.height * 100));
    const next: [number, number, number] = [hsvRef.current[0], s, v];
    setHsv(next); emitHsv(...next);
  });

  const onHueDrag = makeDrag((cx) => {
    if (!hueRef.current) return;
    const r = hueRef.current.getBoundingClientRect();
    const h = Math.max(0, Math.min(360, (cx - r.left) / r.width * 360));
    const next: [number, number, number] = [h, hsvRef.current[1], hsvRef.current[2]];
    setHsv(next); emitHsv(...next);
  });

  const [h, s, v] = hsv;
  const pureHue = `hsl(${h},100%,50%)`;

  return (
    <div style={{ marginTop: 14, borderRadius: 12, border: "1px solid var(--border-main)", background: "var(--bg-white)", padding: 16, boxShadow: "0 4px 20px rgba(0,0,0,0.10)" }}>
      {/* Close button */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <button onClick={onClose} style={{ width: 24, height: 24, borderRadius: "50%", border: "none", background: "#f0f0f0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#666" }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>

      {/* Gradient square */}
      <div ref={gradRef} onMouseDown={onGradDrag} style={{ position: "relative", height: 156, borderRadius: 6, background: `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,${pureHue})`, cursor: "crosshair", marginBottom: 10, userSelect: "none" }}>
        <div style={{ position: "absolute", left: `${s}%`, top: `${100 - v}%`, transform: "translate(-50%,-50%)", width: 14, height: 14, borderRadius: "50%", border: "2px solid white", boxShadow: "0 0 0 1.5px rgba(0,0,0,0.35)", pointerEvents: "none" }} />
      </div>

      {/* Hue slider */}
      <div ref={hueRef} onMouseDown={onHueDrag} style={{ height: 14, borderRadius: 7, position: "relative", background: "linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)", cursor: "crosshair", marginBottom: 14, userSelect: "none" }}>
        <div style={{ position: "absolute", left: `${h / 360 * 100}%`, top: "50%", transform: "translate(-50%,-50%)", width: 20, height: 20, borderRadius: "50%", background: pureHue, border: "2px solid white", boxShadow: "0 0 0 1.5px rgba(0,0,0,0.25)", pointerEvents: "none" }} />
      </div>

      {/* Bottom row: trash | hex input | eyedropper */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={onDelete} title="Remove colour" style={{ width: 36, height: 36, borderRadius: 6, border: "1px solid var(--border-main)", background: "var(--bg-white)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          {/* Trash icon — bin with lid */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary,#555)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4h6v2"/>
          </svg>
        </button>
        <div onClick={() => hexInputRef.current?.focus()} style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--border-main)", borderRadius: 6, padding: "0 10px", height: 36, cursor: "text" }}>
          <div style={{ width: 20, height: 20, borderRadius: "50%", background: `#${hexText || "aaaaaa"}`, border: "1px solid rgba(0,0,0,0.1)", flexShrink: 0 }} />
          <span style={{ fontFamily: "monospace", fontSize: 13, color: "var(--text-tertiary)", userSelect: "none" }}>#</span>
          <input
            ref={hexInputRef}
            value={hexText.toUpperCase()}
            maxLength={6}
            placeholder="e.g. 36B19E"
            onChange={e => {
              const raw = e.target.value.replace(/[^0-9A-Fa-f]/g, "").slice(0, 6);
              setHexText(raw);
              if (raw.length === 6) { const newHsv = hexToHsv("#" + raw); setHsv(newHsv); onChange("#" + raw.toUpperCase()); }
            }}
            style={{ border: "none", outline: "none", background: "transparent", fontFamily: "monospace", fontSize: 13, color: "var(--text-primary)", flex: 1, minWidth: 0, letterSpacing: "0.04em" }}
          />
        </div>
      </div>
    </div>
  );
}

function ColorsTab({ draft, setDraft }: { draft: BrandKit; setDraft: React.Dispatch<React.SetStateAction<BrandKit>> }) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [activePicker, setActivePicker] = useState<{ group: keyof BrandKit["colors"]; idx: number } | null>(null);

  const groups: { key: keyof BrandKit["colors"]; label: string; hint: string }[] = [
    { key: "primary",    label: "Primary",    hint: "Main brand color" },
    { key: "accent",     label: "Accent",     hint: "Highlight color" },
    { key: "background", label: "Background", hint: "Scene background color for animations" },
  ];

  const removeColor = (group: keyof BrandKit["colors"], idx: number) => {
    setDraft(d => ({ ...d, colors: { ...d.colors, [group]: d.colors[group].filter((_, i) => i !== idx) } }));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {groups.map(({ key, label, hint }) => {
        const isPickerOpen = activePicker?.group === key;
        return (
          <div key={key}>
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font)" }}>{label}</div>
              <div style={{ fontSize: 12, color: "var(--text-tertiary)", fontFamily: "var(--font)", marginTop: 3 }}>{hint}</div>
            </div>
            <div style={{ height: 1, background: "var(--border-main)", margin: "10px 0 14px" }} />

            {/* Swatches row */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
              {draft.colors[key].map((hex, idx) => {
                const hk = `${key}-${idx}`;
                const isHovered = hoveredKey === hk;
                const isActive = isPickerOpen && activePicker?.idx === idx;
                return (
                  <div key={idx}
                    style={{ position: "relative", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}
                    onMouseEnter={() => setHoveredKey(hk)}
                    onMouseLeave={() => setHoveredKey(null)}
                  >
                    <div
                      onClick={() => setActivePicker(isActive ? null : { group: key, idx })}
                      style={{ width: 68, height: 68, borderRadius: "50%", background: hex, boxShadow: isActive ? `0 0 0 3px var(--bg-white), 0 0 0 5.5px ${hex}` : isHovered ? `0 0 0 3px var(--bg-white), 0 0 0 4px ${hex}99` : "none", transition: "box-shadow 0.15s", cursor: "pointer" }}
                    />
                    {isHovered && (
                      <button
                        onMouseDown={e => { e.stopPropagation(); removeColor(key, idx); if (isActive) setActivePicker(null); }}
                        style={{ position: "absolute", top: -5, right: -5, width: 22, height: 22, borderRadius: "50%", background: "#2d2d2d", border: "2px solid var(--bg-white)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", padding: 0, zIndex: 2 }}
                      >
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                      </button>
                    )}
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", fontFamily: "var(--font)" }}>{hex.toLowerCase()}</div>
                  </div>
                );
              })}

              {/* Add new — rainbow ring */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flexShrink: 0 }}>
                <div
                  onClick={() => {
                    const newIdx = draft.colors[key].length;
                    setDraft(d => ({ ...d, colors: { ...d.colors, [key]: [...d.colors[key], "#3B82F6"] } }));
                    setActivePicker({ group: key, idx: newIdx });
                  }}
                  style={{ width: 68, height: 68, borderRadius: "50%", background: "conic-gradient(#FF0000,#FF8800,#FFFF00,#00CC00,#00CCFF,#0044FF,#8800FF,#FF00CC,#FF0000)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                >
                  <div style={{ width: 46, height: 46, borderRadius: "50%", background: "white", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" strokeWidth={2.5} strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-tertiary)", fontFamily: "var(--font)" }}>Add new</div>
              </div>
            </div>

            {/* Inline Canva-style picker */}
            {isPickerOpen && activePicker !== null && draft.colors[key][activePicker.idx] !== undefined && (
              <div style={{ maxWidth: "50%" }}><BrandColorPicker
                key={`${key}-${activePicker.idx}`}
                hex={draft.colors[key][activePicker.idx]}
                onChange={hex => {
                  const { group, idx } = activePicker;
                  setDraft(d => ({ ...d, colors: { ...d.colors, [group]: d.colors[group].map((c, i) => i === idx ? hex : c) } }));
                }}
                onDelete={() => { removeColor(activePicker.group, activePicker.idx); setActivePicker(null); }}
                onClose={() => setActivePicker(null)}
              /></div>
            )}

          </div>
        );
      })}
    </div>
  );
}
function FontsTab({ draft, setDraft }: { draft: BrandKit; setDraft: React.Dispatch<React.SetStateAction<BrandKit>> }) {
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; right: number }>({ top: 0, right: 0 });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load ALL fonts upfront (split into 2 batches to stay under URL length limits)
  useEffect(() => {
    const half = Math.ceil(ALL_FONT_NAMES.length / 2);
    [ALL_FONT_NAMES.slice(0, half), ALL_FONT_NAMES.slice(half)].forEach((batch, i) => {
      const id = `gf-all-brand-fonts-${i}`;
      if (!document.getElementById(id)) {
        const families = batch.map(f => `family=${encodeURIComponent(f)}:wght@400;700`).join("&");
        const link = document.createElement("link");
        link.id = id;
        link.rel = "stylesheet";
        link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
        document.head.appendChild(link);
      }
    });
  }, []);

  // Close on click outside both the buttons and the portal dropdown
  useEffect(() => {
    if (!openDropdown) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current?.contains(e.target as Node)) return;
      if (dropdownRef.current?.contains(e.target as Node)) return;
      setOpenDropdown(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openDropdown]);

  const roleConfig = {
    heading: { label: "Heading", hint: "Titles and section headers", previewSize: 28, weight: 700 },
    body:    { label: "Body",    hint: "Body text and descriptions",  previewSize: 15, weight: 400 },
    accent:  { label: "Accent / Mono", hint: "Code, captions, or highlights", previewSize: 14, weight: 400 },
  } as const;

  function toggleDropdown(role: string, btn: HTMLButtonElement) {
    if (openDropdown === role) {
      setOpenDropdown(null);
    } else {
      const rect = btn.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
      setOpenDropdown(role);
    }
  }

  return (
    <div ref={wrapperRef} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-tertiary)", letterSpacing: "0.07em", textTransform: "uppercase", fontFamily: "var(--font)" }}>Brand Fonts</div>

      {(["heading", "body", "accent"] as const).map(role => {
        const cfg = roleConfig[role];
        const fontName = draft.fonts[role];
        const isOpen = openDropdown === role;

        return (
          <div key={role} style={{ border: "1px solid var(--border-main)", borderRadius: 14, overflow: "hidden", background: "var(--bg-main)" }}>
            {/* Header row */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px" }}>
              {/* Custom font dropdown — renders each option in its own typeface */}
              <button
                onClick={e => toggleDropdown(role, e.currentTarget as HTMLButtonElement)}
                style={{
                  fontSize: 13,
                  fontFamily: fontName ? `"${fontName}", sans-serif` : "var(--font)",
                  border: "1px solid var(--border-main)", borderRadius: 8,
                  padding: "7px 28px 7px 11px",
                  background: "var(--bg-white)",
                  color: fontName ? "var(--text-primary)" : "var(--text-tertiary)",
                  outline: "none", cursor: "pointer",
                  minWidth: 200, textAlign: "left", position: "relative",
                }}
              >
                {fontName || "Select a font…"}
                <span style={{ position: "absolute", right: 9, top: "50%", transform: isOpen ? "translateY(-50%) rotate(180deg)" : "translateY(-50%)", pointerEvents: "none", transition: "transform 0.15s" }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round"><path d="M6 9l6 6 6-6"/></svg>
                </span>
              </button>

              {isOpen && createPortal(
                <div
                  ref={dropdownRef}
                  style={{
                    position: "fixed",
                    top: dropdownPos.top,
                    right: dropdownPos.right,
                    width: 260,
                    maxHeight: 360,
                    overflowY: "auto",
                    background: "var(--bg-white)",
                    border: "1px solid var(--border-main)",
                    borderRadius: 10,
                    boxShadow: "0 8px 32px rgba(0,0,0,0.22)",
                    zIndex: 99999,
                  }}
                >
                  <div
                    onClick={() => { setDraft(d => ({ ...d, fonts: { ...d.fonts, [role]: "" } })); setOpenDropdown(null); }}
                    style={{ padding: "8px 12px", fontSize: 12, color: "var(--text-tertiary)", fontFamily: "var(--font)", cursor: "pointer", borderBottom: "1px solid var(--border-main)" }}
                  >
                    — None —
                  </div>
                  {FONT_OPTIONS.map(group => (
                    <div key={group.group}>
                      <div style={{ padding: "6px 12px 2px", fontSize: 10, fontWeight: 700, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "var(--font)", background: "var(--bg-main)" }}>
                        {group.group}
                      </div>
                      {group.fonts.map(f => (
                        <div
                          key={f}
                          onClick={() => { setDraft(d => ({ ...d, fonts: { ...d.fonts, [role]: f } })); setOpenDropdown(null); }}
                          style={{
                            padding: "9px 12px",
                            fontFamily: `"${f}", sans-serif`,
                            fontSize: role === "heading" ? 16 : role === "body" ? 14 : 13,
                            fontWeight: 400,
                            color: f === fontName ? "var(--accent)" : "var(--text-primary)",
                            background: f === fontName ? "color-mix(in srgb, var(--accent) 8%, transparent)" : "transparent",
                            cursor: "pointer",
                          }}
                          onMouseEnter={e => { if (f !== fontName) (e.currentTarget as HTMLElement).style.background = "var(--bg-main)"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = f === fontName ? "color-mix(in srgb, var(--accent) 8%, transparent)" : "transparent"; }}
                        >
                          {f}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>,
                document.body
              )}
            </div>

            {/* Live preview — always visible */}
            <div style={{ padding: "20px 18px", background: "var(--bg-white)", borderTop: "1px solid var(--border-main)" }}>
              <div style={{ fontFamily: fontName ? `"${fontName}", sans-serif` : "var(--font)", fontSize: cfg.previewSize, fontWeight: 400, color: "var(--text-primary)", lineHeight: 1.3 }}>
                {cfg.label}: {cfg.hint}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BrandKitModal({ kit, onSave, onClose }: { kit: BrandKit | null; onSave: (kit: BrandKit | null) => void; onClose: () => void }) {
  const [tab, setTab] = useState<BKTab>("auto");
  const [draft, setDraft] = useState<BrandKit>(() => kit ? deepCloneBrandKit(kit) : emptyBrandKit());
  const [previewOpen, setPreviewOpen] = useState(false);

  const [dragOver, setDragOver] = useState<string | null>(null);
  const primaryRef = useRef<HTMLInputElement>(null);
  const [extractedColors, setExtractedColors] = useState<string[] | null>(null);

  // Auto-fill state
  const autoInputRef = useRef<HTMLInputElement>(null);
  const [autoDragOver, setAutoDragOver] = useState(false);
  const [autoLoading, setAutoLoading] = useState(false);
  const [autoResult, setAutoResult] = useState<BrandKitAnalysisResult | null>(null);
  const [autoError, setAutoError] = useState<string | null>(null);
  const [autoImagePreview, setAutoImagePreview] = useState<string | null>(null);

  const preview = buildBrandGuideline(draft).replace("\n\n", "");
  const hasContent = buildBrandGuideline(draft) !== "";

  const readLogoFile = (file: File, logoType: keyof BrandKit["logos"]) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string;
      setDraft(d => ({ ...d, logos: { ...d.logos, [logoType]: { name: file.name, dataUrl } } }));
      extractDominantColors(dataUrl, 3).then(colors => {
        if (colors.length > 0) setExtractedColors(colors);
      });
    };
    reader.readAsDataURL(file);
  };

  const logoZoneProps = (logoType: keyof BrandKit["logos"], inputRef: React.RefObject<HTMLInputElement | null>) => ({
    onClick: () => inputRef.current?.click(),
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragOver(logoType); },
    onDragLeave: () => setDragOver(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault(); setDragOver(null);
      const file = e.dataTransfer.files[0];
      if (file) readLogoFile(file, logoType);
    },
  });

  const analyzeImage = async (dataUrl: string) => {
    setAutoLoading(true);
    setAutoError(null);
    setAutoResult(null);
    try {
      const res = await fetch("/api/brand-kit/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageDataUrl: dataUrl }),
      });
      const json = await res.json() as BrandKitAnalysisResult & { error?: string };
      if (!res.ok || json.error) { setAutoError(json.error ?? "Analysis failed."); }
      else { setAutoResult(json); }
    } catch (e) {
      setAutoError(e instanceof Error ? e.message : "Network error");
    } finally {
      setAutoLoading(false);
    }
  };

  const handleAutoFile = (file: File) => {
    if (!isSupportedBrandKitImageType(file.type)) {
      setAutoImagePreview(null);
      setAutoResult(null);
      setAutoError("Auto-fill supports PNG, JPG, GIF, or WebP images.");
      return;
    }
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string;
      setAutoImagePreview(dataUrl);
      setAutoResult(null);
      setAutoError(null);
      analyzeImage(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const applyAutoResult = (result: BrandKitAnalysisResult) => {
    setDraft(d => ({
      ...d,
      colors: {
        primary: result.colors.primary.length > 0 ? result.colors.primary : d.colors.primary,
        accent: result.colors.accent.length > 0 ? result.colors.accent : d.colors.accent,
        background: result.colors.background.length > 0 ? result.colors.background : d.colors.background,
      },
      fonts: {
        heading: result.fonts.heading ?? d.fonts.heading,
        body: result.fonts.body ?? result.fonts.heading ?? d.fonts.body,
        accent: result.fonts.accent ?? d.fonts.accent,
      },
    }));
  };

  const sectionLabel = (text: string) => (
    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-tertiary)", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 12, fontFamily: "var(--font)" }}>{text}</div>
  );

  const fieldInput = (value: string, onChange: (v: string) => void, placeholder: string, mono?: boolean): React.ReactElement => (
    <input type="text" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} style={{
      width: "100%", boxSizing: "border-box",
      fontSize: 13, fontFamily: mono ? "monospace" : "var(--font)",
      border: "1px solid var(--border-main)", borderRadius: 8,
      padding: "9px 12px", background: "var(--bg-main)",
      color: "var(--text-primary)", outline: "none",
    }} />
  );

  const autoTab = {
    id: "auto" as BKTab, label: "Auto-fill",
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z"/></svg>,
  };

  const tabs: { id: BKTab; label: string; icon: React.ReactElement }[] = [
    {
      id: "colors", label: "Colors",
      icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>,
    },
    {
      id: "fonts", label: "Fonts",
      icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>,
    },
    {
      id: "logos", label: "Logos",
      icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>,
    },
    {
      id: "voice", label: "Style",
      icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
    },
  ];

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(6px)" }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ width: "min(900px, 96vw)", height: "min(88vh, 680px)", background: "var(--bg-white)", borderRadius: 20, boxShadow: "0 32px 100px rgba(0,0,0,0.3)", display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* ── Header ── */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 26px", borderBottom: "1px solid var(--border-main)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #2BB5A0, #3dd9c2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>
            </div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 400, color: "var(--text-primary)", fontFamily: "var(--font-display, var(--font))", letterSpacing: -0.3 }}>Brand Kit</div>
              <div style={{ fontSize: 12, color: "var(--text-tertiary)", fontFamily: "var(--font)", marginTop: 1 }}>Define your visual identity — applied to every animation</div>
            </div>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid var(--border-main)", background: "var(--bg-hover)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {/* ── Body ── */}
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>

          {/* Left sidebar */}
          <div style={{ width: 192, borderRight: "1px solid var(--border-main)", padding: "16px 10px", display: "flex", flexDirection: "column", gap: 2, flexShrink: 0, background: "var(--bg-main)" }}>
            {/* Auto-fill tab — prominent at top */}
            <button
              onClick={() => setTab("auto")}
              style={{
                display: "flex", alignItems: "center", gap: 9,
                padding: "9px 11px", borderRadius: 9, border: "none",
                background: tab === "auto"
                  ? "linear-gradient(135deg, rgba(124,58,237,0.12), rgba(168,85,247,0.12))"
                  : "rgba(124,58,237,0.06)",
                color: tab === "auto" ? "var(--accent)" : "rgba(124,58,237,0.7)",
                fontWeight: tab === "auto" ? 700 : 500, fontSize: 13,
                cursor: "pointer", fontFamily: "var(--font)", textAlign: "left", width: "100%",
                boxShadow: tab === "auto" ? "0 1px 4px rgba(124,58,237,0.15)" : "none",
                outline: tab === "auto" ? "1px solid rgba(124,58,237,0.3)" : "1px solid transparent",
                transition: "all 0.1s",
                marginBottom: 10,
              }}
            >
              {autoTab.icon}
              {autoTab.label}
            </button>

            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 9,
                  padding: "9px 11px", borderRadius: 9, border: "none",
                  background: tab === t.id ? "var(--bg-white)" : "transparent",
                  color: tab === t.id ? "var(--text-primary)" : "var(--text-secondary)",
                  fontWeight: tab === t.id ? 600 : 400, fontSize: 13,
                  cursor: "pointer", fontFamily: "var(--font)", textAlign: "left", width: "100%",
                  boxShadow: tab === t.id ? "0 1px 4px rgba(0,0,0,0.07)" : "none",
                  transition: "background 0.1s",
                }}
              >
                {t.icon}
                {t.label}
              </button>
            ))}

          </div>

          {/* Right content */}
          <div style={{ flex: 1, overflow: "auto", padding: "28px 32px" }}>

            {/* ─ Auto-fill tab ─ */}
            {tab === "auto" && (
              <div>
                {sectionLabel("Auto-fill from image")}
                <div style={{ fontSize: 13, color: "var(--text-tertiary)", fontFamily: "var(--font)", marginBottom: 20, lineHeight: 1.5 }}>
                  Upload a brand image and Manimate will extract your colors and suggest matching fonts.
                </div>

                {/* Upload zone */}
                <input ref={autoInputRef} type="file" accept={SUPPORTED_BRAND_KIT_IMAGE_TYPES.join(",")} style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) handleAutoFile(f); e.target.value = ""; }} />
                <div
                  onClick={() => !autoLoading && autoInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setAutoDragOver(true); }}
                  onDragLeave={() => setAutoDragOver(false)}
                  onDrop={e => { e.preventDefault(); setAutoDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleAutoFile(f); }}
                  style={{
                    border: `2px dashed ${autoDragOver ? "var(--accent)" : "var(--border-main)"}`,
                    borderRadius: 14, height: autoImagePreview ? 120 : 160,
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    cursor: autoLoading ? "default" : "pointer", position: "relative",
                    background: autoDragOver ? "rgba(124,58,237,0.04)" : autoImagePreview ? "var(--bg-main)" : "var(--bg-main)",
                    transition: "all 0.15s", overflow: "hidden", marginBottom: 20,
                  }}
                >
                  {autoImagePreview ? (
                    <img src={autoImagePreview} alt="uploaded" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", opacity: autoLoading ? 0.4 : 1, transition: "opacity 0.2s" }} />
                  ) : (
                    <>
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(124,58,237,0.5)" strokeWidth={1.5} strokeLinecap="round"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z"/></svg>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", fontFamily: "var(--font)", marginTop: 10 }}>Upload brand image</div>
                      <div style={{ fontSize: 11, color: "var(--text-tertiary)", fontFamily: "var(--font)", marginTop: 3 }}>PNG, JPG, GIF, or WebP — logo, screenshot, or product shot</div>
                    </>
                  )}
                  {autoLoading && (
                    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.85)" }}>
                      <svg style={{ animation: "spin 1s linear infinite" }} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round">
                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                      </svg>
                      <div style={{ fontSize: 12, color: "var(--accent)", fontFamily: "var(--font)", marginTop: 8, fontWeight: 500 }}>Analyzing with Manimate…</div>
                    </div>
                  )}
                </div>

                {/* Error */}
                {autoError && (
                  <div style={{ padding: "12px 14px", borderRadius: 10, background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)", marginBottom: 16 }}>
                    <div style={{ fontSize: 12, color: "#dc2626", fontFamily: "var(--font)", lineHeight: 1.4 }}>
                      {autoError.includes("ANTHROPIC_API_KEY")
                        ? "Set ANTHROPIC_API_KEY in your .env.local to use Auto-fill."
                        : autoError}
                    </div>
                  </div>
                )}

                {/* Results */}
                {autoResult && !autoLoading && (
                  <div style={{ border: "1px solid var(--border-main)", borderRadius: 14, overflow: "hidden" }}>
                    {/* Colors section */}
                    {(autoResult.colors.primary.length + autoResult.colors.accent.length + autoResult.colors.background.length) > 0 && (
                      <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border-main)" }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font)", marginBottom: 12 }}>Colors</div>
                        {(["primary", "accent", "background"] as const).map(group => {
                          const hexes = autoResult.colors[group];
                          if (hexes.length === 0) return null;
                          return (
                            <div key={group} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                              <div style={{ fontSize: 11, color: "var(--text-tertiary)", fontFamily: "var(--font)", width: 70, textTransform: "capitalize", flexShrink: 0 }}>{group}</div>
                              <div style={{ display: "flex", gap: 6 }}>
                                {hexes.map(hex => (
                                  <div key={hex} title={hex} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                                    <div style={{ width: 28, height: 28, borderRadius: 7, background: hex, border: "1px solid rgba(0,0,0,0.1)" }} />
                                    <div style={{ fontSize: 9, color: "var(--text-tertiary)", fontFamily: "monospace" }}>{hex}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Fonts section */}
                    {Object.values(autoResult.fonts).some(Boolean) && (
                      <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border-main)" }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font)", marginBottom: 10 }}>Fonts</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {([
                            ["heading", autoResult.fonts.heading],
                            ["body", autoResult.fonts.body],
                            ["accent", autoResult.fonts.accent],
                          ] as const).map(([role, font]) => {
                            if (!font) return null;
                            return (
                              <div key={role} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <div style={{ fontSize: 11, color: "var(--text-tertiary)", fontFamily: "var(--font)", width: 70, textTransform: "capitalize", flexShrink: 0 }}>{role}</div>
                                <div style={{ padding: "5px 12px", borderRadius: 20, border: "1px solid var(--border-main)", fontSize: 12, color: "var(--text-primary)", fontFamily: "var(--font)", background: "var(--bg-main)" }}>{font}</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Apply button */}
                    <div style={{ padding: "14px 18px", display: "flex", gap: 10, alignItems: "center" }}>
                      <button
                        onClick={() => { applyAutoResult(autoResult); setTab("colors"); }}
                        style={{ padding: "8px 18px", borderRadius: 9, background: "var(--accent)", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, color: "#fff", fontFamily: "var(--font)" }}
                      >
                        Apply all
                      </button>
                      <button
                        onClick={() => { setAutoResult(null); setAutoImagePreview(null); setAutoError(null); }}
                        style={{ padding: "8px 14px", borderRadius: 9, background: "transparent", border: "1px solid var(--border-main)", cursor: "pointer", fontSize: 12, color: "var(--text-tertiary)", fontFamily: "var(--font)" }}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ─ Logos tab ─ */}
            {tab === "logos" && (
              <div>
                {sectionLabel("Brand Logos")}
                <div style={{ fontSize: 13, color: "var(--text-tertiary)", fontFamily: "var(--font)", marginBottom: 24, lineHeight: 1.5 }}>
                  Upload your logo variants. These will be referenced in the prompt so the AI knows your brand assets.
                </div>
                <div style={{ maxWidth: 220 }}>
                  <input ref={primaryRef} type="file" accept="image/*" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; if (f) readLogoFile(f, "primary"); e.target.value = ""; }} />
                  <div
                    {...logoZoneProps("primary", primaryRef)}
                    style={{
                      border: `2px dashed ${dragOver === "primary" ? "var(--accent)" : "var(--border-main)"}`,
                      borderRadius: 14,
                      height: 150,
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                      cursor: "pointer", position: "relative",
                      background: dragOver === "primary" ? "rgba(124,58,237,0.04)" : "var(--bg-main)",
                      transition: "border-color 0.15s, background 0.15s",
                      overflow: "hidden",
                    }}
                  >
                    {draft.logos.primary ? (
                      <>
                        <img src={draft.logos.primary.dataUrl} alt={draft.logos.primary.name} style={{ maxWidth: "80%", maxHeight: "80%", objectFit: "contain" }} />
                        <button
                          onClick={e => { e.stopPropagation(); setDraft(d => ({ ...d, logos: { ...d.logos, primary: null } })); }}
                          style={{ position: "absolute", top: 8, right: 8, width: 22, height: 22, borderRadius: "50%", background: "rgba(0,0,0,0.5)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        </button>
                      </>
                    ) : (
                      <>
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth={1.5} strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", fontFamily: "var(--font)", marginTop: 8 }}>Upload logo</div>
                        <div style={{ fontSize: 11, color: "var(--text-tertiary)", fontFamily: "var(--font)", marginTop: 2 }}>PNG, SVG, JPG</div>
                      </>
                    )}
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font)" }}>Primary Logo</div>
                    <div style={{ fontSize: 11, color: "var(--text-tertiary)", fontFamily: "var(--font)", marginTop: 1 }}>For light backgrounds</div>
                    {draft.logos.primary && <div style={{ fontSize: 11, color: "var(--accent)", fontFamily: "var(--font)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{draft.logos.primary.name}</div>}
                  </div>
                </div>

                {/* Extracted colors banner */}
                {extractedColors && extractedColors.length > 0 && (
                  <div style={{ marginTop: 24, padding: "14px 16px", borderRadius: 12, border: "1px solid var(--border-main)", background: "var(--bg-main)", display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font)", marginBottom: 8 }}>Colors extracted from logo</div>
                      <div style={{ display: "flex", gap: 8 }}>
                        {extractedColors.map(hex => (
                          <div key={hex} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                            <div style={{ width: 32, height: 32, borderRadius: 8, background: hex, border: "1px solid rgba(0,0,0,0.1)" }} />
                            <div style={{ fontSize: 10, color: "var(--text-tertiary)", fontFamily: "monospace" }}>{hex.toLowerCase()}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <button
                        onClick={() => {
                          setDraft(d => ({ ...d, colors: { ...d.colors, primary: extractedColors } }));
                          setExtractedColors(null);
                          setTab("colors");
                        }}
                        style={{ padding: "7px 14px", borderRadius: 8, background: "var(--accent)", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, color: "#fff", fontFamily: "var(--font)", whiteSpace: "nowrap" }}
                      >
                        Apply colors
                      </button>
                      <button
                        onClick={() => setExtractedColors(null)}
                        style={{ padding: "5px 14px", borderRadius: 8, background: "transparent", border: "1px solid var(--border-main)", cursor: "pointer", fontSize: 11, color: "var(--text-tertiary)", fontFamily: "var(--font)" }}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ─ Colors tab ─ */}
            {tab === "colors" && (
              <ColorsTab draft={draft} setDraft={setDraft} />
            )}

            {/* ─ Fonts tab ─ */}
            {tab === "fonts" && (
              <FontsTab draft={draft} setDraft={setDraft} />
            )}

            {/* ─ Style tab ─ */}
            {tab === "voice" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                {sectionLabel("Style")}

                {/* Style tags */}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font)", marginBottom: 10 }}>Visual Style Tags</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                    {STYLE_TAG_OPTIONS.map(tag => {
                      const active = draft.styleTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          onClick={() => setDraft(d => ({ ...d, styleTags: active ? d.styleTags.filter(t => t !== tag) : [...d.styleTags, tag] }))}
                          style={{
                            padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: active ? 600 : 400,
                            border: active ? "1.5px solid var(--accent)" : "1px solid var(--border-main)",
                            background: active ? "rgba(124,58,237,0.08)" : "var(--bg-main)",
                            color: active ? "var(--accent)" : "var(--text-secondary)",
                            cursor: "pointer", fontFamily: "var(--font)", transition: "all 0.1s",
                          }}
                        >
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Style Notes */}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", fontFamily: "var(--font)", marginBottom: 6 }}>Style Notes</div>
                  <div style={{ fontSize: 12, color: "var(--text-tertiary)", fontFamily: "var(--font)", marginBottom: 10 }}>Additional visual directions, dos & don&apos;ts</div>
                  <textarea
                    value={draft.styleNotes}
                    placeholder="e.g. Avoid gradients. Use geometric shapes. Dark backgrounds only. Keep animations snappy under 3s."
                    onChange={e => setDraft(d => ({ ...d, styleNotes: e.target.value }))}
                    rows={4}
                    style={{ width: "100%", boxSizing: "border-box", fontSize: 13, fontFamily: "var(--font)", border: "1px solid var(--border-main)", borderRadius: 8, padding: "10px 12px", background: "var(--bg-main)", color: "var(--text-primary)", outline: "none", resize: "vertical", lineHeight: 1.6 }}
                  />
                </div>

              </div>
            )}

          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{ borderTop: "1px solid var(--border-main)", padding: "14px 26px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, background: "var(--bg-main)", gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }} />
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button
              onClick={onClose}
              style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)", background: "var(--bg-hover)", border: "1px solid var(--border-main)", borderRadius: 9, padding: "8px 18px", cursor: "pointer", fontFamily: "var(--font)" }}
            >
              Cancel
            </button>
            <button
              onClick={() => setPreviewOpen(true)}
              disabled={!preview}
              style={{ fontSize: 13, fontWeight: 500, color: preview ? "var(--text-primary)" : "var(--text-tertiary)", background: "var(--bg-white)", border: "1px solid var(--border-main)", borderRadius: 9, padding: "8px 18px", cursor: preview ? "pointer" : "default", fontFamily: "var(--font)", opacity: preview ? 1 : 0.5 }}
            >
              Preview
            </button>
            <button
              onClick={() => { onSave(hasContent ? draft : null); onClose(); }}
              style={{ fontSize: 13, fontWeight: 600, color: "#fff", background: "var(--accent, #7C3AED)", border: "none", borderRadius: 9, padding: "8px 20px", cursor: "pointer", fontFamily: "var(--font)" }}
            >
              Save Brand Kit
            </button>
          </div>
        </div>

        {/* ── Preview popup ── */}
        {previewOpen && createPortal(
          <div
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10001 }}
            onMouseDown={e => { if (e.target === e.currentTarget) setPreviewOpen(false); }}
          >
            <div style={{ width: "min(640px, 92vw)", maxHeight: "70vh", background: "var(--bg-white)", borderRadius: 16, boxShadow: "0 24px 80px rgba(0,0,0,0.3)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--border-main)" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font)" }}>Prompt Preview</div>
                <button onClick={() => setPreviewOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-tertiary)", fontSize: 20, lineHeight: 1, padding: 0, fontFamily: "var(--font)" }}>×</button>
              </div>
              <div style={{ padding: "20px", overflowY: "auto" }}>
                <pre style={{ margin: 0, fontFamily: "monospace", fontSize: 12, color: "var(--text-secondary)", whiteSpace: "pre-wrap", lineHeight: 1.7, background: "var(--bg-main)", padding: "16px", borderRadius: 8 }}>{preview}</pre>
              </div>
            </div>
          </div>,
          document.body
        )}

      </div>
    </div>
  );
}

function BrandKitSelector({ kit, onChange, enabled, onToggleEnabled, disabled }: { kit: BrandKit | null; onChange: (kit: BrandKit | null) => void; enabled: boolean; onToggleEnabled: (v: boolean) => void; disabled?: boolean }) {
  const [modalOpen, setModalOpen] = useState(false);
  const hasKit = !!kit && buildBrandGuideline(kit) !== "";
  const isActive = hasKit && enabled;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 0, background: isActive ? "rgba(124,58,237,0.08)" : "var(--bg-white)", border: isActive ? "1px solid var(--accent)" : "1px solid var(--border-main)", borderRadius: 20, transition: "border-color 0.12s, background 0.12s", overflow: "hidden" }}>
        <button
          onClick={() => { if (!disabled) setModalOpen(true); }}
          style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 8px 4px 10px", cursor: disabled ? "default" : "pointer", background: "none", border: "none", fontFamily: "var(--font)" }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={isActive ? "var(--accent)" : "var(--text-tertiary)"} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>
          </svg>
          <span style={{ fontSize: 13, fontWeight: 500, color: isActive ? "var(--accent)" : "var(--text-primary)" }}>Brand Kit</span>
        </button>
        {hasKit && (
          <button
            onClick={() => onToggleEnabled(!enabled)}
            title={enabled ? "Disable brand kit" : "Enable brand kit"}
            style={{ display: "flex", alignItems: "center", padding: "4px 10px 4px 4px", background: "none", border: "none", cursor: "pointer" }}
          >
            <div style={{ width: 28, height: 16, borderRadius: 8, background: enabled ? "var(--accent)" : "var(--border-main)", position: "relative", transition: "background 0.15s" }}>
              <div style={{ position: "absolute", top: 2, left: enabled ? 14 : 2, width: 12, height: 12, borderRadius: "50%", background: "#fff", transition: "left 0.15s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
            </div>
          </button>
        )}
      </div>
      {modalOpen && <BrandKitModal kit={kit} onSave={onChange} onClose={() => setModalOpen(false)} />}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function usePreferredVoice() {
  const [voice, setVoice] = useState(DEFAULT_VOICE_ID);

  useEffect(() => {
    let timer: number | null = null;
    try {
      const saved = localStorage.getItem(VOICE_PREF_KEY);
      if (saved) {
        timer = window.setTimeout(() => setVoice(saved), 0);
      }
    } catch {}
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  const set = useCallback((v: string) => {
    setVoice(v);
    try { localStorage.setItem(VOICE_PREF_KEY, v); } catch {}
  }, []);
  return [voice, set] as const;
}

// Voice name cache helpers (localStorage)
type VoiceNameCache = Record<string, { name: string; ts: number }>;
const VOICE_NAME_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

function getCachedVoiceName(voiceId: string): string | null {
  try {
    const raw = localStorage.getItem(VOICE_NAMES_KEY);
    if (!raw) return null;
    const cache: VoiceNameCache = JSON.parse(raw);
    const entry = cache[voiceId];
    if (!entry) return null;
    if (Date.now() - entry.ts > VOICE_NAME_TTL) return null;
    return entry.name;
  } catch { return null; }
}

function setCachedVoiceName(voiceId: string, name: string) {
  try {
    const raw = localStorage.getItem(VOICE_NAMES_KEY);
    const cache: VoiceNameCache = raw ? JSON.parse(raw) : {};
    cache[voiceId] = { name, ts: Date.now() };
    localStorage.setItem(VOICE_NAMES_KEY, JSON.stringify(cache));
  } catch {}
}

function truncateVoiceName(name: string, max = 20): string {
  if (name.length <= max) return name;
  // Use first segment before " - " if it fits
  const firstPart = name.split(" - ")[0];
  if (firstPart.length <= max) return firstPart;
  return name.slice(0, max - 1) + "…";
}

type ElevenLabsKeyStatus = {
  configured: boolean;
  source: "saved" | "env" | null;
  masked_key: string | null;
};

function getElevenLabsKeySummary(status: ElevenLabsKeyStatus | null): string {
  if (!status) return "Checking ElevenLabs configuration...";
  if (!status.configured) {
    return "For voiceover and voice lookup.";
  }
  if (status.source === "saved") {
    return status.masked_key
      ? `Saved locally as ${status.masked_key}.`
      : "Saved locally for this Studio install.";
  }
  return status.masked_key
    ? `Using environment key ${status.masked_key}.`
    : "Using environment key.";
}

function VoiceSelector({ voice, onChange, disabled }: { voice: string; onChange: (voice: string) => void; disabled?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const [customId, setCustomId] = useState("");
  const [suggestion, setSuggestion] = useState<{ id: string; name: string } | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeyStatus, setApiKeyStatus] = useState<ElevenLabsKeyStatus | null>(null);
  const [apiKeyStatusLoading, setApiKeyStatusLoading] = useState(false);
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [showApiKeyForm, setShowApiKeyForm] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const apiKeyInputRef = useRef<HTMLInputElement>(null);
  const lookupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lookupVersion = useRef(0);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const refreshApiKeyStatus = useCallback(async () => {
    setApiKeyStatusLoading(true);
    try {
      const response = await fetch(ELEVENLABS_SETTINGS_ENDPOINT, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "Failed to load ElevenLabs API key status"
        );
      }
      setApiKeyStatus(data as ElevenLabsKeyStatus);
      setShowApiKeyForm(!data.configured);
      setApiKeyError(null);
    } catch (error) {
      setApiKeyError(
        error instanceof Error ? error.message : "Failed to load ElevenLabs API key status"
      );
      setShowApiKeyForm(true);
    } finally {
      setApiKeyStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void refreshApiKeyStatus();
  }, [isOpen, refreshApiKeyStatus]);

  useEffect(() => {
    if (!showApiKeyForm) return;
    const timer = window.setTimeout(() => apiKeyInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [showApiKeyForm]);

  useEffect(() => {
    if (isOpen) return;
    setApiKeyInput("");
    setApiKeyError(null);
  }, [isOpen]);

  // Auto-lookup: debounce 500ms after input reaches 15+ alphanumeric chars
  const handleCustomIdChange = (value: string) => {
    setCustomId(value);
    setSuggestion(null);
    if (lookupTimer.current) clearTimeout(lookupTimer.current);

    const trimmed = value.trim();
    if (trimmed.length < 15 || trimmed.length > 64 || !/^[a-zA-Z0-9]+$/.test(trimmed)) return;

    // Check cache first
    const cached = getCachedVoiceName(trimmed);
    if (cached) { setSuggestion({ id: trimmed, name: cached }); return; }

    const version = ++lookupVersion.current;
    lookupTimer.current = setTimeout(() => {
      setLookupLoading(true);
      fetch(`/api/voices/${trimmed}`)
        .then(async r => {
          if (r.ok) return r.json();
          // 403 = API key lacks voices_read, but voice may still be valid for TTS
          if (r.status === 403) return { voiceId: trimmed, name: null };
          return null;
        })
        .then(data => {
          if (version !== lookupVersion.current) return; // stale
          if (data?.name) {
            setCachedVoiceName(trimmed, data.name);
            setSuggestion({ id: trimmed, name: data.name });
          } else if (data?.voiceId) {
            // Name unknown but ID looks valid — let user apply anyway
            setSuggestion({ id: trimmed, name: "" });
          }
        })
        .catch(() => {})
        .finally(() => {
          if (version === lookupVersion.current) setLookupLoading(false);
        });
    }, 500);
  };

  // Clean up timer on unmount
  useEffect(() => () => { if (lookupTimer.current) clearTimeout(lookupTimer.current); }, []);

  const selectSuggestion = () => {
    if (!suggestion) return;
    onChange(suggestion.id);
    setCustomId("");
    setSuggestion(null);
    setIsOpen(false);
  };

  const handleSaveApiKey = useCallback(async () => {
    const trimmed = apiKeyInput.trim();
    if (!trimmed) {
      setApiKeyError("Paste your ElevenLabs API key.");
      return;
    }

    setApiKeySaving(true);
    setApiKeyError(null);
    try {
      const response = await fetch(ELEVENLABS_SETTINGS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: trimmed }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "Failed to save ElevenLabs API key"
        );
      }
      setApiKeyStatus(data as ElevenLabsKeyStatus);
      setApiKeyInput("");
      setShowApiKeyForm(false);
    } catch (error) {
      setApiKeyError(
        error instanceof Error ? error.message : "Failed to save ElevenLabs API key"
      );
    } finally {
      setApiKeySaving(false);
    }
  }, [apiKeyInput]);

  const handleClearSavedApiKey = useCallback(async () => {
    setApiKeySaving(true);
    setApiKeyError(null);
    try {
      const response = await fetch(ELEVENLABS_SETTINGS_ENDPOINT, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "Failed to clear ElevenLabs API key"
        );
      }
      setApiKeyStatus(data as ElevenLabsKeyStatus);
      setApiKeyInput("");
      setShowApiKeyForm(!data.configured);
    } catch (error) {
      setApiKeyError(
        error instanceof Error ? error.message : "Failed to clear ElevenLabs API key"
      );
    } finally {
      setApiKeySaving(false);
    }
  }, []);

  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button
        onClick={() => { if (!disabled) setIsOpen(!isOpen); }}
        aria-label="Voice selector"
        style={{
          display: "flex", alignItems: "center", gap: 3,
          background: "var(--bg-white)", border: "1px solid var(--border-main)",
          borderRadius: 20,
          padding: "4px 8px",
          cursor: disabled ? "default" : "pointer",
          fontFamily: "var(--font)",
          transition: "border-color 0.12s",
        }}
      >
        {voice === NONE_VOICE_ID ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <line x1="23" y1="9" x2="17" y2="15" />
            <line x1="17" y1="9" x2="23" y2="15" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
        )}
        <svg width="11" height="11" viewBox="0 0 20 20" fill="var(--text-tertiary)" style={{ transition: "transform 0.15s", transform: isOpen ? "rotate(180deg)" : "none" }}>
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      {isOpen && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 4px)", left: 0,
          background: "var(--bg-white)",
          border: "1px solid var(--border-main)",
          borderRadius: 10,
          boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          zIndex: 50,
          overflowX: "hidden",
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          overscrollBehavior: "contain",
          maxHeight: "min(60vh, 520px)",
          minWidth: 180,
        }}>
          <div
            style={{
              padding: "10px 14px 12px",
              background: "rgba(43,181,160,0.04)",
              borderBottom: "1px solid var(--border-main)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ display: "grid", gap: 3, flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    fontFamily: "var(--font)",
                  }}
                >
                  ElevenLabs key
                </span>
                <span
                  style={{
                    fontSize: 11,
                    lineHeight: 1.45,
                    color: "var(--text-tertiary)",
                    fontFamily: "var(--font)",
                  }}
                >
                  {apiKeyStatusLoading ? "Checking..." : getElevenLabsKeySummary(apiKeyStatus)}
                </span>
                {showApiKeyForm && (
                  <span
                    style={{
                      fontSize: 11,
                      lineHeight: 1.45,
                      color: "var(--text-tertiary)",
                      fontFamily: "var(--font)",
                    }}
                  >
                    Saved locally in ~/.manimate/config.json.
                  </span>
                )}
              </div>

              {!showApiKeyForm && (
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => {
                      setShowApiKeyForm(true);
                      setApiKeyError(null);
                    }}
                    style={{
                      border: "1px solid var(--border-main)",
                      background: "var(--bg-white)",
                      borderRadius: 8,
                      padding: "5px 8px",
                      cursor: "pointer",
                      fontSize: 11,
                      color: "var(--text-secondary)",
                      fontFamily: "var(--font)",
                    }}
                  >
                    {apiKeyStatus?.source === "saved" ? "Replace" : "Save local key"}
                  </button>
                  {apiKeyStatus?.source === "saved" && (
                    <button
                      onClick={() => { void handleClearSavedApiKey(); }}
                      disabled={apiKeySaving}
                      style={{
                        border: "1px solid rgba(180,35,24,0.18)",
                        background: "#fff7f6",
                        borderRadius: 8,
                        padding: "5px 8px",
                        cursor: apiKeySaving ? "default" : "pointer",
                        fontSize: 11,
                        color: "#b42318",
                        fontFamily: "var(--font)",
                        opacity: apiKeySaving ? 0.6 : 1,
                      }}
                    >
                      Remove
                    </button>
                  )}
                </div>
              )}
            </div>

            {showApiKeyForm && (
              <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                <input
                  ref={apiKeyInputRef}
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleSaveApiKey(); }}
                  placeholder="Paste ElevenLabs API key..."
                  autoComplete="off"
                  spellCheck={false}
                  style={{
                    fontSize: 12,
                    fontFamily: "monospace",
                    border: "1px solid var(--border-main)",
                    borderRadius: 6,
                    background: "var(--bg-white)",
                    padding: "6px 8px",
                    width: "100%",
                    outline: "none",
                    color: "var(--text-primary)",
                    boxSizing: "border-box",
                  }}
                />

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    onClick={() => { void handleSaveApiKey(); }}
                    disabled={apiKeySaving}
                    style={{
                      border: "none",
                      borderRadius: 8,
                      padding: "6px 10px",
                      background: "var(--accent)",
                      color: "#ffffff",
                      cursor: apiKeySaving ? "default" : "pointer",
                      fontSize: 11,
                      fontWeight: 600,
                      fontFamily: "var(--font)",
                      opacity: apiKeySaving ? 0.72 : 1,
                    }}
                  >
                    {apiKeySaving ? "Saving..." : "Save key"}
                  </button>

                  {apiKeyStatus?.configured && (
                    <button
                      onClick={() => {
                        setShowApiKeyForm(false);
                        setApiKeyInput("");
                        setApiKeyError(null);
                      }}
                      disabled={apiKeySaving}
                      style={{
                        border: "1px solid var(--border-main)",
                        borderRadius: 8,
                        padding: "6px 10px",
                        background: "var(--bg-white)",
                        color: "var(--text-secondary)",
                        cursor: apiKeySaving ? "default" : "pointer",
                        fontSize: 11,
                        fontFamily: "var(--font)",
                        opacity: apiKeySaving ? 0.72 : 1,
                      }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            )}

            {apiKeyError && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 11,
                  lineHeight: 1.45,
                  color: "#b42318",
                  fontFamily: "var(--font)",
                }}
              >
                {apiKeyError}
              </div>
            )}
          </div>

          {/* None option */}
          <div
            style={{
              display: "flex", alignItems: "center",
              background: voice === NONE_VOICE_ID ? "var(--bg-active)" : "transparent",
              transition: "background 0.12s",
            }}
            onMouseEnter={(e) => { if (voice !== NONE_VOICE_ID) e.currentTarget.style.background = "var(--bg-hover)"; }}
            onMouseLeave={(e) => { if (voice !== NONE_VOICE_ID) e.currentTarget.style.background = "transparent"; }}
          >
            <button
              onClick={() => { onChange(NONE_VOICE_ID); setIsOpen(false); }}
              style={{
                display: "flex", flexDirection: "column", gap: 1,
                flex: 1, padding: "8px 0 8px 14px",
                border: "none", background: "transparent",
                cursor: "pointer", fontFamily: "var(--font)",
                textAlign: "left",
              }}
            >
              <span style={{ fontSize: 13, fontWeight: voice === NONE_VOICE_ID ? 600 : 400, color: voice === NONE_VOICE_ID ? "var(--text-primary)" : "var(--text-secondary)" }}>
                No Voice
              </span>
              <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                Silent video, saves credits
              </span>
            </button>
          </div>

          <div style={{ height: 1, background: "var(--border-main)", margin: "4px 0" }} />

          {AVAILABLE_VOICES.map((v) => (
            <div
              key={v.id}
              style={{
                display: "flex", alignItems: "center",
                background: v.id === voice ? "var(--bg-active)" : "transparent",
                transition: "background 0.12s",
              }}
              onMouseEnter={(e) => { if (v.id !== voice) e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { if (v.id !== voice) e.currentTarget.style.background = "transparent"; }}
            >
              <button
                onClick={() => { onChange(v.id); setIsOpen(false); }}
                style={{
                  display: "flex", flexDirection: "column", gap: 1,
                  flex: 1, padding: "8px 0 8px 14px",
                  border: "none", background: "transparent",
                  cursor: "pointer", fontFamily: "var(--font)",
                  textAlign: "left",
                }}
              >
                <span style={{ fontSize: 13, fontWeight: v.id === voice ? 600 : 400, color: v.id === voice ? "var(--text-primary)" : "var(--text-secondary)" }}>
                  {v.label}{v.id === DEFAULT_VOICE_ID && <span style={{ fontWeight: 400, color: "var(--text-tertiary)", marginLeft: 4 }}>(Default)</span>}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>
                  {v.description}
                </span>
              </button>
              <a
                href={getVoicePageUrl(v.id)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                aria-label={`Preview ${v.label} on ElevenLabs`}
                title="Preview on ElevenLabs"
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 28, height: 28, marginRight: 8,
                  borderRadius: 6, color: "var(--text-tertiary)",
                  textDecoration: "none", flexShrink: 0,
                  transition: "color 0.12s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text-primary)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-tertiary)"; }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </a>
            </div>
          ))}

          <div style={{ height: 1, background: "var(--border-main)", margin: "4px 0" }} />

          {/* Custom voice ID: paste and auto-lookup */}
          <div style={{ padding: "6px 14px" }}>
            <input
              type="text"
              value={customId}
              onChange={(e) => handleCustomIdChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && suggestion) selectSuggestion(); }}
              placeholder="Paste voice ID..."
              style={{
                fontSize: 12,
                fontFamily: "monospace",
                border: "1px solid var(--border-main)",
                borderRadius: 6,
                background: "var(--bg-main)",
                padding: "4px 8px",
                width: "100%",
                outline: "none",
                color: "var(--text-primary)",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Auto-suggestion row */}
          {lookupLoading && (
            <div style={{ padding: "4px 14px", fontSize: 12, color: "var(--text-tertiary)", fontFamily: "var(--font)" }}>
              Looking up...
            </div>
          )}
          {suggestion && (
            <button
              onClick={selectSuggestion}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                width: "100%", padding: "8px 14px",
                border: "none", background: "transparent",
                fontSize: 13, fontWeight: 400,
                color: "var(--text-secondary)",
                cursor: "pointer",
                fontFamily: "var(--font)",
                transition: "background 0.12s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              {suggestion.name
                ? <>Use &ldquo;{truncateVoiceName(suggestion.name, 30)}&rdquo;</>
                : <>Use {suggestion.id.slice(0, 6)}...{suggestion.id.slice(-4)}</>
              }
            </button>
          )}

          <a
            href="https://elevenlabs.io/community"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "block",
              fontSize: 12,
              color: "var(--text-tertiary)",
              padding: "6px 14px",
              textDecoration: "none",
              fontFamily: "var(--font)",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "none"; }}
          >
            Browse voices ↗
          </a>
        </div>
      )}
    </div>
  );
}

// Chat state managed by reducer
interface ChatState {
  messages: Message[];
  isLoading: boolean;
  isLoadingMessages: boolean;
  isCancelling: boolean;
  sandboxId: string | null;
  claudeSessionId: string | null;
  statusMessage: string | null;
  activityEvents: ActivityEvent[];
  videoUrl: string | null;
  videoUpdateNonce: number;
  planContent: string | null;
  scriptContent: string | null;
  model: string;
}

type ChatAction =
  | { type: "ADD_USER_MESSAGE"; message: Message }
  | { type: "ADD_ASSISTANT_MESSAGE"; message: Message }
  | { type: "UPDATE_ASSISTANT_MESSAGE"; id: string; content: string; isError?: boolean }
  | { type: "SET_LOADING"; isLoading: boolean }
  | { type: "SET_CANCELLING"; isCancelling: boolean }
  | { type: "SET_STATUS"; statusMessage: string | null }
  | { type: "SET_SESSION"; sandboxId?: string | null; claudeSessionId?: string | null }
  | { type: "ADD_ACTIVITY"; event: ActivityEvent }
  | { type: "SET_VIDEO_URL"; url: string | null; bumpNonce?: boolean }
  | { type: "RESTORE_SESSION"; sandboxId: string; claudeSessionId: string }
  | { type: "LOAD_MESSAGES"; messages: Message[] }
  | { type: "LOAD_ACTIVITY_EVENTS"; events: ActivityEvent[] }
  | { type: "SET_LOADING_MESSAGES"; isLoadingMessages: boolean }
  | { type: "SET_PLAN_CONTENT"; content: string | null }
  | { type: "SET_SCRIPT_CONTENT"; content: string | null }
  | { type: "SET_MODEL"; model: string };

function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "ADD_USER_MESSAGE":
      return { ...state, messages: [...state.messages, action.message] };

    case "ADD_ASSISTANT_MESSAGE":
      return { ...state, messages: [...state.messages, action.message] };

    case "UPDATE_ASSISTANT_MESSAGE": {
      const exists = state.messages.some(m => m.id === action.id);
      if (!exists) {
        return {
          ...state,
          messages: [...state.messages, { id: action.id, role: "assistant", content: action.content, isError: action.isError }],
        };
      }
      return {
        ...state,
        messages: state.messages.map(m =>
          m.id === action.id ? { ...m, content: action.content, isError: action.isError } : m
        ),
      };
    }

    case "SET_LOADING":
      return { ...state, isLoading: action.isLoading };

    case "SET_CANCELLING":
      return { ...state, isCancelling: action.isCancelling };

    case "SET_STATUS":
      return { ...state, statusMessage: action.statusMessage };

    case "SET_SESSION":
      return {
        ...state,
        sandboxId: action.sandboxId !== undefined ? action.sandboxId : state.sandboxId,
        claudeSessionId: action.claudeSessionId !== undefined ? action.claudeSessionId : state.claudeSessionId,
      };

    case "ADD_ACTIVITY":
      return { ...state, activityEvents: [...state.activityEvents, action.event] };

    case "SET_VIDEO_URL": {
      // Dedup: same base URL without nonce bump → skip (prevents redundant reloads)
      const newBase = action.url?.split('?')[0] || null;
      const oldBase = state.videoUrl?.split('?')[0] || null;
      if (newBase && newBase === oldBase && !action.bumpNonce) return state;
      return {
        ...state,
        videoUrl: action.url,
        videoUpdateNonce: action.bumpNonce ? state.videoUpdateNonce + 1 : state.videoUpdateNonce,
      };
    }

    case "RESTORE_SESSION":
      return {
        ...state,
        sandboxId: action.sandboxId,
        claudeSessionId: action.claudeSessionId,
      };

    case "LOAD_MESSAGES":
      return { ...state, messages: action.messages };

    case "LOAD_ACTIVITY_EVENTS":
      return { ...state, activityEvents: action.events };

    case "SET_LOADING_MESSAGES":
      return { ...state, isLoadingMessages: action.isLoadingMessages };

    case "SET_PLAN_CONTENT":
      return { ...state, planContent: action.content };

    case "SET_SCRIPT_CONTENT":
      return { ...state, scriptContent: action.content };

    case "SET_MODEL":
      return { ...state, model: action.model };

    default:
      return state;
  }
}

const initialState: ChatState = {
  messages: [],
  isLoading: false,
  isLoadingMessages: false,
  isCancelling: false,
  sandboxId: null,
  claudeSessionId: null,
  statusMessage: null,
  activityEvents: [],
  videoUrl: null,
  videoUpdateNonce: 0,
  planContent: null,
  scriptContent: null,
  model: DEFAULT_MODEL,
};

interface SessionMessagePayload {
  id: string;
  role: string;
  content: string;
  metadata?: { images?: ImageAttachment[] };
}

interface SessionSnapshot {
  sandbox_id: string | null;
  claude_session_id: string | null;
  last_video_url: string | null;
  plan_content: string | null;
  script_content: string | null;
  model: string | null;
  aspect_ratio: string | null;
}

interface SessionMessagesResponse {
  messages: SessionMessagePayload[];
  activityEvents?: DBActivityEvent[];
  session: SessionSnapshot;
  activeRun?: ActiveRun | null;
}

interface ChatPanelProps {
  sessionId: string | null;
  aspectRatio: AspectRatio;
  onSessionAspectRatio?: (ratio: AspectRatio) => void;
  hasPendingWelcomePayload?: (sessionId: string) => boolean;
  consumeWelcomePayload?: (sessionId: string) => { prompt: string; images?: File[] } | null;
  /** Resolves true when the session row exists in DB (for optimistic navigation) */
  sessionReady?: Promise<boolean> | null;
  isMobile?: boolean;
}

export function ChatPanel({ sessionId, aspectRatio, onSessionAspectRatio, hasPendingWelcomePayload, consumeWelcomePayload, sessionReady, isMobile = false }: ChatPanelProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const draftKey = sessionId ? `chat-draft:${sessionId}` : undefined;
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentAssistantMessageIdRef = useRef<string | null>(null);
  const sandboxIdRef = useRef<string | null>(null);
  const claudeSessionIdRef = useRef<string | null>(null);

  const planContentRef = useRef<string | null>(null);
  const scriptContentRef = useRef<string | null>(null);
  const videoUrlBaseRef = useRef<string | null>(null);
  const videoUrlRef = useRef<string | null>(null);
  const videoUpdateNonceRef = useRef(0);
  const reconnectedRunIdRef = useRef<string | null>(null);
  const expectedPreviewNonceRef = useRef<number | null>(null);
  const [showPreviewReadyBadge, setShowPreviewReadyBadge] = useState(false);
  const resolveArtifactType = useCallback((filePath?: string): "plan" | "script" | null => {
    if (!filePath) return null;
    const normalized = filePath.replace(/\\/g, "/").trim().toLowerCase();
    if (!normalized) return null;
    const name = normalized.split("/").pop();
    if (name === "plan.md") return "plan";
    if (name === "script.py") return "script";
    return null;
  }, []);

  // Sync refs with state
  useEffect(() => { sandboxIdRef.current = state.sandboxId; }, [state.sandboxId]);
  useEffect(() => { claudeSessionIdRef.current = state.claudeSessionId; }, [state.claudeSessionId]);
  useEffect(() => { planContentRef.current = state.planContent; }, [state.planContent]);
  useEffect(() => { scriptContentRef.current = state.scriptContent; }, [state.scriptContent]);
  useEffect(() => { videoUrlRef.current = state.videoUrl; }, [state.videoUrl]);
  useEffect(() => { videoUpdateNonceRef.current = state.videoUpdateNonce; }, [state.videoUpdateNonce]);
  useBrowserPreviewBadge(
    shouldShowBrowserPreviewBadge({
      videoUrl: state.videoUrl,
      isLoading: state.isLoading,
      badgeAlreadyVisible: showPreviewReadyBadge,
    }),
  );

  const showPendingPreviewReadyBadge = useCallback(() => {
    if (expectedPreviewNonceRef.current === null) return;
    // `complete` + `video_url` is already authoritative. Background tabs can defer
    // media loading events, so the browser badge cannot wait on `<video>.canplay`.
    expectedPreviewNonceRef.current = null;
    setShowPreviewReadyBadge(true);
  }, []);

  const handlePreviewReady = useCallback((previewNonce: number) => {
    if (expectedPreviewNonceRef.current !== previewNonce) return;
    showPendingPreviewReadyBadge();
  }, [showPendingPreviewReadyBadge]);

  const applyFetchedSessionData = useCallback(
    (
      data: SessionMessagesResponse,
      options?: { preserveExistingArtifacts?: boolean },
    ) => {
      const preserveExistingArtifacts = options?.preserveExistingArtifacts ?? false;

      const messages: Message[] = data.messages.map((msg) => ({
        id: msg.id,
        role: msg.role as "user" | "assistant",
        content: msg.content,
        images: msg.metadata?.images,
      }));
      dispatch({ type: "LOAD_MESSAGES", messages });

      if (Array.isArray(data.activityEvents)) {
        const activityEvents: ActivityEvent[] = data.activityEvents.map((evt) =>
          dbActivityEventToUI(evt),
        );
        dispatch({ type: "LOAD_ACTIVITY_EVENTS", events: activityEvents });
      }

      if (data.session.model) {
        dispatch({ type: "SET_MODEL", model: data.session.model });
      }
      if (isAspectRatio(data.session.aspect_ratio)) {
        onSessionAspectRatio?.(data.session.aspect_ratio);
      }

      if (
        data.session.plan_content &&
        (!preserveExistingArtifacts || !planContentRef.current)
      ) {
        dispatch({ type: "SET_PLAN_CONTENT", content: data.session.plan_content });
      }
      if (
        data.session.script_content &&
        (!preserveExistingArtifacts || !scriptContentRef.current)
      ) {
        dispatch({
          type: "SET_SCRIPT_CONTENT",
          content: data.session.script_content,
        });
      }

    },
    [onSessionAspectRatio],
  );

  // Bootstrap: load messages for existing session on mount
  // With key={sessionId} on ChatPanel, this runs once per session
  useEffect(() => {
    // Skip bootstrap fetch for welcome-prompted sessions (auto-send will fire)
    const isWelcomeCreated = sessionId ? Boolean(hasPendingWelcomePayload?.(sessionId)) : false;
    if (!sessionId || isWelcomeCreated) return;

    dispatch({ type: "SET_LOADING_MESSAGES", isLoadingMessages: true });

    let cancelled = false;
    fetch(`/api/sessions/${sessionId}/messages`)
      .then(async (response) => {
        if (cancelled) return null;
        if (!response.ok) throw new Error(`Failed to fetch messages: ${response.status}`);
        return response.json() as Promise<SessionMessagesResponse>;
      })
      .then((data: SessionMessagesResponse | null) => {
        if (!data || cancelled) return;
        applyFetchedSessionData(data);

        if (data.session.sandbox_id) {
          dispatch({ type: "RESTORE_SESSION", sandboxId: data.session.sandbox_id, claudeSessionId: data.session.claude_session_id || "" });
        }

        if (data.session.last_video_url) {
          videoUrlRef.current = data.session.last_video_url;
          videoUrlBaseRef.current = data.session.last_video_url.split('?')[0];
          dispatch({ type: "SET_VIDEO_URL", url: data.session.last_video_url });
        }

        if (data.activeRun) {
          const activeRun = data.activeRun as ActiveRun;
          if (activeRun.status === "running" || activeRun.status === "queued") {
            reconnectedRunIdRef.current = activeRun.id;
            expectedPreviewNonceRef.current = videoUpdateNonceRef.current + 1;
            setShowPreviewReadyBadge(false);
            dispatch({ type: "SET_LOADING", isLoading: true });
            const lastProgressEvent = data.activityEvents
              ? [...data.activityEvents].reverse().find((e: DBActivityEvent) => e.type === "progress" || e.type === "tool_use")
              : null;
            dispatch({ type: "SET_STATUS", statusMessage: lastProgressEvent?.message || "Running..." });
          }
        }
      })
      .catch((error) => { console.error("Failed to load session messages:", error); })
      .finally(() => { if (!cancelled) dispatch({ type: "SET_LOADING_MESSAGES", isLoadingMessages: false }); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Polling loop for local DB changes.
  useEffect(() => {
    if (!sessionId) return;

    const doRefetch = async () => {
      try {
        const response = await fetch(`/api/sessions/${sessionId}/messages`);
        if (!response.ok) return;

        const data = (await response.json()) as SessionMessagesResponse;
        applyFetchedSessionData(data, { preserveExistingArtifacts: true });
        const runStillActive = Boolean(
          data.activeRun &&
          (data.activeRun.status === "running" || data.activeRun.status === "queued"),
        );

        if (data.session.last_video_url) {
          const fullChanged = data.session.last_video_url !== videoUrlRef.current;
          const newBase = data.session.last_video_url.split('?')[0];
          const baseChanged = newBase !== videoUrlBaseRef.current;
          const previewChanged = baseChanged || fullChanged;
          const hasPendingStream = Boolean(abortControllerRef.current);
          videoUrlRef.current = data.session.last_video_url;
          videoUrlBaseRef.current = newBase;
          // Polling remains the fallback path, but completed runs should still reconcile
          // even if a backgrounded tab has not drained the streaming response yet.
          if (
            shouldAcceptPolledPreviewUpdate({
              hasPendingStream,
              runStillActive,
            })
          ) {
            dispatch({
              type: "SET_VIDEO_URL",
              url: data.session.last_video_url,
              bumpNonce: previewChanged,
            });
            if (previewChanged && !runStillActive) {
              showPendingPreviewReadyBadge();
            }
          }
          if (
            shouldAbortLingeringPreviewStream({
              hasPendingStream,
              runStillActive,
              previewChanged,
            })
          ) {
            abortControllerRef.current?.abort();
          }
        }

        const newSandboxId = data.activeRun?.sandbox_id || data.session.sandbox_id;
        const newClaudeSessionId = data.activeRun?.claude_session_id || data.session.claude_session_id;
        if (newSandboxId || newClaudeSessionId) {
          dispatch({ type: "SET_SESSION", sandboxId: newSandboxId || undefined, claudeSessionId: newClaudeSessionId || undefined });
        }

        // Activate sandbox if an active run is detected (sandbox is already in use)
        if (runStillActive) {
          expectedPreviewNonceRef.current = videoUpdateNonceRef.current + 1;
          setShowPreviewReadyBadge(false);
        }

        const trackedRunId = reconnectedRunIdRef.current;
        if (trackedRunId) {
          const runFinished = !data.activeRun || data.activeRun.status === "completed" || data.activeRun.status === "failed" || data.activeRun.status === "canceled";
          if (runFinished) {
            reconnectedRunIdRef.current = null;
            dispatch({ type: "SET_LOADING", isLoading: false });
            dispatch({ type: "SET_STATUS", statusMessage: null });
          } else {
            const events = data.activityEvents || [];
            const lastProgress = [...events].reverse().find((e: DBActivityEvent) => e.type === "progress" || e.type === "tool_use");
            if (lastProgress?.message) dispatch({ type: "SET_STATUS", statusMessage: lastProgress.message });
          }
        }
      } catch (error) { console.error("[ChatPanel] Failed to refetch data:", error); }
    };

    // Run once immediately, then keep polling for reconnection state + background updates.
    doRefetch();
    const poller = setInterval(doRefetch, 2000);

    return () => {
      clearInterval(poller);
    };
  }, [sessionId, router, applyFetchedSessionData, showPendingPreviewReadyBadge]);

  const addActivity = useCallback((event: Omit<ActivityEvent, "id" | "timestamp">, turnId?: string) => {
    dispatch({ type: "ADD_ACTIVITY", event: { ...event, id: crypto.randomUUID(), timestamp: new Date(), turnId } });
  }, []);

  const handleSend = useCallback(async (prompt: string, images?: File[]) => {
    const currentSandboxId = sandboxIdRef.current;
    const currentClaudeSessionId = claudeSessionIdRef.current;
    const turnId = crypto.randomUUID();

    const imagePreviewAttachments: ImageAttachment[] | undefined = images?.map((file) => ({
      id: crypto.randomUUID(), path: "", name: file.name, size: file.size, type: file.type, url: URL.createObjectURL(file),
    }));

    if (prompt.trim() || (images && images.length > 0)) {
      dispatch({ type: "ADD_USER_MESSAGE", message: { id: turnId, role: "user", content: prompt, images: imagePreviewAttachments } });
    }

    expectedPreviewNonceRef.current = videoUpdateNonceRef.current + 1;
    setShowPreviewReadyBadge(false);
    dispatch({ type: "SET_LOADING", isLoading: true });
    dispatch({ type: "SET_CANCELLING", isCancelling: false });
    dispatch({ type: "SET_STATUS", statusMessage: "Connecting..." });

    const assistantMessageId = crypto.randomUUID();
    currentAssistantMessageIdRef.current = assistantMessageId;

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const activeSessionId = sessionId;
    if (!activeSessionId) {
      expectedPreviewNonceRef.current = null;
      dispatch({ type: "SET_LOADING", isLoading: false });
      dispatch({ type: "SET_STATUS", statusMessage: null });
      dispatch({ type: "UPDATE_ASSISTANT_MESSAGE", id: assistantMessageId, content: "No active session.", isError: true });
      abortControllerRef.current = null;
      return;
    }

    try {
      let uploadedImages: ImageAttachment[] | undefined;
      if (images && images.length > 0 && activeSessionId) {
        try {
          const formData = new FormData();
          formData.append("session_id", activeSessionId);
          for (const file of images) formData.append("images", file);
          const uploadResponse = await fetch("/api/chat/uploads", { method: "POST", body: formData });
          if (!uploadResponse.ok) {
            throw new Error(await readUploadErrorResponse(uploadResponse, "Upload failed"));
          }
          const uploadData = await uploadResponse.json().catch(() => null) as { images?: ImageAttachment[] } | null;
          if (!uploadData || !Array.isArray(uploadData.images)) {
            throw new Error("Upload response was invalid");
          }
          uploadedImages = uploadData.images;
        } catch (uploadError) {
          console.error("Failed to upload attachments:", uploadError);
          expectedPreviewNonceRef.current = null;
          dispatch({ type: "UPDATE_ASSISTANT_MESSAGE", id: assistantMessageId, content: `Attachment upload failed: ${uploadError instanceof Error ? uploadError.message : "Unknown error"}`, isError: true });
          dispatch({ type: "SET_LOADING", isLoading: false });
          dispatch({ type: "SET_STATUS", statusMessage: null });
          abortControllerRef.current = null;
          return;
        }
      }

      const body: Record<string, unknown> = { prompt, model: state.model };
      if (uploadedImages && uploadedImages.length > 0) body.images = uploadedImages;
      body.session_id = activeSessionId;
      const isNewSession = !sessionId;
      if (!isNewSession && currentSandboxId) body.sandbox_id = currentSandboxId;
      if (!isNewSession && currentClaudeSessionId) body.claude_session_id = currentClaudeSessionId;

      // Wait for optimistic session creation (already has 15s abort timeout).
      if (sessionReady && !(await sessionReady)) {
        expectedPreviewNonceRef.current = null;
        dispatch({ type: "UPDATE_ASSISTANT_MESSAGE", id: assistantMessageId, content: "Failed to create session. Please try again.", isError: true });
        dispatch({ type: "SET_LOADING", isLoading: false });
        dispatch({ type: "SET_STATUS", statusMessage: null });
        abortControllerRef.current = null;
        return;
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) throw new Error(`HTTP error: ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let lastState: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;

          const dataPayload = line.slice(5).trimStart();
          let event: SSEEvent;
          try {
            event = JSON.parse(dataPayload);
          } catch {
            continue;
          }

          try {

            if (event.sandbox_id) dispatch({ type: "SET_SESSION", sandboxId: event.sandbox_id });
            if (event.claude_session_id) dispatch({ type: "SET_SESSION", claudeSessionId: event.claude_session_id });

            if (event.type === "system_init") {
              addActivity({
                type: "system_init",
                message: event.message,
                model: event.model,
                tools: event.tools,
                sandboxSource: event.sandbox_source,
                timeoutMinutes: event.timeout_minutes,
                timeoutMs: event.timeout_ms,
                commandStartedAt: event.command_started_at,
                commandDeadlineAt: event.command_deadline_at,
              }, turnId);
            } else if (event.type === "assistant_text") {
              addActivity({ type: "assistant_text", message: event.message }, turnId);
            } else if (event.type === "tool_use") {
              addActivity({ type: "tool_use", message: event.message, toolName: event.tool_name, toolInput: event.tool_input }, turnId);

              const toolInput = event.tool_input as { file_path?: string; content?: string } | undefined;
              const filePath = toolInput?.file_path || "";
              const artifactType = resolveArtifactType(filePath);
              if (event.tool_name === "Write" && toolInput?.content) {
                if (artifactType === "plan") dispatch({ type: "SET_PLAN_CONTENT", content: toolInput.content });
                else if (artifactType === "script") dispatch({ type: "SET_SCRIPT_CONTENT", content: toolInput.content });
              } else if (event.tool_name === "Edit" && artifactType) {
                const sid = event.sandbox_id || sandboxIdRef.current;
                if (sid) {
                  const capturedSid = sid;
                  fetch(`/api/files?sandbox_id=${encodeURIComponent(sid)}&path=${encodeURIComponent(filePath)}`)
                    .then(r => r.ok ? r.text() : null)
                    .then(text => {
                      if (text !== null && sandboxIdRef.current === capturedSid) {
                        if (artifactType === "plan") dispatch({ type: "SET_PLAN_CONTENT", content: text });
                        else dispatch({ type: "SET_SCRIPT_CONTENT", content: text });
                      }
                    })
                    .catch(() => {});
                }
              }
            } else if (event.type === "tool_result") {
              const toolOutput =
                typeof event.tool_result === "string" && event.tool_result.trim()
                  ? event.tool_result
                  : event.message;
              addActivity({ type: "tool_result", message: toolOutput, toolResult: event.tool_result, isError: event.is_error }, turnId);
            }

            if (event.type === "progress") {
              const statusMessages: Record<string, string> = {
                planning: "Planning...",
                coding: "Writing code...",
                rendering: event.progress !== undefined ? `Rendering video... ${event.progress}%` : "Rendering video...",
              };
              const status = event.state ? (statusMessages[event.state] || event.message) : event.message;
              dispatch({ type: "SET_STATUS", statusMessage: status });
              addActivity({ type: "progress", message: event.message }, turnId);
              lastState = event.state || lastState;
            } else if (event.type === "complete") {
              dispatch({ type: "SET_STATUS", statusMessage: null });
              addActivity({
                type: "complete",
                message: event.message || "Complete",
                terminalStatus: event.terminal_status,
              }, turnId);
              if (event.video_url) {
                videoUrlRef.current = event.video_url;
                videoUrlBaseRef.current = event.video_url.split('?')[0];
                dispatch({ type: "SET_VIDEO_URL", url: event.video_url, bumpNonce: true });
                showPendingPreviewReadyBadge();
              } else {
                expectedPreviewNonceRef.current = null;
              }
              await reader.cancel();
            } else if (event.type === "error") {
              expectedPreviewNonceRef.current = null;
              dispatch({ type: "SET_STATUS", statusMessage: null });
              addActivity({
                type: "error",
                message: event.message,
                isError: true,
                errorCode: event.error_code,
                timeoutMinutes: event.timeout_minutes,
                timeoutMs: event.timeout_ms,
                elapsedMs: event.elapsed_ms,
                commandStartedAt: event.command_started_at,
                commandDeadlineAt: event.command_deadline_at,
              }, turnId);
              dispatch({ type: "UPDATE_ASSISTANT_MESSAGE", id: assistantMessageId, content: event.message, isError: true });
              await reader.cancel();
            }
          } catch (eventError) {
            console.error("[ChatPanel] Failed to process SSE event:", eventError, { dataPayload });
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      expectedPreviewNonceRef.current = null;
      const errorMessage = error instanceof Error ? error.message : "An error occurred";
      dispatch({ type: "UPDATE_ASSISTANT_MESSAGE", id: assistantMessageId, content: errorMessage, isError: true });
    } finally {
      dispatch({ type: "SET_LOADING", isLoading: false });
      dispatch({ type: "SET_STATUS", statusMessage: null });
      abortControllerRef.current = null;
      currentAssistantMessageIdRef.current = null;
    }
  }, [addActivity, sessionId, state.model, sessionReady, aspectRatio, resolveArtifactType, showPendingPreviewReadyBadge]);

  // Auto-send pending welcome payload when a new session loads
  const welcomeSentRef = useRef(false);
  useLayoutEffect(() => {
    if (!sessionId || welcomeSentRef.current) return;
    const pending = consumeWelcomePayload?.(sessionId);
    if (!pending) return;
    welcomeSentRef.current = true;
    void handleSend(pending.prompt, pending.images);
  }, [sessionId, handleSend, consumeWelcomePayload]);

  const handleCancel = useCallback(async () => {
    if (!state.isLoading || state.isCancelling) return;

    const assistantMessageId = currentAssistantMessageIdRef.current;
    dispatch({ type: "SET_CANCELLING", isCancelling: true });
    dispatch({ type: "SET_STATUS", statusMessage: "Cancelling..." });

    if (assistantMessageId) {
      dispatch({ type: "UPDATE_ASSISTANT_MESSAGE", id: assistantMessageId, content: "Cancelled by user" });
    }

    const currentSessionId = sessionId;
    const currentSandboxId = sandboxIdRef.current;
    if (currentSandboxId || currentSessionId) {
      try {
        await fetch("/api/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(currentSandboxId ? { sandbox_id: currentSandboxId } : {}),
            ...(currentSessionId ? { session_id: currentSessionId } : {}),
          }),
        });
      } catch { /* Ignore cancel API errors */ }
    }
    addActivity({ type: "complete", message: "Stopped by user", terminalStatus: "canceled" });

    expectedPreviewNonceRef.current = null;
    setShowPreviewReadyBadge(false);
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;

    reconnectedRunIdRef.current = null;
    dispatch({ type: "SET_LOADING", isLoading: false });
    dispatch({ type: "SET_CANCELLING", isCancelling: false });
    dispatch({ type: "SET_STATUS", statusMessage: null });
  }, [addActivity, sessionId, state.isLoading, state.isCancelling]);

  const handleRequestHqRender = useCallback(() => {
    if (state.isLoading) return false;
    void handleSend("render in 1080@30fps");
    return true;
  }, [handleSend, state.isLoading]);

  const handleRequest4kRender = useCallback(() => {
    if (state.isLoading) return false;
    void handleSend("render in 4k@30fps");
    return true;
  }, [handleSend, state.isLoading]);

  const hasArtifacts = !!(state.planContent || state.scriptContent || state.videoUrl);
  const [mobileArtifactOpen, setMobileArtifactOpen] = useState(false);

  // Auto-open artifact overlay on mobile when video first arrives
  const prevVideoUrl = useRef(state.videoUrl);
  useEffect(() => {
    if (isMobile && state.videoUrl && !prevVideoUrl.current) {
      setMobileArtifactOpen(true);
    }
    prevVideoUrl.current = state.videoUrl;
  }, [isMobile, state.videoUrl]);

  // Determine artifact label for the compact card
  const artifactLabel = state.videoUrl ? "Animation preview" : state.scriptContent ? "Script" : "Plan";

  // Shared PreviewPanel element — reused in desktop split and mobile preview mode
  const previewPanel = (
    <PreviewPanel
      key={sessionId || 'no-session'}
      videoUrl={state.videoUrl}
      videoUpdateNonce={state.videoUpdateNonce}
      sandboxId={state.sandboxId}
      sessionId={sessionId}
      planContent={state.planContent}
      scriptContent={state.scriptContent}
      sessionModel={state.model}
      isRendering={state.isLoading}
      onRequestHqRender={handleRequestHqRender}
      onRequest4kRender={handleRequest4kRender}
      onPreviewReady={handlePreviewReady}
    />
  );

  // When we have artifacts, show split layout (desktop) or chat + overlay (mobile)
  if (hasArtifacts && !isMobile) {
    return (
      <SplitPanel
        leftPanel={
          <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-main)" }}>
            <ChatMessages messages={state.messages} activityEvents={state.activityEvents} isLoading={state.isLoading} isLoadingMessages={state.isLoadingMessages} />
            <ChatInput
              onSend={handleSend}
              onStop={handleCancel}
              isLoading={state.isLoading}
              draftKey={draftKey}
            />
          </div>
        }
        rightPanel={previewPanel}
        defaultLeftWidth={40}
        minLeftWidth={25}
        maxLeftWidth={75}
      />
    );
  }

  // Mobile (with or without artifacts) + desktop no-artifacts: full-width chat
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--bg-main)", position: "relative", minHeight: 0 }}>
      {isMobile && mobileArtifactOpen ? (
        /* Mobile preview mode: preview takes most of screen, chat input pinned at bottom */
        <>
          {/* Back to chat button */}
          <div style={{ display: "flex", alignItems: "center", padding: "4px 12px", flexShrink: 0 }}>
            <button
              onClick={() => setMobileArtifactOpen(false)}
              style={{
                display: "flex", alignItems: "center", gap: 4,
                padding: "4px 8px", borderRadius: 6,
                border: "none", background: "var(--bg-hover)",
                color: "var(--text-secondary)", cursor: "pointer",
                fontSize: 12, fontFamily: "var(--font)",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Back to chat
            </button>
          </div>

          <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>{previewPanel}</div>

          <ChatInput
            onSend={handleSend}
            onStop={handleCancel}
            isLoading={state.isLoading}
            compact
            draftKey={draftKey}
          />
        </>
      ) : (
        /* Normal chat mode (mobile without preview open, or desktop) */
        <div style={{ flex: 1, display: "flex", justifyContent: "center", overflow: "hidden", minHeight: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", width: "100%", maxWidth: isMobile ? "100%" : 720, height: "100%", minHeight: 0 }}>
            <ChatMessages messages={state.messages} activityEvents={state.activityEvents} isLoading={state.isLoading} isLoadingMessages={state.isLoadingMessages} />

            {/* Artifact card — tap to open preview */}
            {isMobile && hasArtifacts && !mobileArtifactOpen && (
              <button
                onClick={() => setMobileArtifactOpen(true)}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  margin: "0 16px 8px",
                  padding: "10px 14px",
                  borderRadius: 12,
                  border: "1px solid var(--border-main)",
                  background: "var(--bg-white)",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                  cursor: "pointer",
                  fontFamily: "var(--font)",
                  textAlign: "left",
                }}
              >
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: "var(--accent-muted)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  {state.videoUrl ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth={2}>
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth={2}>
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-primary)" }}>{artifactLabel}</div>
                  <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>Tap to open</div>
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            )}

            <ChatInput
              onSend={handleSend}
              onStop={handleCancel}
              isLoading={state.isLoading}
              compact={isMobile}
              draftKey={draftKey}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function HomeContent({ initialCloudAuthStatus }: { initialCloudAuthStatus: CloudAuthStatus }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [aspectRatio, setAspectRatio] = usePreferredAspectRatio();
  const [brandKit, setBrandKit, brandKitEnabled, setBrandKitEnabled] = useBrandKit();
  const {
    cloudAuthStatus,
    cloudAuthLoading,
    reconnectCloudAuth,
  } = useStudioCloudAuth(initialCloudAuthStatus);
  const searchParamsString = searchParams.toString();

  const activeSessionId = searchParams.get("session");
  const activeView = searchParams.get("view");
  const feedbackSessionId = searchParams.get("feedback_session");
  const isLibraryActive = !activeSessionId && activeView === "library";
  const isFeedbackActive = !activeSessionId && activeView === "feedback";
  const launchIntent = useMemo(() => {
    if (activeSessionId) return null;
    return parseUrlLaunchIntent(searchParamsString);
  }, [activeSessionId, searchParamsString]);
  useEffect(() => {
    if (isMobile) return;
    setSidebarCollapsed(Boolean(activeSessionId));
  }, [activeSessionId, isMobile]);

  // Optimistic session creation: keyed by session ID, stores Promise<boolean>
  const sessionCreationRef = useRef<{ id: string; ready: Promise<boolean> } | null>(null);
  const [pendingSessionReady, setPendingSessionReady] = useState<{ id: string; ready: Promise<boolean> } | null>(null);
  const pendingWelcomePayloadRef = useRef<Map<string, { prompt: string; images?: File[] }>>(new Map());
  const appliedLaunchAspectRef = useRef<string | null>(null);
  const consumedLaunchAutoSendRef = useRef<string | null>(null);

  const handleNewSession = useCallback(() => { router.push("/"); }, [router]);

  const handleSessionSelect = useCallback((sessionId: string) => {
    router.push(`/?session=${sessionId}`);
  }, [router]);

  const handleLibraryClick = useCallback(() => {
    router.push("/?view=library");
  }, [router]);

  const handleFeedbackClick = useCallback(() => {
    const nextUrl = activeSessionId
      ? `/?view=feedback&feedback_session=${encodeURIComponent(activeSessionId)}`
      : "/?view=feedback";
    router.push(nextUrl);
  }, [activeSessionId, router]);

  const handleToggleSidebar = useCallback(() => {
    if (isMobile) {
      setMobileSidebarOpen(prev => !prev);
    } else {
      setSidebarCollapsed(prev => !prev);
    }
  }, [isMobile]);

  // Prewarm sandbox when user starts typing (guard in ChatInput prevents duplicates)
  const handlePrewarm = useCallback(() => {
    fetch("/api/sandbox/prewarm", { method: "POST" }).catch(() => {});
  }, []);

  const hasPendingWelcomePayload = useCallback((sessionId: string) => {
    return pendingWelcomePayloadRef.current.has(sessionId);
  }, []);

  const consumeWelcomePayload = useCallback((sessionId: string) => {
    const payload = pendingWelcomePayloadRef.current.get(sessionId);
    if (!payload) return null;
    pendingWelcomePayloadRef.current.delete(sessionId);
    return payload;
  }, []);

  const handleWelcomeSend = useCallback((prompt: string, images?: File[], model?: string, voice?: string, ratioOverride?: AspectRatio) => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt && (!images || images.length === 0)) return;
    if (sessionCreationRef.current) return; // prevent double-submit

    const promptWithBrandGuideline = `${trimmedPrompt}${brandKitEnabled ? buildBrandGuideline(brandKit) : ""}`.trim();
    const id = crypto.randomUUID();
    pendingWelcomePayloadRef.current.set(id, { prompt: promptWithBrandGuideline, images });

    // Fire session creation in background; resolve to boolean for ChatPanel.
    // Timeout prevents indefinite stall on cold start / slow network.
    const abortCtl = new AbortController();
    const timeout = setTimeout(() => abortCtl.abort(), 15_000);
    const ready = fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id, model,
        ...(voice ? { voice_id: voice } : {}),
        aspect_ratio: ratioOverride ?? aspectRatio,
      }),
      signal: abortCtl.signal,
    }).then(r => r.ok).catch(() => false as const).then((ok) => {
      if (!ok) {
        pendingWelcomePayloadRef.current.delete(id);
      }
      return ok;
    }).finally(() => {
      clearTimeout(timeout);
      sessionCreationRef.current = null;
    });
    sessionCreationRef.current = { id, ready };
    setPendingSessionReady({ id, ready });

    // Navigate immediately — user sees their message + "Working..." without waiting
    router.push(`/?session=${id}`);
  }, [router, aspectRatio, brandKit]);

  // Determine UX stage
  const isWelcome = !activeSessionId && !isLibraryActive && !isFeedbackActive;

  useEffect(() => {
    if (isWelcome) return;
    appliedLaunchAspectRef.current = null;
    consumedLaunchAutoSendRef.current = null;
  }, [isWelcome]);

  // Apply deep-link aspect ratio once per URL in welcome mode.
  useEffect(() => {
    if (!isWelcome || !launchIntent?.aspectRatio) return;
    if (appliedLaunchAspectRef.current === searchParamsString) return;
    appliedLaunchAspectRef.current = searchParamsString;
    setAspectRatio(launchIntent.aspectRatio);
  }, [isWelcome, launchIntent?.aspectRatio, searchParamsString, setAspectRatio]);

  // Optional deep-link auto-send: /?prompt=...&send=1
  useEffect(() => {
    if (!isWelcome || !launchIntent || !launchIntent.autoSend) return;
    const key = `auto:${searchParamsString}`;
    if (consumedLaunchAutoSendRef.current === key) return;
    consumedLaunchAutoSendRef.current = key;
    handleWelcomeSend(
      launchIntent.prompt,
      undefined,
      launchIntent.model,
      launchIntent.voiceId,
      launchIntent.aspectRatio,
    );
  }, [isWelcome, launchIntent, searchParamsString, handleWelcomeSend]);

  // Close mobile sidebar when navigating to a session
  const handleMobileSessionSelect = useCallback((sessionId: string) => {
    setMobileSidebarOpen(false);
    handleSessionSelect(sessionId);
  }, [handleSessionSelect]);

  const handleMobileNewSession = useCallback(() => {
    setMobileSidebarOpen(false);
    handleNewSession();
  }, [handleNewSession]);

  const handleMobileLibraryClick = useCallback(() => {
    setMobileSidebarOpen(false);
    handleLibraryClick();
  }, [handleLibraryClick]);

  const handleMobileFeedbackClick = useCallback(() => {
    setMobileSidebarOpen(false);
    handleFeedbackClick();
  }, [handleFeedbackClick]);

  if (cloudAuthStatus.status !== "connected") {
    return (
      <CloudAuthGate
        isLoading={cloudAuthLoading}
        status={cloudAuthStatus}
        onRetry={reconnectCloudAuth}
      />
    );
  }

  return (
    <div style={{ display: "flex", height: "100dvh", overflow: "hidden" }}>
      {/* Sidebar - overlay on mobile, inline on desktop */}
      {isMobile ? (
        <>
          {/* Backdrop */}
          {mobileSidebarOpen && (
            <div
              onClick={() => setMobileSidebarOpen(false)}
              style={{
                position: "fixed", inset: 0,
                background: "rgba(0,0,0,0.3)",
                zIndex: 49,
              }}
            />
          )}
          {/* Drawer */}
          <div style={{
            position: "fixed", top: 0, left: 0, bottom: 0,
            width: 280,
            zIndex: 50,
            transform: mobileSidebarOpen ? "translateX(0)" : "translateX(-100%)",
            transition: "transform 250ms ease-in-out",
          }}>
            <SessionsSidebar
              activeSessionId={activeSessionId}
              onSessionSelect={handleMobileSessionSelect}
              onNewSession={handleMobileNewSession}
              isCollapsed={false}
              onToggleCollapse={() => setMobileSidebarOpen(false)}
              isLibraryActive={isLibraryActive}
              isFeedbackActive={isFeedbackActive}
              onLibraryClick={handleMobileLibraryClick}
              onFeedbackClick={handleMobileFeedbackClick}
              cloudAuthStatus={cloudAuthStatus}
              onStudioCloudReconnect={reconnectCloudAuth}
            />
          </div>
        </>
      ) : (
        <div style={{
          width: sidebarCollapsed ? 52 : 260,
          flexShrink: 0,
          transition: "width 200ms ease-in-out",
        }}>
          <SessionsSidebar
            activeSessionId={activeSessionId}
            onSessionSelect={handleSessionSelect}
            onNewSession={handleNewSession}
            isCollapsed={sidebarCollapsed}
            onToggleCollapse={handleToggleSidebar}
            isLibraryActive={isLibraryActive}
            isFeedbackActive={isFeedbackActive}
            onLibraryClick={handleLibraryClick}
            onFeedbackClick={handleFeedbackClick}
            cloudAuthStatus={cloudAuthStatus}
            onStudioCloudReconnect={reconnectCloudAuth}
          />
        </div>
      )}

      {/* Main Content */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {/* Mobile top bar */}
        {isMobile && (
          <div style={{
            display: "flex", alignItems: "center",
            padding: "10px 16px",
            gap: 12,
            flexShrink: 0,
          }}>
            <button
              onClick={() => setMobileSidebarOpen(true)}
              style={{
                width: 36, height: 36,
                borderRadius: 8, border: "none",
                background: "transparent",
                color: "var(--icon-secondary)",
                cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
            <span style={{
              fontSize: 17, fontWeight: 400,
              fontFamily: "var(--font-display)",
              color: "var(--text-primary)",
              display: "flex", alignItems: "center", gap: 5,
            }}>
              <span style={{ fontSize: 20, fontFamily: "'Computer Modern', 'Latin Modern Math', 'STIX Two Math', serif", color: "var(--accent)" }}>∑</span>
              Manimate
            </span>
            <div style={{ flex: 1 }} />
          </div>
        )}

        {isLibraryActive || isFeedbackActive ? (
          <LibraryView
            mode={isFeedbackActive ? "feedback" : "videos"}
            initialSelectedSessionId={isFeedbackActive ? feedbackSessionId : null}
            onSessionSelect={handleSessionSelect}
          />
        ) : isWelcome ? (
          <WelcomeView
            onSend={handleWelcomeSend}
            onPrewarm={handlePrewarm}
            aspectRatio={aspectRatio}
            onAspectRatioChange={setAspectRatio}
            isMobile={isMobile}
            initialPrompt={launchIntent?.prompt}
            initialModel={launchIntent?.model}
            initialVoice={launchIntent?.voiceId}
            brandKit={brandKit}
            onBrandKitChange={setBrandKit}
            brandKitEnabled={brandKitEnabled}
            onToggleBrandKitEnabled={setBrandKitEnabled}
          />
        ) : (
          <ChatPanel
            key={activeSessionId}
            sessionId={activeSessionId}
            aspectRatio={aspectRatio}
            onSessionAspectRatio={setAspectRatio}
            hasPendingWelcomePayload={hasPendingWelcomePayload}
            consumeWelcomePayload={consumeWelcomePayload}
            isMobile={isMobile}
            sessionReady={
              pendingSessionReady?.id === activeSessionId
                ? pendingSessionReady.ready
                : null
            }
          />
        )}
      </div>
    </div>
  );
}

// Welcome page component
function WelcomeView({
  onSend,
  onPrewarm,
  aspectRatio,
  onAspectRatioChange,
  isMobile = false,
  initialPrompt,
  initialModel,
  initialVoice,
  brandKit,
  onBrandKitChange,
  brandKitEnabled = true,
  onToggleBrandKitEnabled,
}: {
  onSend: (prompt: string, images?: File[], model?: string, voice?: string, ratioOverride?: AspectRatio) => void;
  onPrewarm?: () => void;
  aspectRatio: AspectRatio;
  onAspectRatioChange: (ratio: AspectRatio) => void;
  isMobile?: boolean;
  initialPrompt?: string;
  initialModel?: string;
  initialVoice?: string;
  brandKit?: BrandKit | null;
  onBrandKitChange?: (kit: BrandKit | null) => void;
  brandKitEnabled?: boolean;
  onToggleBrandKitEnabled?: (v: boolean) => void;
}) {
  const [model, setModel] = usePreferredModel();
  const [voice, setVoice] = usePreferredVoice();
  const appliedInitialModelRef = useRef<string | null>(null);
  const appliedInitialVoiceRef = useRef<string | null>(null);

  useEffect(() => {
    if (!initialModel) return;
    if (appliedInitialModelRef.current === initialModel) return;
    appliedInitialModelRef.current = initialModel;
    setModel(initialModel);
  }, [initialModel, setModel]);

  useEffect(() => {
    if (!initialVoice) return;
    if (appliedInitialVoiceRef.current === initialVoice) return;
    appliedInitialVoiceRef.current = initialVoice;
    setVoice(initialVoice);
  }, [initialVoice, setVoice]);

  const handleSend = useCallback((prompt: string, images?: File[]) => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt && (!images || images.length === 0)) return;
    onSend(trimmedPrompt, images, model, voice);
  }, [model, voice, onSend]);

  return (
    <div style={{
      flex: 1,
      display: "flex", flexDirection: "column",
      alignItems: "center",
      background: "var(--bg-main)",
      padding: isMobile ? "20px 16px" : 40,
    }}>
      <div style={{ flex: 1 }} />

      <div style={{ marginBottom: 20 }}>
        <StudioPlanPill />
      </div>

      <div style={{
        fontSize: isMobile ? 26 : 36, fontWeight: 400,
        fontFamily: "var(--font-display)",
        color: "var(--text-primary)",
        marginBottom: isMobile ? 20 : 32,
        letterSpacing: -0.3,
        textAlign: "center",
      }}>
        What can I animate for you?
      </div>

      <div style={{ width: "100%", maxWidth: isMobile ? "100%" : 620 }}>
        <ChatInput
          onSend={handleSend}
          onPrewarm={onPrewarm}
          placeholder="Describe a math concept to animate..."
          draftKey="chat-draft:welcome"
          initialPrompt={initialPrompt}
          extraLeft={
            <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 4 : 6, flexWrap: "wrap" }}>
              <ModelSelector model={model} onChange={setModel} />
              <VoiceSelector voice={voice} onChange={setVoice} />
              <AspectRatioSelector ratio={aspectRatio} onChange={onAspectRatioChange} />
              <BrandKitSelector kit={brandKit ?? null} onChange={onBrandKitChange ?? (() => {})} enabled={brandKitEnabled} onToggleEnabled={onToggleBrandKitEnabled ?? (() => {})} />
            </div>
          }
        />
      </div>

      <div style={{ flex: 1 }} />
    </div>
  );
}

export default function HomeClient({ initialCloudAuthStatus }: { initialCloudAuthStatus: CloudAuthStatus }) {
  return (
    <Suspense fallback={
      <div style={{ display: "flex", height: "100vh", alignItems: "center", justifyContent: "center" }}>
        <div style={{
          width: 32, height: 32,
          borderRadius: "50%",
          border: "2px solid var(--border-input)",
          borderTopColor: "var(--accent)",
          animation: "spin 1s linear infinite",
        }} />
      </div>
    }>
      <HomeContent initialCloudAuthStatus={initialCloudAuthStatus} />
    </Suspense>
  );
}
