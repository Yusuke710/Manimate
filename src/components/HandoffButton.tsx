"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL,
  isRegisteredModelId,
} from "@/lib/models";
import {
  AVAILABLE_VOICES,
  DEFAULT_VOICE_ID,
  NONE_VOICE_ID,
  getVoiceLabel,
  isValidVoiceId,
} from "@/lib/voices";

const MODEL_PREF_KEY = "manimate-preferred-model";
const VOICE_PREF_KEY = "manimate-preferred-voice";

type HandoffState = "idle" | "loading" | "error";

interface HandoffButtonProps {
  sessionId: string | null | undefined;
  hasPlan: boolean;
  hasCode: boolean;
  hasVideo: boolean;
  onCreated: (sessionId: string) => void;
}

type HandoffResponse = {
  session?: { id?: string };
  error?: string;
};

async function requestHandoff(options: {
  sessionId: string;
  model: string;
  voiceId: string;
}): Promise<string> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(options.sessionId)}/handoff`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      voice_id: options.voiceId,
    }),
  });
  const payload = await response.json().catch(() => ({})) as HandoffResponse;

  if (!response.ok || typeof payload.session?.id !== "string") {
    throw new Error(
      typeof payload.error === "string" ? payload.error : "Failed to create handoff",
    );
  }

  return payload.session.id;
}

function getSavedModel(): string {
  try {
    const saved = localStorage.getItem(MODEL_PREF_KEY);
    return saved && isRegisteredModelId(saved) ? saved : DEFAULT_MODEL;
  } catch {
    return DEFAULT_MODEL;
  }
}

function getSavedVoice(): string {
  try {
    const saved = localStorage.getItem(VOICE_PREF_KEY);
    return saved && isValidVoiceId(saved) ? saved : DEFAULT_VOICE_ID;
  } catch {
    return DEFAULT_VOICE_ID;
  }
}

function persistModel(model: string): void {
  try {
    localStorage.setItem(MODEL_PREF_KEY, model);
  } catch {}
}

function persistVoice(voiceId: string): void {
  try {
    localStorage.setItem(VOICE_PREF_KEY, voiceId);
  } catch {}
}

function IncludedRow({
  label,
  available,
}: {
  label: string;
  available: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)" }}>
      <span
        aria-hidden="true"
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: available ? "rgba(43,181,160,0.12)" : "var(--bg-hover)",
          color: available ? "var(--accent)" : "var(--text-tertiary)",
          fontSize: 10,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {available ? "OK" : "-"}
      </span>
      <span>{label}</span>
      {!available && (
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-tertiary)" }}>
          Not available
        </span>
      )}
    </div>
  );
}

function SettingSelect({
  id,
  label,
  value,
  onChange,
  children,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label
      htmlFor={id}
      style={{
        display: "grid",
        gap: 5,
        fontSize: 12,
        color: "var(--text-tertiary)",
      }}
    >
      <span>{label}</span>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{
          width: "100%",
          border: "1px solid var(--border-main)",
          borderRadius: 9,
          background: "var(--bg-white)",
          color: "var(--text-primary)",
          fontSize: 13,
          fontFamily: "var(--font)",
          padding: "7px 9px",
          outline: "none",
        }}
      >
        {children}
      </select>
    </label>
  );
}

export default function HandoffButton({
  sessionId,
  hasPlan,
  hasCode,
  hasVideo,
  onCreated,
}: HandoffButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [state, setState] = useState<HandoffState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [model, setModel] = useState(() => getSavedModel());
  const [voiceId, setVoiceId] = useState(() => getSavedVoice());
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  async function handleStartHandoff() {
    if (!sessionId || state === "loading") return;
    setState("loading");
    setErrorMessage(null);

    try {
      const nextSessionId = await requestHandoff({ sessionId, model, voiceId });
      onCreated(nextSessionId);
    } catch (error) {
      setState("error");
      setErrorMessage(error instanceof Error ? error.message : "Failed to create handoff");
    }
  }

  const disabled = !sessionId || state === "loading";
  const emphasized = isOpen || state === "loading";
  const selectedVoiceIsCustom =
    voiceId !== NONE_VOICE_ID &&
    !AVAILABLE_VOICES.some((voice) => voice.id === voiceId);

  return (
    <div ref={rootRef} style={{ position: "relative", display: "flex", alignItems: "center" }}>
      <button
        type="button"
        data-testid="handoff-trigger"
        onClick={() => {
          if (!disabled) {
            setErrorMessage(null);
            setState("idle");
            if (!isOpen) {
              setModel(getSavedModel());
              setVoiceId(getSavedVoice());
            }
            setIsOpen((value) => !value);
          }
        }}
        disabled={disabled}
        title={sessionId ? "Start a new session with the latest plan, code, and video" : "Open a session to create a handoff"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          minHeight: 29,
          padding: "4px 12px",
          borderRadius: 999,
          border: emphasized ? "1px solid rgba(43,181,160,0.26)" : "1px solid var(--border-main)",
          background: emphasized
            ? "linear-gradient(180deg, rgba(43,181,160,0.12) 0%, rgba(43,181,160,0.07) 100%)"
            : "var(--bg-white)",
          color: state === "error" ? "#b42318" : "var(--text-primary)",
          fontSize: 13,
          fontWeight: 500,
          fontFamily: "var(--font)",
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.55 : 1,
          transition: "all 0.16s ease",
          whiteSpace: "nowrap",
        }}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke={state === "error" ? "#b42318" : emphasized ? "var(--accent)" : "currentColor"}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M7 7h10v10H7z" />
          <path d="M4 4h10" />
          <path d="M4 4v10" />
          <path d="M20 10v10" />
          <path d="M10 20h10" />
        </svg>
        <span>{state === "loading" ? "Starting..." : "Handoff"}</span>
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 10px)",
            right: 0,
            width: "min(320px, calc(100vw - 32px))",
            padding: 14,
            borderRadius: 16,
            border: "1px solid rgba(0,0,0,0.07)",
            background: "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(250,250,250,0.98) 100%)",
            boxShadow: "0 22px 44px rgba(15, 23, 42, 0.14)",
            zIndex: 60,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <div
                style={{
                  fontSize: 17,
                  lineHeight: 1.15,
                  fontFamily: "var(--font-display)",
                  fontWeight: 400,
                  color: "var(--text-primary)",
                }}
              >
                Start handoff
              </div>
              <div style={{ marginTop: 5, fontSize: 12, lineHeight: 1.5, color: "var(--text-secondary)" }}>
                Creates a new session with the latest artifacts already attached.
              </div>
            </div>

            <div style={{ display: "grid", gap: 8, padding: 12, borderRadius: 12, background: "var(--bg-hover)" }}>
              <IncludedRow label="Latest plan" available={hasPlan} />
              <IncludedRow label="Current code" available={hasCode} />
              <IncludedRow label="Latest rendered video" available={hasVideo} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <SettingSelect
                id="handoff-model"
                label="Model"
                value={model}
                onChange={(value) => {
                  const nextModel = isRegisteredModelId(value) ? value : DEFAULT_MODEL;
                  setModel(nextModel);
                  persistModel(nextModel);
                }}
              >
                {AVAILABLE_MODELS.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </SettingSelect>

              <SettingSelect
                id="handoff-voice"
                label="Sound"
                value={voiceId}
                onChange={(value) => {
                  const nextVoiceId = isValidVoiceId(value) ? value : DEFAULT_VOICE_ID;
                  setVoiceId(nextVoiceId);
                  persistVoice(nextVoiceId);
                }}
              >
                <option value={NONE_VOICE_ID}>No Voice</option>
                {AVAILABLE_VOICES.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
                {selectedVoiceIsCustom && (
                  <option value={voiceId}>
                    {getVoiceLabel(voiceId) ?? `Custom ${voiceId.slice(0, 6)}...${voiceId.slice(-4)}`}
                  </option>
                )}
              </SettingSelect>
            </div>

            {errorMessage && (
              <div style={{ fontSize: 12, lineHeight: 1.45, color: "#b42318" }}>
                {errorMessage}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                disabled={state === "loading"}
                style={{
                  border: "1px solid var(--border-main)",
                  background: "var(--bg-white)",
                  color: "var(--text-secondary)",
                  borderRadius: 9,
                  padding: "7px 12px",
                  fontSize: 13,
                  fontFamily: "var(--font)",
                  cursor: state === "loading" ? "default" : "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { void handleStartHandoff(); }}
                disabled={state === "loading"}
                style={{
                  border: "1px solid rgba(43,181,160,0.28)",
                  background: "var(--accent)",
                  color: "white",
                  borderRadius: 9,
                  padding: "7px 12px",
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: "var(--font)",
                  cursor: state === "loading" ? "default" : "pointer",
                  opacity: state === "loading" ? 0.72 : 1,
                }}
              >
                {state === "loading" ? "Starting..." : "Start new session"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
