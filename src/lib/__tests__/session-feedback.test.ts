import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_LOCAL_ROOT = process.env.MANIMATE_LOCAL_ROOT;
const ORIGINAL_CLOUD_SYNC_URL = process.env.MANIMATE_CLOUD_SYNC_URL;
const ORIGINAL_CLOUD_SYNC_TOKEN = process.env.MANIMATE_CLOUD_SYNC_TOKEN;

interface SyncedFeedbackMessage {
  content: string;
  metadata?: {
    kind?: string;
    session_number?: number;
  };
}

interface SyncedFeedbackActivityEvent {
  type: string;
  payload?: {
    session_number?: number;
  };
}

interface CapturedCloudSnapshot {
  session: Record<string, unknown>;
  messages: SyncedFeedbackMessage[];
  activity_events: SyncedFeedbackActivityEvent[];
}

async function loadModules(root: string) {
  process.env.MANIMATE_LOCAL_ROOT = root;
  delete process.env.MANIMATE_CLOUD_SYNC_URL;
  delete process.env.MANIMATE_CLOUD_SYNC_TOKEN;
  vi.resetModules();

  const store = await import("@/lib/local/local-config-store");
  const db = await import("@/lib/local/db");
  const cloudSync = await import("@/lib/local/cloud-sync");
  const feedbackRoute = await import("@/app/api/sessions/[sessionId]/feedback/route");
  const messagesRoute = await import("@/app/api/sessions/[sessionId]/messages/route");

  return { store, db, cloudSync, feedbackRoute, messagesRoute };
}

