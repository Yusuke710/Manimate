"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ASPECT_RATIO_OPTIONS,
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  getModelDisplayLabel,
  isRegisteredModelId,
  type AspectRatio,
} from "@/lib/models";
import {
  AVAILABLE_VOICES,
  DEFAULT_VOICE_ID,
  NONE_VOICE_ID,
  getVoicePageUrl,
  isValidVoiceId,
} from "@/lib/voices";

const MODEL_PREF_KEY = "manimate-preferred-model";
const VOICE_PREF_KEY = "manimate-preferred-voice";
const VOICE_NAMES_KEY = "manimate-voice-names";
const ELEVENLABS_SETTINGS_ENDPOINT = "/api/settings/elevenlabs";

export function usePreferredModel() {
  const [model, setModel] = useState(DEFAULT_MODEL);

  useEffect(() => {
    let timer: number | null = null;
    try {
      const saved = localStorage.getItem(MODEL_PREF_KEY);
      if (saved && isRegisteredModelId(saved)) {
        timer = window.setTimeout(() => setModel(saved), 0);
      } else if (saved) {
        localStorage.setItem(MODEL_PREF_KEY, DEFAULT_MODEL);
      }
    } catch {}
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  const set = useCallback((m: string) => {
    const nextModel = isRegisteredModelId(m) ? m : DEFAULT_MODEL;
    setModel(nextModel);
    try { localStorage.setItem(MODEL_PREF_KEY, nextModel); } catch {}
  }, []);
  return [model, set] as const;
}

/**
 * Read-only model indicator for sessions that already have a conversation.
 * The model is fixed per session (switch via Handoff), so this is a fact
 * badge, not a control: no button semantics, no chevron, muted styling —
 * deliberately distinct from a disabled selector, which would read as a bug.
 */
function ModelBadge({ model }: { model: string }) {
  return (
    <div
      title={`This session runs on ${getModelDisplayLabel(model)}. The model is fixed per session — use Handoff to continue with another model in a new session.`}
      style={{
        display: "flex", alignItems: "center", gap: 5,
        background: "var(--bg-subtle, var(--bg-white))",
        border: "1px dashed var(--border-main)",
        borderRadius: 20,
        padding: "4px 10px",
        cursor: "default",
        fontFamily: "var(--font)",
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
      </svg>
      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>
        {getModelDisplayLabel(model)}
      </span>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    </div>
  );
}

export function ModelSelector({ model, onChange, disabled }: { model: string; onChange: (model: string) => void; disabled?: boolean }) {
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
          padding: "4px 10px",
          cursor: disabled || AVAILABLE_MODELS.length <= 1 ? "default" : "pointer",
          fontFamily: "var(--font)",
          transition: "border-color 0.12s",
        }}
      >
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
                display: "flex", alignItems: "center",
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

// Aspect ratio selector dropdown
export function AspectRatioSelector({ ratio, onChange, disabled }: { ratio: AspectRatio; onChange: (ratio: AspectRatio) => void; disabled?: boolean }) {
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

export function usePreferredVoice() {
  const [voice, setVoice] = useState(DEFAULT_VOICE_ID);

  useEffect(() => {
    let timer: number | null = null;
    try {
      const saved = localStorage.getItem(VOICE_PREF_KEY);
      if (saved && isValidVoiceId(saved)) {
        timer = window.setTimeout(() => setVoice(saved), 0);
      } else if (saved) {
        localStorage.setItem(VOICE_PREF_KEY, DEFAULT_VOICE_ID);
      }
    } catch {}
    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  const set = useCallback((v: string) => {
    const nextVoice = isValidVoiceId(v) ? v : DEFAULT_VOICE_ID;
    setVoice(nextVoice);
    try { localStorage.setItem(VOICE_PREF_KEY, nextVoice); } catch {}
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
    return "Only needed for legacy ElevenLabs voices.";
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

export function VoiceSelector({ voice, onChange, disabled }: { voice: string; onChange: (voice: string) => void; disabled?: boolean }) {
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
                  Legacy ElevenLabs key
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

          {AVAILABLE_VOICES.map((v) => {
            const previewLabel = v.provider === "kokoro" ? "Open Kokoro model page" : `Preview ${v.label} on ElevenLabs`;
            return (
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
                  aria-label={previewLabel}
                  title={previewLabel}
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
            );
          })}

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
            Browse legacy voices ↗
          </a>
        </div>
      )}
    </div>
  );
}

export function ComposerSettingsControls({
  model,
  onModelChange,
  modelLocked,
  voice,
  onVoiceChange,
  aspectRatio,
  onAspectRatioChange,
  disabled,
  compact,
  isMobile,
  hasPendingChange,
}: {
  model: string;
  onModelChange: (model: string) => void;
  modelLocked?: boolean;
  voice: string;
  onVoiceChange: (voice: string) => void;
  aspectRatio: AspectRatio;
  onAspectRatioChange: (ratio: AspectRatio) => void;
  disabled?: boolean;
  compact?: boolean;
  isMobile?: boolean;
  hasPendingChange?: boolean;
}) {
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

  const controls = (
    <>
      {/* The model is fixed per session (switch via Handoff): pickable on the
          first turn, then shown as a read-only fact badge. */}
      {modelLocked
        ? <ModelBadge model={model} />
        : <ModelSelector model={model} onChange={onModelChange} disabled={disabled} />}
      <VoiceSelector voice={voice} onChange={onVoiceChange} disabled={disabled} />
      <AspectRatioSelector ratio={aspectRatio} onChange={onAspectRatioChange} disabled={disabled} />
    </>
  );

  if (!compact) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 4 : 6, flexWrap: "wrap" }}>
        {controls}
      </div>
    );
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        title="Session settings"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: hasPendingChange
            ? "rgba(43,181,160,0.12)"
            : isOpen
              ? "var(--bg-active)"
              : "var(--bg-white)",
          border: hasPendingChange
            ? "1px solid rgba(43,181,160,0.42)"
            : "1px solid var(--border-main)",
          borderRadius: 20,
          padding: "4px 10px",
          cursor: "pointer",
          color: hasPendingChange ? "var(--accent)" : "var(--text-primary)",
          fontFamily: "var(--font)",
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={hasPendingChange ? "var(--accent)" : "var(--text-tertiary)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.2.38.6.61 1 .6h.1a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
        </svg>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Settings</span>
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: 0,
            width: "min(360px, calc(100vw - 32px))",
            padding: 12,
            border: "1px solid var(--border-main)",
            borderRadius: 12,
            background: "var(--bg-white)",
            boxShadow: "0 18px 36px rgba(15,23,42,0.14)",
            zIndex: 70,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {controls}
          </div>
        </div>
      )}
    </div>
  );
}
