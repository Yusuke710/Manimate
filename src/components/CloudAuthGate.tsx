"use client";

import type { CloudAuthStatus } from "@/lib/studio-cloud-auth";

export function CloudAuthGate({
  isLoading,
  status,
  onRetry,
}: {
  isLoading: boolean;
  status: CloudAuthStatus;
  onRetry: () => void;
}) {
  const isPending = status.status === "pending";
  const isError = status.status === "error";
  const title = isPending ? "Continue in Manimate.ai" : "Connect to Manimate.ai";
  const description = isLoading
    ? "Opening manimate.ai..."
    : isError
      ? status.message
      : isPending
        ? "Finish connecting in your browser. This window will continue automatically."
        : "Manimate Studio needs a hosted connection before you continue.";

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "#f6f3ec",
      }}
    >
      <div
        style={{
          width: "min(470px, 100%)",
          background: "#fbfaf7",
          border: `1px solid ${isError ? "rgba(180,35,24,0.18)" : "rgba(15,23,42,0.10)"}`,
          borderRadius: 24,
          padding: "34px 26px 28px",
          boxShadow: "0 24px 60px rgba(15,23,42,0.08)",
          display: "grid",
          gap: 18,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            margin: "0 auto",
          }}
        >
          <span
            style={{
              fontSize: 44,
              lineHeight: 1,
              color: "var(--accent)",
              fontFamily: "'Computer Modern', 'Latin Modern Math', 'STIX Two Math', serif",
            }}
          >
            ∑
          </span>
          <span
            style={{
              fontSize: 28,
              lineHeight: 1,
              color: "var(--text-primary)",
              fontFamily: "var(--font-display)",
            }}
          >
            Manimate
          </span>
        </div>

        {(isLoading || isPending) ? (
          <div
            style={{
              width: 42,
              height: 42,
              margin: "0 auto",
              borderRadius: 999,
              border: "3px solid rgba(43,181,160,0.18)",
              borderTopColor: "var(--accent)",
              animation: "spin 0.9s linear infinite",
            }}
          />
        ) : null}

        <div style={{ display: "grid", gap: 10, textAlign: "center" }}>
          <h1
            style={{
              margin: 0,
              fontSize: 18,
              lineHeight: 1.45,
              color: "#171717",
              fontWeight: 500,
            }}
          >
            {title}
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: 14,
              lineHeight: 1.6,
              color: isError ? "#b42318" : "#525252",
            }}
          >
            {description}
          </p>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <button
            onClick={onRetry}
            disabled={isLoading}
            style={{
              border: "none",
              borderRadius: 12,
              padding: "13px 18px",
              fontWeight: 600,
              fontSize: 15,
              background: "var(--accent)",
              color: "#ffffff",
              cursor: isLoading ? "default" : "pointer",
              opacity: isLoading ? 0.72 : 1,
            }}
          >
            {isLoading ? "Opening Browser..." : isPending ? "Open Browser Again" : isError ? "Retry Sign-In" : "Continue in Manimate.ai"}
          </button>
        </div>
      </div>
    </div>
  );
}