async function waitForCloudSyncStatus(
  getStatus: () => string | null,
  expectedStatus: string,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (getStatus() === expectedStatus) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for cloud sync status ${expectedStatus}`);
}

afterEach(() => {
  if (ORIGINAL_LOCAL_ROOT === undefined) {
    delete process.env.MANIMATE_LOCAL_ROOT;
  } else {
    process.env.MANIMATE_LOCAL_ROOT = ORIGINAL_LOCAL_ROOT;
  }

  if (ORIGINAL_CLOUD_SYNC_URL === undefined) {
    delete process.env.MANIMATE_CLOUD_SYNC_URL;
  } else {
    process.env.MANIMATE_CLOUD_SYNC_URL = ORIGINAL_CLOUD_SYNC_URL;
  }

  if (ORIGINAL_CLOUD_SYNC_TOKEN === undefined) {
    delete process.env.MANIMATE_CLOUD_SYNC_TOKEN;
  } else {
    process.env.MANIMATE_CLOUD_SYNC_TOKEN = ORIGINAL_CLOUD_SYNC_TOKEN;
  }

  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("session feedback", () => {
  it("assigns stable session numbers, stores feedback, and hides it from the local chat transcript", async () => {
    const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-session-feedback-"));

    try {
      const { db, feedbackRoute, messagesRoute } = await loadModules(localRoot);

      const firstSession = db.createLocalSession({ model: "opus" });
      const secondSession = db.createLocalSession({ model: "opus" });

      expect(firstSession.session_number).toBe(1);
      expect(secondSession.session_number).toBe(2);

      db.insertLocalMessage({
        session_id: firstSession.id,
        role: "user",
        content: "Animate a parabola.",
      });
      db.insertLocalActivityEvent({
        session_id: firstSession.id,
        type: "progress",
        message: "Running Manimate...",
      });

      const feedbackResponse = await feedbackRoute.POST(
        new NextRequest(`http://localhost/api/sessions/${firstSession.id}/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ feedback: "The pacing was too fast in the middle section." }),
        }),
        {
          params: Promise.resolve({ sessionId: firstSession.id }),
        }
      );
      const feedbackPayload = await feedbackResponse.json();

      expect(feedbackResponse.status).toBe(200);
      expect(feedbackPayload).toMatchObject({
        ok: true,
        session_id: firstSession.id,
        session_number: 1,
      });

      const persistedMessages = db.listLocalMessages(firstSession.id);
      expect(persistedMessages).toHaveLength(2);
      expect(persistedMessages[1]).toMatchObject({
        role: "user",
        content: "Library feedback for Session #1\n\nThe pacing was too fast in the middle section.",
        metadata: {
          kind: "session_feedback",
          session_number: 1,
          session_id: firstSession.id,
        },
      });

      const persistedActivity = db.listLocalActivityEvents(firstSession.id);
      expect(persistedActivity).toHaveLength(2);
      expect(persistedActivity[1]).toMatchObject({
        type: "feedback_submitted",
        message: "Library feedback submitted for Session #1",
        payload: {
          kind: "session_feedback",
          session_number: 1,
        },
      });

      const transcriptResponse = await messagesRoute.GET(
        new NextRequest(`http://localhost/api/sessions/${firstSession.id}/messages`),
        {
          params: Promise.resolve({ sessionId: firstSession.id }),
        }
      );
      const transcriptPayload = await transcriptResponse.json();

      expect(transcriptResponse.status).toBe(200);
      expect(transcriptPayload.messages).toHaveLength(1);
      expect(transcriptPayload.messages[0]).toMatchObject({
        content: "Animate a parabola.",
      });
      expect(transcriptPayload.activityEvents).toHaveLength(1);
      expect(transcriptPayload.activityEvents[0]).toMatchObject({
        type: "progress",
        message: "Running Manimate...",
      });
    } finally {
      fs.rmSync(localRoot, { recursive: true, force: true });
    }
  });

  it("includes feedback records in the mirrored cloud snapshot without changing the hosted session schema", async () => {
    const localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "manimate-session-feedback-sync-"));

    try {
      const { store, db, cloudSync, feedbackRoute } = await loadModules(localRoot);

      const session = db.createLocalSession({ model: "opus" });

      await feedbackRoute.POST(
        new NextRequest(`http://localhost/api/sessions/${session.id}/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ feedback: "Please keep subtitle timing tighter." }),
        }),
        {
          params: Promise.resolve({ sessionId: session.id }),
        }
      );

      store.writeStoredLocalConfig({
        cloud_sync: {
          base_url: "https://manimate.ai",
          token: "token-123",
          connected_at: "2026-04-17T00:00:00.000Z",
        },
      });

      let capturedSnapshot: CapturedCloudSnapshot | null = null;
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://www.manimate.ai/api/local-sync/uploads") {
          return new Response(JSON.stringify({ error: "Not Found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (url === "https://www.manimate.ai/api/local-sync/sessions") {
          expect(init?.method).toBe("POST");
          expect(init?.headers).toMatchObject({
            Authorization: "Bearer token-123",
          });
          expect(init?.body).toBeInstanceOf(FormData);
          const snapshotRaw = (init?.body as FormData).get("snapshot");
          capturedSnapshot = JSON.parse(String(snapshotRaw)) as CapturedCloudSnapshot;
          return new Response(JSON.stringify({ public_video_url: null }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        throw new Error(`Unexpected fetch target: ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      cloudSync.queueLocalCloudSync(session.id);

      await waitForCloudSyncStatus(
        () => db.getLocalSession(session.id)?.cloud_sync_status ?? null,
        "synced",
      );

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(capturedSnapshot).not.toBeNull();
      expect(capturedSnapshot?.session).toMatchObject({
        id: session.id,
      });
      expect(capturedSnapshot?.session.session_number).toBeUndefined();
      expect(
        capturedSnapshot?.messages.some(
          (message) =>
            message.metadata?.kind === "session_feedback" &&
            message.metadata?.session_number === 1 &&
            message.content.includes("Library feedback for Session #1"),
        )
      ).toBe(true);
      expect(
        capturedSnapshot?.activity_events.some(
          (event) =>
            event.type === "feedback_submitted" &&
            event.payload?.session_number === 1,
        )
      ).toBe(true);
    } finally {
      fs.rmSync(localRoot, { recursive: true, force: true });
    }
  });
});
