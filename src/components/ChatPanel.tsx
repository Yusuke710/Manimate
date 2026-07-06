"use client";

import { useReducer, useEffect, useCallback, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SplitPanel from "@/components/SplitPanel";
import ChatInput from "@/components/ChatInput";
import ChatMessages from "@/components/ChatMessages";
import PreviewPanel from "@/components/PreviewPanel";
import {
  ComposerSettingsControls,
  usePreferredModel,
  usePreferredVoice,
} from "@/components/ComposerControls";
import { SSEEvent, ActivityEvent, Message, DBActivityEvent, ActiveRun, dbActivityEventToUI, ImageAttachment } from "@/lib/types";
import { useBrowserPreviewBadge, usePreferredAspectRatio } from "@/lib/hooks";
import { DEFAULT_ASPECT_RATIO, DEFAULT_MODEL, isAspectRatio, isRegisteredModelId, type AspectRatio } from "@/lib/models";
import { DEFAULT_VOICE_ID, isValidVoiceId } from "@/lib/voices";
import { readUploadErrorResponse } from "@/lib/chat-attachments";
import {
  shouldAbortLingeringPreviewStream,
  shouldAcceptPolledPreviewUpdate,
  shouldShowBrowserPreviewBadge,
} from "@/lib/preview-load";

// Chat state managed by reducer
interface ChatState {
  messages: Message[];
  isLoading: boolean;
  isLoadingMessages: boolean;
  isCancelling: boolean;
  sandboxId: string | null;
  agentSessionId: string | null;
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
  | { type: "SET_SESSION"; sandboxId?: string | null; agentSessionId?: string | null }
  | { type: "ADD_ACTIVITY"; event: ActivityEvent }
  | { type: "SET_VIDEO_URL"; url: string | null; bumpNonce?: boolean }
  | { type: "RESTORE_SESSION"; sandboxId: string; agentSessionId: string }
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
        agentSessionId: action.agentSessionId !== undefined ? action.agentSessionId : state.agentSessionId,
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
        agentSessionId: action.agentSessionId,
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
  agentSessionId: null,
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
  agent_session_id: string | null;
  last_video_url: string | null;
  plan_content: string | null;
  script_content: string | null;
  voice_id: string | null;
  model: string | null;
  aspect_ratio: string | null;
}

interface SessionMessagesResponse {
  messages: SessionMessagePayload[];
  activityEvents?: DBActivityEvent[];
  session: SessionSnapshot;
  activeRun?: ActiveRun | null;
}

export function shouldApplyArtifactSnapshot(
  nextContent: string | null,
  currentContent: string | null,
): boolean {
  return nextContent !== currentContent;
}

export interface PendingWelcomePayload {
  prompt: string;
  images?: File[];
  model?: string;
  voiceId?: string;
  aspectRatio?: AspectRatio;
}

type ComposerSettingsSnapshot = {
  model: string;
  voice: string;
  aspectRatio: AspectRatio;
};

interface ChatPanelProps {
  sessionId: string | null;
  onSessionAspectRatio?: (ratio: AspectRatio) => void;
  hasPendingWelcomePayload?: (sessionId: string) => boolean;
  consumeWelcomePayload?: (sessionId: string) => PendingWelcomePayload | null;
  /** Resolves true when the session row exists in DB (for optimistic navigation) */
  sessionReady?: Promise<boolean> | null;
  isMobile?: boolean;
}

export function ChatPanel({ sessionId, onSessionAspectRatio, hasPendingWelcomePayload, consumeWelcomePayload, sessionReady, isMobile = false }: ChatPanelProps) {
  const router = useRouter();
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const [composerModel, setComposerModel] = usePreferredModel();
  const [composerVoice, setComposerVoice] = usePreferredVoice();
  const [composerAspectRatio, setComposerAspectRatio] = usePreferredAspectRatio();
  const [sessionComposerSettings, setSessionComposerSettings] =
    useState<ComposerSettingsSnapshot | null>(null);
  const [initialSessionLoaded, setInitialSessionLoaded] = useState(false);
  const draftKey = sessionId ? `chat-draft:${sessionId}` : undefined;
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentAssistantMessageIdRef = useRef<string | null>(null);
  const sandboxIdRef = useRef<string | null>(null);
  const agentSessionIdRef = useRef<string | null>(null);

  const planContentRef = useRef<string | null>(null);
  const scriptContentRef = useRef<string | null>(null);
  const videoUrlBaseRef = useRef<string | null>(null);
  const videoUrlRef = useRef<string | null>(null);
  const videoUpdateNonceRef = useRef(0);
  const reconnectedRunIdRef = useRef<string | null>(null);
  const expectedPreviewNonceRef = useRef<number | null>(null);
  const composerSyncedFromSessionRef = useRef(false);
  const [showPreviewReadyBadge, setShowPreviewReadyBadge] = useState(false);

  // Sync refs with state
  useEffect(() => { sandboxIdRef.current = state.sandboxId; }, [state.sandboxId]);
  useEffect(() => { agentSessionIdRef.current = state.agentSessionId; }, [state.agentSessionId]);
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
    (data: SessionMessagesResponse) => {
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

      const shouldSyncComposerSettings = !composerSyncedFromSessionRef.current;
      const fetchedModel = data.session.model && isRegisteredModelId(data.session.model)
        ? data.session.model
        : DEFAULT_MODEL;
      const fetchedVoice = data.session.voice_id && isValidVoiceId(data.session.voice_id)
        ? data.session.voice_id
        : DEFAULT_VOICE_ID;
      const fetchedAspectRatio = isAspectRatio(data.session.aspect_ratio)
        ? data.session.aspect_ratio
        : DEFAULT_ASPECT_RATIO;

      setSessionComposerSettings({
        model: fetchedModel,
        voice: fetchedVoice,
        aspectRatio: fetchedAspectRatio,
      });

      if (data.session.model) {
        dispatch({
          type: "SET_MODEL",
          model: fetchedModel,
        });
        if (shouldSyncComposerSettings) setComposerModel(fetchedModel);
      }
      if (shouldSyncComposerSettings) {
        setComposerVoice(fetchedVoice);
      }
      if (isAspectRatio(data.session.aspect_ratio)) {
        onSessionAspectRatio?.(data.session.aspect_ratio);
        if (shouldSyncComposerSettings) setComposerAspectRatio(fetchedAspectRatio);
      }
      if (shouldSyncComposerSettings) composerSyncedFromSessionRef.current = true;

      if (shouldApplyArtifactSnapshot(data.session.plan_content, planContentRef.current)) {
        dispatch({ type: "SET_PLAN_CONTENT", content: data.session.plan_content });
      }
      if (shouldApplyArtifactSnapshot(data.session.script_content, scriptContentRef.current)) {
        dispatch({
          type: "SET_SCRIPT_CONTENT",
          content: data.session.script_content,
        });
      }

    },
    [onSessionAspectRatio, setComposerAspectRatio, setComposerModel, setComposerVoice],
  );

  // Bootstrap: load messages for existing session on mount
  // With key={sessionId} on ChatPanel, this runs once per session
  useEffect(() => {
    // Skip bootstrap fetch for welcome-prompted sessions (auto-send will fire)
    const isWelcomeCreated = sessionId ? Boolean(hasPendingWelcomePayload?.(sessionId)) : false;
    if (!sessionId) return;
    if (isWelcomeCreated) {
      setInitialSessionLoaded(true);
      return;
    }

    dispatch({ type: "SET_LOADING_MESSAGES", isLoadingMessages: true });

    let cancelled = false;
    // include_trajectory: replay archived tool activity (parsed from the
    // session's transcripts/) once on load; the 2s/30s polls omit it and the
    // live SSE stream appends new activity on top.
    fetch(`/api/sessions/${sessionId}/messages?include_trajectory=1`)
      .then(async (response) => {
        if (cancelled) return null;
        if (!response.ok) throw new Error(`Failed to fetch messages: ${response.status}`);
        return response.json() as Promise<SessionMessagesResponse>;
      })
      .then((data: SessionMessagesResponse | null) => {
        if (!data || cancelled) return;
        applyFetchedSessionData(data);

        if (data.session.sandbox_id) {
          dispatch({ type: "RESTORE_SESSION", sandboxId: data.session.sandbox_id, agentSessionId: data.session.agent_session_id || "" });
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
      .finally(() => {
        if (!cancelled) {
          dispatch({ type: "SET_LOADING_MESSAGES", isLoadingMessages: false });
          setInitialSessionLoaded(true);
        }
      });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Polling loop for local DB changes.
  useEffect(() => {
    if (!sessionId) return;

    const doRefetch = async (): Promise<boolean> => {
      try {
        const response = await fetch(`/api/sessions/${sessionId}/messages`);
        if (!response.ok) return false;

        const data = (await response.json()) as SessionMessagesResponse;
        applyFetchedSessionData(data);
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
        const newAgentSessionId = data.activeRun?.agent_session_id || data.session.agent_session_id;
        if (newSandboxId || newAgentSessionId) {
          dispatch({ type: "SET_SESSION", sandboxId: newSandboxId || undefined, agentSessionId: newAgentSessionId || undefined });
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
        return runStillActive;
      } catch (error) {
        console.error("[ChatPanel] Failed to refetch data:", error);
        return false;
      }
    };

    // Adaptive cadence: SSE carries live updates during a run, so polling is
    // only a reconciliation fallback. Poll fast while a run is active or a
    // stream is pending, back off when idle, skip hidden tabs entirely, and
    // reconcile immediately when a tab becomes visible again. Keeps many
    // idle tabs from hammering the server (see docs/2026-07-06-session-json-storage.md).
    const ACTIVE_POLL_MS = 2000;
    const IDLE_POLL_MS = 30_000;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = (delayMs: number) => {
      if (disposed) return;
      timer = setTimeout(tick, delayMs);
    };

    const tick = async () => {
      if (document.hidden) {
        schedule(IDLE_POLL_MS);
        return;
      }
      const runStillActive = await doRefetch();
      const busy = runStillActive || Boolean(abortControllerRef.current);
      schedule(busy ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      if (timer) clearTimeout(timer);
      void tick();
    };

    void tick();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [sessionId, router, applyFetchedSessionData, showPendingPreviewReadyBadge]);

  const addActivity = useCallback((event: Omit<ActivityEvent, "id" | "timestamp">, turnId?: string) => {
    dispatch({ type: "ADD_ACTIVITY", event: { ...event, id: crypto.randomUUID(), timestamp: new Date(), turnId } });
  }, []);

  const handleSend = useCallback(async (
    prompt: string,
    images?: File[],
    options?: { model?: string; voiceId?: string; aspectRatio?: AspectRatio }
  ) => {
    const currentSandboxId = sandboxIdRef.current;
    const currentAgentSessionId = agentSessionIdRef.current;
    const turnId = crypto.randomUUID();
    const visibleFiles = images ?? [];

    const imagePreviewAttachments: ImageAttachment[] | undefined = visibleFiles.length > 0
      ? visibleFiles.map((file) => ({
          id: crypto.randomUUID(), path: "", name: file.name, size: file.size, type: file.type, url: URL.createObjectURL(file),
        }))
      : undefined;

    if (prompt.trim() || visibleFiles.length > 0) {
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
      if (visibleFiles.length > 0 && activeSessionId) {
        try {
          const formData = new FormData();
          formData.append("session_id", activeSessionId);
          for (const file of visibleFiles) formData.append("images", file);
          const uploadResponse = await fetch("/api/chat/uploads", { method: "POST", body: formData });
          if (!uploadResponse.ok) {
            throw new Error(await readUploadErrorResponse(uploadResponse, "Upload failed"));
          }
          const uploadData = await uploadResponse.json().catch(() => null) as { images?: ImageAttachment[] } | null;
          if (!uploadData || !Array.isArray(uploadData.images)) {
            throw new Error("Upload response was invalid");
          }
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

      const body: Record<string, unknown> = {
        prompt,
        model: options?.model ?? state.model,
      };
      if (options?.voiceId) body.voice_id = options.voiceId;
      if (options?.aspectRatio) body.aspect_ratio = options.aspectRatio;
      if (uploadedImages && uploadedImages.length > 0) body.images = uploadedImages;
      body.session_id = activeSessionId;
      const isNewSession = !sessionId;
      if (!isNewSession && currentSandboxId) body.sandbox_id = currentSandboxId;
      if (!isNewSession && currentAgentSessionId) body.agent_session_id = currentAgentSessionId;

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
            if (event.agent_session_id) dispatch({ type: "SET_SESSION", agentSessionId: event.agent_session_id });

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
            } else if (event.type === "tool_result") {
              const toolOutput =
                typeof event.tool_result === "string" && event.tool_result.trim()
                  ? event.tool_result
                  : event.message;
              addActivity({ type: "tool_result", message: toolOutput, toolResult: event.tool_result, isError: event.is_error }, turnId);
            } else if (event.type === "artifact_update") {
              if (
                event.plan_content !== undefined &&
                shouldApplyArtifactSnapshot(event.plan_content, planContentRef.current)
              ) {
                dispatch({ type: "SET_PLAN_CONTENT", content: event.plan_content });
              }
              if (
                event.script_content !== undefined &&
                shouldApplyArtifactSnapshot(event.script_content, scriptContentRef.current)
              ) {
                dispatch({ type: "SET_SCRIPT_CONTENT", content: event.script_content });
              }
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
  }, [addActivity, sessionId, state.model, sessionReady, showPendingPreviewReadyBadge]);

  // Auto-send pending welcome payload when a new session loads
  const welcomeSentRef = useRef(false);
  useLayoutEffect(() => {
    if (!sessionId || welcomeSentRef.current) return;
    const pending = consumeWelcomePayload?.(sessionId);
    if (!pending) return;
    welcomeSentRef.current = true;
    void handleSend(pending.prompt, pending.images, {
      model: pending.model,
      voiceId: pending.voiceId,
      aspectRatio: pending.aspectRatio,
    });
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
    if (state.isLoading) return false;
    void handleSend("render in 1080@30fps", undefined, {
      model: composerModel,
      voiceId: composerVoice,
      aspectRatio: composerAspectRatio,
    });
    return true;
  }, [composerAspectRatio, composerModel, composerVoice, handleSend, state.isLoading]);

  const handleRequest4kRender = useCallback(() => {
    if (state.isLoading) return false;
    void handleSend("render in 4k@30fps", undefined, {
      model: composerModel,
      voiceId: composerVoice,
      aspectRatio: composerAspectRatio,
    });
    return true;
  }, [composerAspectRatio, composerModel, composerVoice, handleSend, state.isLoading]);

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
  const shouldShowFirstTurnConfig =
    initialSessionLoaded &&
    !state.isLoadingMessages &&
    state.messages.length === 0 &&
    !state.agentSessionId;
  const hasPendingComposerSettingsChange = Boolean(
    sessionComposerSettings &&
      (
        composerModel !== sessionComposerSettings.model ||
        composerVoice !== sessionComposerSettings.voice ||
        composerAspectRatio !== sessionComposerSettings.aspectRatio
      ),
  );
  const composerSettingsControls = initialSessionLoaded ? (
    <ComposerSettingsControls
      model={composerModel}
      onModelChange={setComposerModel}
      modelLocked={!shouldShowFirstTurnConfig}
      voice={composerVoice}
      onVoiceChange={setComposerVoice}
      aspectRatio={composerAspectRatio}
      onAspectRatioChange={setComposerAspectRatio}
      compact={!shouldShowFirstTurnConfig}
      isMobile={isMobile}
      hasPendingChange={hasPendingComposerSettingsChange}
    />
  ) : undefined;

  const handleConfiguredSend = useCallback((prompt: string, images?: File[]) => {
    void handleSend(prompt, images, {
      model: composerModel,
      voiceId: composerVoice,
      aspectRatio: composerAspectRatio,
    });
  }, [composerAspectRatio, composerModel, composerVoice, handleSend]);

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
      isRendering={state.isLoading}
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
              onSend={handleConfiguredSend}
              onStop={handleCancel}
              isLoading={state.isLoading}
              draftKey={draftKey}
              extraLeft={composerSettingsControls}
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
            onSend={handleConfiguredSend}
            onStop={handleCancel}
            isLoading={state.isLoading}
            compact
            draftKey={draftKey}
            extraLeft={composerSettingsControls}
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
              onSend={handleConfiguredSend}
              onStop={handleCancel}
              isLoading={state.isLoading}
              compact={isMobile}
              draftKey={draftKey}
              extraLeft={composerSettingsControls}
            />
          </div>
        </div>
      )}
    </div>
  );
}
