"use client";

import { useReducer, useEffect, useCallback, useRef, useState, Suspense, useMemo } from "react";
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
  DEFAULT_ASPECT_RATIO,
  isAspectRatio,
  type AspectRatio,
} from "@/lib/aspect-ratio";
import { parseUrlLaunchIntent } from "@/lib/url-launch-intent";
import {
  shouldAbortLingeringPreviewStream,
  shouldAcceptPolledPreviewUpdate,
  shouldShowBrowserPreviewBadge,
} from "@/lib/preview-load";
import type { CloudAuthStatus } from "@/lib/studio-cloud-auth";
import { useStudioCloudAuth } from "@/lib/useStudioCloudAuth";

const MODEL_PREF_KEY = "manimate-preferred-model";
const VOICE_PREF_KEY = "manimate-preferred-voice";
const VOICE_NAMES_KEY = "manimate-voice-names";
const ASPECT_RATIO_PREF_KEY = "manimate-preferred-aspect-ratio";
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

function usePreferredAspectRatio() {
  const [ratio, setRatio] = useState<AspectRatio>(DEFAULT_ASPECT_RATIO);

  useEffect(() => {
    let timer: number | null = null;
    try {
      const saved = localStorage.getItem(ASPECT_RATIO_PREF_KEY);
      if (isAspectRatio(saved)) {
        timer = window.setTimeout(() => setRatio(saved), 0);
      }
    } catch {}
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  const set = useCallback((r: AspectRatio) => {
    setRatio((prev) => {
      if (prev === r) return prev;
      try { localStorage.setItem(ASPECT_RATIO_PREF_KEY, r); } catch {}
      return r;
    });
  }, []);
  return [ratio, set] as const;
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

function ChatPanel({ sessionId, aspectRatio, onSessionAspectRatio, hasPendingWelcomePayload, consumeWelcomePayload, sessionReady, isMobile = false }: ChatPanelProps) {
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
            const uploadErr = await uploadResponse.json();
            throw new Error(uploadErr.error || "Upload failed");
          }
          const uploadData = await uploadResponse.json();
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

      const body: Record<string, unknown> = { prompt, model: state.model, aspect_ratio: aspectRatio };
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
  useEffect(() => {
    if (!sessionId || welcomeSentRef.current) return;
    const pending = consumeWelcomePayload?.(sessionId);
    if (!pending) return;
    welcomeSentRef.current = true;
    handleSend(pending.prompt, pending.images);
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
    if (state.isLoading) return;
    void handleSend("render in 1080@30fps");
  }, [handleSend, state.isLoading]);

  const handleRequest4kRender = useCallback(() => {
    if (state.isLoading) return;
    void handleSend("render in 4k@30fps");
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
  const {
    cloudAuthStatus,
    cloudAuthLoading,
    reconnectCloudAuth,
  } = useStudioCloudAuth(initialCloudAuthStatus);
  const searchParamsString = searchParams.toString();

  const activeSessionId = searchParams.get("session");
  const activeView = searchParams.get("view");
  const isLibraryActive = !activeSessionId && activeView === "library";
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

    const id = crypto.randomUUID();
    pendingWelcomePayloadRef.current.set(id, { prompt: trimmedPrompt, images });

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
  }, [router, aspectRatio]);

  // Determine UX stage
  const isWelcome = !activeSessionId && !isLibraryActive;

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
              onLibraryClick={handleMobileLibraryClick}
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
            onLibraryClick={handleLibraryClick}
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

        {isLibraryActive ? (
          <LibraryView onSessionSelect={handleSessionSelect} />
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
}: {
  onSend: (prompt: string, images?: File[], model?: string, voice?: string, ratioOverride?: AspectRatio) => void;
  onPrewarm?: () => void;
  aspectRatio: AspectRatio;
  onAspectRatioChange: (ratio: AspectRatio) => void;
  isMobile?: boolean;
  initialPrompt?: string;
  initialModel?: string;
  initialVoice?: string;
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
