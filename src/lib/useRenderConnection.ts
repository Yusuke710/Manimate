"use client";
import { useEffect, useState } from "react";
import type { RenderConnection } from "./render-connection";
export function useRenderConnection(initial: RenderConnection) {
  const [cloudAuthStatus, setStatus] = useState(initial);
  const [cloudAuthLoading, setLoading] = useState(false);
  async function update(body: object) {
    setLoading(true);
    try {
      const response = await fetch("/api/rendering", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setStatus(result);
      return result as RenderConnection;
    } catch (error) { setStatus(old => ({...old, status: "error", message: String(error)})); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    if (cloudAuthStatus.status !== "pending") return;
    const timer = setInterval(() => {
      void fetch("/api/rendering").then(r => r.json()).then(setStatus).catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [cloudAuthStatus.status]);
  return {cloudAuthStatus, cloudAuthLoading, selectMode: (mode: "local" | "cloud") => update({mode}),
    reconnectCloudAuth: async () => {
      if (cloudAuthStatus.mode !== "cloud") {
        const selected = await update({mode: "cloud"});
        if (!selected || selected.status === "error" || selected.status === "ready") return;
      }
      await update({action: "connect"});
    }};
}
