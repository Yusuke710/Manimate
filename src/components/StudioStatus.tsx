"use client";

export interface StudioConnectionSummary {
  baseUrl: string;
  deviceName?: string | null;
  userEmail?: string | null;
  userName?: string | null;
}

function getBaseUrlLabel(baseUrl: string) {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl.replace(/^https?:\/\//, "");
  }
}

function getInitials(connection: StudioConnectionSummary | null) {
  const source = connection?.userName?.trim() || connection?.userEmail?.trim() || "Manimate Studio";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
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

export function StudioAccountCard({ connection }: { connection: StudioConnectionSummary | null }) {
  const initials = getInitials(connection);
  const accountName = connection?.userName?.trim() || "Connected account";
  const accountEmail = connection?.userEmail?.trim() || null;
  const syncHost = connection ? getBaseUrlLabel(connection.baseUrl) : "manimate.ai";
  const deviceName = connection?.deviceName?.trim() || "This Mac";

  return (
    <div
      style={{
        marginTop: "auto",
        borderTop: "1px solid var(--border-main)",
        paddingTop: 8,
      }}
      title={`${deviceName} syncing through ${syncHost}`}
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
            <div
              style={{ minWidth: 0 }}
            >
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
              {accountName}
            </div>
            {accountEmail ? (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-tertiary)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {accountEmail}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
