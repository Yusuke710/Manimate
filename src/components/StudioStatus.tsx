"use client";

import type { RenderConnection } from "@/lib/render-connection";

function LocalBadge({ size = 24 }: { size?: number }) {
  const dotSize = size <= 18 ? 7 : 8;
  const haloSize = size <= 18 ? 3 : 4;

  return (
    <span
      aria-label="Running locally"
      title="Running locally"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: 999,
        border: "1px solid var(--border-main)",
        background: "var(--bg-white)",
        flexShrink: 0,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: dotSize,
          height: dotSize,
          borderRadius: 999,
          background: "var(--accent)",
          boxShadow: `0 0 0 ${haloSize}px var(--accent-muted)`,
        }}
      />
    </span>
  );
}

export function StudioPlanPill() {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 20,
        border: "1px solid var(--border-main)",
        background: "var(--bg-white)",
        overflow: "hidden",
      }}
    >
      <span
        style={{
          padding: "6px 14px",
          fontSize: 13,
          color: "var(--text-tertiary)",
          fontFamily: "var(--font)",
        }}
      >
        Studio
      </span>
      <span style={{ width: 1, height: 16, background: "var(--border-main)" }} />
      <span style={{ padding: 4, display: "inline-flex" }}>
        <LocalBadge />
      </span>
    </div>
  );
}

export function StudioAccountCard({
  status,
  onReconnect,
}: {
  status: RenderConnection;
  onReconnect: () => void;
}) {
  const connected = status.mode === "cloud" && status.status === "ready";
  const pending = status.status === "pending";
  const initials = connected && status.user_email ? status.user_email.slice(0, 2).toUpperCase() : "∑";
  const cloudTitle = connected ? "Manim-Cloud" : "Cloud rendering";
  const cloudDescription = connected ? status.user_email || "Connected" : pending ? "Finish connecting in your browser." : "Render remotely with Manim-Cloud.";
  const descriptionColor = status.status === "error" ? "#b42318" : "var(--text-tertiary)";

  return (
    <div
      style={{
        marginTop: "auto",
        borderTop: "1px solid var(--border-main)",
        paddingTop: 8,
      }}
      title="Manimate"
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          width: "100%",
          padding: 8,
          borderRadius: 12,
        }}
      >
        {status.mode === "local" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <LocalBadge size={18} />
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  color: "var(--text-tertiary)",
                }}
              >
                Studio
              </div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  lineHeight: 1.2,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                Running on this machine
              </div>
            </div>
          </div>
        </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            minWidth: 0,
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 999,
              background: "var(--bg-main)",
              border: "1px solid var(--border-main)",
              color: "var(--text-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.3,
              flexShrink: 0,
            }}
          >
            {initials}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: "var(--text-primary)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {cloudTitle}
            </div>
            <div
              style={{
                fontSize: 12,
                color: descriptionColor,
                lineHeight: 1.45,
              }}
            >
              {cloudDescription}
            </div>
          </div>

        </div>
        {!connected && <button
          type="button"
          onClick={onReconnect}
          disabled={pending}
          style={{alignSelf: "flex-start", marginLeft: 38, padding: 0, border: 0, background: "none", color: "var(--accent)", fontSize: 12, cursor: pending ? "default" : "pointer", textDecoration: "underline", textUnderlineOffset: 3}}
        >{pending ? "Connecting…" : "Connect to Manim-Cloud"}</button>}
      </div>
    </div>
  );
}
