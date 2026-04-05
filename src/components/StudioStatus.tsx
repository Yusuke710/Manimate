"use client";

import type { CloudAuthStatus } from "@/lib/studio-cloud-auth";
import { getCloudSyncDisplayHost } from "@/lib/local/cloud-sync-base-url";

function getBaseUrlLabel(baseUrl: string) {
  return getCloudSyncDisplayHost(baseUrl);
}

function getInitials(source: string) {
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function getCloudTitle(status: CloudAuthStatus): string {
  switch (status.status) {
    case "connected":
      return status.user_name?.trim() || "Connected account";
    case "pending":
      return "Connecting autosync";
    case "disconnected":
      return "Autosync is off";
    case "error":
      return "Autosync needs attention";
    default:
      return "Connected account";
  }
}

function getCloudDescription(status: CloudAuthStatus, syncHost: string): string {
  switch (status.status) {
    case "connected":
      return status.user_email?.trim() || `Connected to ${syncHost}`;
    case "pending":
      return "Finish sign-in in your browser. This Mac will continue automatically.";
    case "disconnected":
      return `Connect to ${syncHost} to sync finished renders automatically.`;
    case "error":
      return status.message?.trim() || `Reconnect to ${syncHost} to resume autosync.`;
    default:
      return `Connected to ${syncHost}`;
  }
}

function getCloudActionLabel(status: CloudAuthStatus): string | null {
  switch (status.status) {
    case "pending":
      return "Open Browser";
    case "disconnected":
      return "Connect";
    case "error":
      return "Retry";
    case "connected":
    default:
      return null;
  }
}

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
  status: CloudAuthStatus;
  onReconnect: () => void;
}) {
  const syncHost = getBaseUrlLabel(status.base_url);
  const deviceName = ("device_name" in status ? status.device_name : null)?.trim() || "This Mac";
  const initials = getInitials(
    status.status === "connected"
      ? status.user_name?.trim() || status.user_email?.trim() || syncHost
      : syncHost
  );
  const cloudTitle = getCloudTitle(status);
  const cloudDescription = getCloudDescription(status, syncHost);
  const actionLabel = getCloudActionLabel(status);
  const descriptionColor = status.status === "error" ? "#b42318" : "var(--text-tertiary)";

  return (
    <div
      style={{
        marginTop: "auto",
        borderTop: "1px solid var(--border-main)",
        paddingTop: 8,
      }}
      title={`${deviceName} via ${syncHost}`}
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
                Running on this Mac
              </div>
            </div>
          </div>
        </div>

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
          {actionLabel ? (
            <button
              onClick={onReconnect}
              style={{
                border: "1px solid var(--border-main)",
                background: "var(--bg-white)",
                color: "var(--text-primary)",
                borderRadius: 999,
                padding: "6px 10px",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              {actionLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
