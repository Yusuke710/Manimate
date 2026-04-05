"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type CloudAuthStatus, createCloudAuthErrorStatus } from "@/lib/studio-cloud-auth";

const CLOUD_AUTH_AUTO_ATTEMPT_KEY = "manimate-cloud-auth-auto-attempted";
const CLOUD_SYNC_RETRY_ATTEMPT_KEY = "manimate-cloud-sync-retry-attempted";

export function useStudioCloudAuth(initialCloudAuthStatus: CloudAuthStatus) {
  const [cloudAuthStatus, setCloudAuthStatus] = useState<CloudAuthStatus>(initialCloudAuthStatus);
  const [cloudAuthLoading, setCloudAuthLoading] = useState(false);
  const cloudAuthStartingRef = useRef(false);
  const cloudSyncRetryStartedRef = useRef(false);

  const refreshCloudAuthStatus = useCallback(async (): Promise<CloudAuthStatus> => {
    try {
      const response = await fetch("/api/cloud-sync/status");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as CloudAuthStatus;
      setCloudAuthStatus(data);
      return data;
    } catch (error) {
      const status = createCloudAuthErrorStatus(
        error instanceof Error ? error.message : "Failed to check manimate.ai connection",
        cloudAuthStatus.base_url
      );
      setCloudAuthStatus(status);
      return status;
    }
  }, [cloudAuthStatus.base_url]);

  const startCloudAuth = useCallback(async (reopen = true) => {
    if (cloudAuthStartingRef.current) return;
    cloudAuthStartingRef.current = true;
    setCloudAuthLoading(true);
    try {
      const response = await fetch("/api/cloud-sync/connect/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reopen }),
      });
      const data = (await response.json()) as CloudAuthStatus;
      setCloudAuthStatus(data);
    } catch (error) {
      setCloudAuthStatus(
        createCloudAuthErrorStatus(
          error instanceof Error ? error.message : "Failed to start manimate.ai authentication",
          cloudAuthStatus.base_url
        )
      );
    } finally {
      setCloudAuthLoading(false);
      cloudAuthStartingRef.current = false;
    }
  }, [cloudAuthStatus.base_url]);

  useEffect(() => {
    if (cloudAuthStatus.status !== "disconnected") return;

    const shouldAutoOpenBrowser = (() => {
      try {
        if (sessionStorage.getItem(CLOUD_AUTH_AUTO_ATTEMPT_KEY) === "1") return false;
        sessionStorage.setItem(CLOUD_AUTH_AUTO_ATTEMPT_KEY, "1");
        return true;
      } catch {
        return true;
      }
    })();

    if (!shouldAutoOpenBrowser) return;
    void startCloudAuth(true);
  }, [cloudAuthStatus.status, startCloudAuth]);

  useEffect(() => {
    if (cloudAuthStatus.status !== "pending") return;
    const timer = window.setInterval(() => {
      void refreshCloudAuthStatus();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [cloudAuthStatus.status, refreshCloudAuthStatus]);

  useEffect(() => {
    if (cloudAuthStatus.status === "connected") return;

    const refreshOnReturn = () => {
      void refreshCloudAuthStatus();
    };
    const refreshOnVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshCloudAuthStatus();
      }
    };

    window.addEventListener("focus", refreshOnReturn);
    document.addEventListener("visibilitychange", refreshOnVisible);
    return () => {
      window.removeEventListener("focus", refreshOnReturn);
      document.removeEventListener("visibilitychange", refreshOnVisible);
    };
  }, [cloudAuthStatus.status, refreshCloudAuthStatus]);

  useEffect(() => {
    if (cloudAuthStatus.status !== "connected") return;
    if (cloudSyncRetryStartedRef.current) return;

    const shouldRetry = (() => {
      try {
        const marker = `${cloudAuthStatus.connected_at}:${cloudAuthStatus.base_url}`;
        if (sessionStorage.getItem(CLOUD_SYNC_RETRY_ATTEMPT_KEY) === marker) return false;
        sessionStorage.setItem(CLOUD_SYNC_RETRY_ATTEMPT_KEY, marker);
      } catch {
        // Ignore storage failures and still retry once for this mount.
      }
      return true;
    })();

    if (!shouldRetry) return;

    cloudSyncRetryStartedRef.current = true;
    void fetch("/api/cloud-sync/retry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).catch(() => {});
  }, [cloudAuthStatus]);

  return {
    cloudAuthStatus,
    cloudAuthLoading,
    reconnectCloudAuth: () => { void startCloudAuth(true); },
  };
}
