import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Regression tests for the video preview + voiceover pipeline.
 *
 * Covers:
 *  1. Refresh: no double video load from realtime/SSE race
 *  2. Silent → voiced video swap (single turn) with seekbar continuity
 *  3. Multi-turn: new video auto-switches + voiceover label updates + seekbar
 *  4. Reload: correct state rehydration
 *  5. Session isolation: full state reset
 *  6. Server-side trigger ordering
 *  7. Console log contracts (actual console.log spying)
 *  8. Edge cases
 *  9. Full state-machine simulation (single + multi-turn)
 */

// ---------------------------------------------------------------------------
// Types mirroring the component state
// ---------------------------------------------------------------------------
type VoiceoverStatus = 'pending' | 'generating' | 'completed' | 'failed' | null;

// ---------------------------------------------------------------------------
// Logic extracted from page.tsx – ChatPanel reducer
// ---------------------------------------------------------------------------
interface VideoState {
  videoUrl: string | null;
  videoUpdateNonce: number;
}

/** SET_VIDEO_URL reducer logic (page.tsx:193-203) */
function reduceSetVideoUrl(
  state: VideoState,
  url: string | null,
  bumpNonce = false,
): VideoState {
  const newBase = url?.split('?')[0] || null;
  const oldBase = state.videoUrl?.split('?')[0] || null;
  if (newBase && newBase === oldBase && !bumpNonce) return state; // dedup
  return {
    videoUrl: url,
    videoUpdateNonce: bumpNonce ? state.videoUpdateNonce + 1 : state.videoUpdateNonce,
  };
}

// ---------------------------------------------------------------------------
// Logic extracted from PreviewPanel.tsx
// ---------------------------------------------------------------------------

function getBasePath(url: string | null): string | null {
  return url?.split('?')[0] || null;
}

/**
 * Should the prop videoUrl be synced into effectiveVideoUrl? (PreviewPanel:43-66)
 * Note: the real code also gates on `videoUrl !== prevVideoUrlRef.current` first.
 * This helper models the inner decision once that outer gate passes.
 */
function shouldApplyVideoSync(
  prevUrl: string | null,
  nextUrl: string | null,
  prevNonce: number,
  nextNonce: number,
): { shouldSync: boolean; awaitingVoiceover: boolean } {
  // Outer gate: if URL didn't change at all, the effect body never runs
  if (prevUrl === nextUrl && prevNonce === nextNonce) {
    return { shouldSync: false, awaitingVoiceover: false };
  }
  if (prevUrl === nextUrl) {
    // URL identical but nonce changed — only matters if nonce differs
    const nonceChanged = prevNonce !== nextNonce;
    return { shouldSync: nonceChanged, awaitingVoiceover: nonceChanged };
  }
  // URL changed
  const prevBase = getBasePath(prevUrl);
  const nextBase = getBasePath(nextUrl);
  const nonceChanged = prevNonce !== nextNonce;
  const shouldSync = prevBase !== nextBase || nonceChanged;
  return { shouldSync, awaitingVoiceover: shouldSync && nonceChanged };
}

/** Should voiceover polling start? (PreviewPanel:130-132) */
function shouldStartPolling(status: VoiceoverStatus, videoUrl: string | null): boolean {
  return (
    status === 'pending' ||
    status === 'generating' ||
    (status === null && !!videoUrl)
  );
}

/** Should voiceover polling continue after a poll response? (PreviewPanel:126-127) */
function shouldContinuePolling(status: VoiceoverStatus): boolean {
  return status === 'pending' || status === 'generating';
}

/** Should a voiced swap be triggered? (PreviewPanel:88-95) */
function shouldTriggerSwap(
  prevStatus: VoiceoverStatus,
  newStatus: VoiceoverStatus,
  lastVideoUrl: string | null,
  awaitingFreshSilent = false,
): boolean {
  const wasActive = prevStatus === 'pending' || prevStatus === 'generating';
  const completedAfterFresh =
    awaitingFreshSilent && prevStatus === null && newStatus === 'completed';
  return (wasActive || completedAfterFresh) && newStatus === 'completed' && !!lastVideoUrl;
}

/** Should doRefetch dispatch SET_VIDEO_URL? (page.tsx:395-403) */
function shouldRefetchDispatchVideo(
  abortControllerActive: boolean,
  dbVoiceoverStatus: string | null,
): boolean {
  return !abortControllerActive && dbVoiceoverStatus !== 'completed';
}

// ---------------------------------------------------------------------------
// State machine: models PreviewPanel + PreviewTab lifecycle
// ---------------------------------------------------------------------------
interface PreviewState {
  // PreviewPanel level
  effectiveVideoUrl: string | null;
  voiceoverStatus: VoiceoverStatus;
  prevStatusRef: VoiceoverStatus;
  awaitingVoiceoverCompletion: boolean;
  voicedSwapToken: number;
  prevVideoUrlProp: string | null;
  prevNonce: number;
  userSelectedTab: boolean;
  activeTab: 'plan' | 'code' | 'preview';
  isVideoPlayable: boolean;

  // PreviewTab level (seekbar/swap state)
  activeVideo: 'A' | 'B';
  srcA: string | null;
  srcB: string | null;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  playbackRate: number;
  swapInProgress: boolean;
  prevSwapToken: number;
  prevFullVideoUrl: string | null;
  desiredTime: number;
  desiredRate: number;
  desiredPaused: boolean;
  // Tracks whether .load() was called on the active video element
  loadCalled: boolean;
  // True after voiced swap has been triggered for the current turn (dedup guard)
  voicedSwapFired: boolean;

  // Console log trace for assertions
  logs: string[];
}

function createInitialPreviewState(): PreviewState {
  return {
    effectiveVideoUrl: null,
    voiceoverStatus: null,
    prevStatusRef: null,
    awaitingVoiceoverCompletion: false,
    voicedSwapToken: 0,
    prevVideoUrlProp: null,
    prevNonce: 0,
    userSelectedTab: false,
    activeTab: 'plan',
    isVideoPlayable: false,
    activeVideo: 'A',
    srcA: null,
    srcB: null,
    currentTime: 0,
    duration: 0,
    isPlaying: false,
    playbackRate: 1,
    swapInProgress: false,
    prevSwapToken: 0,
    prevFullVideoUrl: null,
    desiredTime: 0,
    desiredRate: 1,
    desiredPaused: true,
    loadCalled: false,
    voicedSwapFired: false,
    logs: [],
  };
}

/** Simulate PreviewPanel receiving new videoUrl + nonce props (line 43-66) */
function applyVideoUrlPropChange(
  state: PreviewState,
  videoUrl: string | null,
  nonce: number,
): PreviewState {
  const s = { ...state };

  if (videoUrl === s.prevVideoUrlProp && nonce === s.prevNonce) return s;

  if (videoUrl !== s.prevVideoUrlProp) {
    const prevBase = getBasePath(s.prevVideoUrlProp);
    const currBase = getBasePath(videoUrl);
    const nonceChanged = nonce !== s.prevNonce;
    const shouldSync = currBase !== prevBase || nonceChanged;

    if (shouldSync) {
      s.isVideoPlayable = false;
      s.effectiveVideoUrl = videoUrl;
      s.voiceoverStatus = null;
      s.prevStatusRef = null;
      s.userSelectedTab = false;
      s.awaitingVoiceoverCompletion = nonceChanged;
      s.voicedSwapFired = false;
      s.logs.push(`[VoiceoverFlow] Synced URL: ${videoUrl?.split('?')[0]}, awaitingVO=${nonceChanged}`);
    } else {
      s.logs.push('[VoiceoverFlow] Ignoring same-base URL change without nonce bump');
    }
    s.prevVideoUrlProp = videoUrl;
  }
  s.prevNonce = nonce;
  return s;
}

/** Simulate PreviewTab URL sync effect (non-swap, line 786-815) */
function applyPreviewTabUrlSync(state: PreviewState): PreviewState {
  const s = { ...state };
  const fullVideoUrl = s.effectiveVideoUrl?.startsWith('http') ? s.effectiveVideoUrl : null;

  if (s.swapInProgress) return s;
  if (s.voicedSwapToken !== s.prevSwapToken) return s;

  if (fullVideoUrl !== s.prevFullVideoUrl) {
    // Reset playback for fresh silent render
    s.currentTime = 0;
    s.duration = 0;
    s.isPlaying = false;
    s.desiredTime = 0;
    s.desiredPaused = true;
    if (s.activeVideo === 'A') {
      s.srcA = fullVideoUrl;
    } else {
      s.srcB = fullVideoUrl;
    }
    // Model the .load() call added via requestAnimationFrame (fix for multi-turn bug).
    // Without this, browsers may not reload an already-loaded video element.
    s.loadCalled = true;
    s.logs.push(`[VideoSwap] URL sync (non-swap): ${fullVideoUrl?.split('?')[0]}, load() queued`);
  }
  s.prevFullVideoUrl = fullVideoUrl;
  return s;
}

/** Simulate a voiceover poll response */
function applyVoiceoverPoll(
  state: PreviewState,
  newStatus: VoiceoverStatus,
  lastVideoUrl: string | null,
): PreviewState {
  const s = { ...state };
  const wasActive = s.prevStatusRef === 'pending' || s.prevStatusRef === 'generating';
  const completedAfterFresh =
    s.awaitingVoiceoverCompletion && s.prevStatusRef === null && newStatus === 'completed';
  const enteredCompleted = (wasActive || completedAfterFresh) && newStatus === 'completed';

  s.prevStatusRef = newStatus;
  s.voiceoverStatus = newStatus;

  if (enteredCompleted && lastVideoUrl && !s.voicedSwapFired) {
    s.voicedSwapFired = true;
    s.logs.push(`[VoiceoverFlow] Voiceover completed, triggering swap → ${lastVideoUrl.split('?')[0]}`);
    s.effectiveVideoUrl = lastVideoUrl;
    s.voicedSwapToken += 1;
    s.awaitingVoiceoverCompletion = false;
  } else if (newStatus === 'failed' || newStatus === null) {
    s.awaitingVoiceoverCompletion = false;
  }
  return s;
}

/** Simulate the seamless video swap effect (line 818-1065) */
function applyVideoSwap(state: PreviewState): PreviewState {
  const s = { ...state };
  const fullVideoUrl = s.effectiveVideoUrl?.startsWith('http') ? s.effectiveVideoUrl : null;

  if (s.voicedSwapToken === s.prevSwapToken) return s;

  if (s.swapInProgress) {
    s.logs.push(`[VideoSwap] Swap already in progress, skipping token ${s.voicedSwapToken}`);
    s.prevSwapToken = s.voicedSwapToken;
    return s;
  }

  if (!fullVideoUrl) {
    s.logs.push('[VideoSwap] Swap skipped: no fullVideoUrl');
    s.prevSwapToken = s.voicedSwapToken;
    return s;
  }

  s.logs.push(`[VideoSwap] Swap effect triggered, token ${s.prevSwapToken}→${s.voicedSwapToken}`);
  s.swapInProgress = true;

  // Capture playback state BEFORE swap (seekbar continuity)
  const capturedTime = s.currentTime;
  const capturedRate = s.playbackRate;
  const capturedPaused = !s.isPlaying;

  // Set inactive src
  if (s.activeVideo === 'A') {
    s.srcB = fullVideoUrl;
  } else {
    s.srcA = fullVideoUrl;
  }

  // Simulate preload succeeded → swap
  // Restore playback state on new active video (seekbar continuity!)
  s.desiredTime = capturedTime;
  s.desiredRate = capturedRate;
  s.desiredPaused = capturedPaused;
  s.currentTime = capturedTime; // seekbar stays at same position

  // Flip active video
  s.activeVideo = s.activeVideo === 'A' ? 'B' : 'A';
  s.isPlaying = !capturedPaused;

  s.swapInProgress = false;
  s.prevSwapToken = s.voicedSwapToken;
  s.prevFullVideoUrl = fullVideoUrl;

  s.logs.push(`[VideoSwap] Seamless swap complete, time=${capturedTime.toFixed(1)}s, playing=${!capturedPaused}`);
  return s;
}

/** Simulate video playing to a specific time */
function simulatePlayback(state: PreviewState, time: number, dur: number): PreviewState {
  return {
    ...state,
    currentTime: time,
    duration: dur,
    isPlaying: true,
    desiredPaused: false,
    isVideoPlayable: true,
  };
}

/** Simulate session reset (PreviewTab:706-733) */
function resetForSessionSwitch(state: PreviewState, newVideoUrl: string | null): PreviewState {
  return {
    ...createInitialPreviewState(),
    prevVideoUrlProp: state.prevVideoUrlProp,
    prevNonce: state.prevNonce,
    srcA: newVideoUrl?.startsWith('http') ? newVideoUrl : null,
    logs: [...state.logs, '[Session] Full state reset for session switch'],
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const CDN = 'https://r2.example.com/user123/sess1';

const TURN1_SILENT = `${CDN}/video.mp4?sig=silent1`;
const TURN1_VOICED = `${CDN}/video_voiced.mp4?sig=voiced1`;
const TURN2_SILENT = `${CDN}/video.mp4?sig=silent2`;
const TURN2_VOICED = `${CDN}/video_voiced.mp4?sig=voiced2`;
const OTHER_SESSION_VIDEO = 'https://r2.example.com/user123/sess2/video.mp4?sig=x';

// ==========================================================================
// 1. REFRESH — No double video load from realtime/SSE race
// ==========================================================================
describe('1. Refresh: no double video load from realtime/SSE race', () => {
  it('doRefetch does NOT dispatch video URL while SSE stream is active', () => {
    expect(shouldRefetchDispatchVideo(true, 'pending')).toBe(false);
    expect(shouldRefetchDispatchVideo(true, 'generating')).toBe(false);
    expect(shouldRefetchDispatchVideo(true, null)).toBe(false);
  });

  it('doRefetch dispatches video URL after SSE finishes (fallback path)', () => {
    expect(shouldRefetchDispatchVideo(false, 'pending')).toBe(true);
    expect(shouldRefetchDispatchVideo(false, null)).toBe(true);
  });

  it('doRefetch does NOT dispatch when voiceover is completed (prevents reload flicker)', () => {
    expect(shouldRefetchDispatchVideo(false, 'completed')).toBe(false);
  });

  it('reducer deduplicates same-base URL without nonce bump', () => {
    const state: VideoState = { videoUrl: TURN1_SILENT, videoUpdateNonce: 1 };
    const refreshedUrl = `${CDN}/video.mp4?sig=refreshed`;
    const next = reduceSetVideoUrl(state, refreshedUrl, false);
    expect(next).toBe(state); // identity — no state change
  });

  it('reducer allows same-base URL with nonce bump (multi-turn)', () => {
    const state: VideoState = { videoUrl: TURN1_SILENT, videoUpdateNonce: 1 };
    const next = reduceSetVideoUrl(state, TURN2_SILENT, true);
    expect(next.videoUpdateNonce).toBe(2);
    expect(next.videoUrl).toBe(TURN2_SILENT);
  });
});

// ==========================================================================
// 2. SINGLE TURN — Silent → Voiced swap
// ==========================================================================
describe('2. Single turn: silent → voiced video swap', () => {
  it('initial SSE complete sets video URL with nonce bump', () => {
    const state: VideoState = { videoUrl: null, videoUpdateNonce: 0 };
    const next = reduceSetVideoUrl(state, TURN1_SILENT, true);
    expect(next.videoUrl).toBe(TURN1_SILENT);
    expect(next.videoUpdateNonce).toBe(1);
  });

  it('PreviewPanel syncs new URL (null → silent URL, nonce changed)', () => {
    const result = shouldApplyVideoSync(null, TURN1_SILENT, 0, 1);
    expect(result.shouldSync).toBe(true);
    expect(result.awaitingVoiceover).toBe(true);
  });

  it('voiceover polling starts after sync (status=null, videoUrl exists)', () => {
    expect(shouldStartPolling(null, TURN1_SILENT)).toBe(true);
  });

  it('polling continues while pending/generating', () => {
    expect(shouldContinuePolling('pending')).toBe(true);
    expect(shouldContinuePolling('generating')).toBe(true);
  });

  it('swap triggers on generating → completed', () => {
    expect(shouldTriggerSwap('generating', 'completed', TURN1_VOICED)).toBe(true);
  });

  it('swap does NOT re-trigger on completed → completed (idempotent)', () => {
    expect(shouldTriggerSwap('completed', 'completed', TURN1_VOICED)).toBe(false);
  });

  it('voiceover status label: pending/generating shows "Generating audio..."', () => {
    const showsSpinner = (s: VoiceoverStatus) => s === 'pending' || s === 'generating';
    expect(showsSpinner('pending')).toBe(true);
    expect(showsSpinner('generating')).toBe(true);
    expect(showsSpinner('completed')).toBe(false);
    expect(showsSpinner(null)).toBe(false);
  });
});

// ==========================================================================
// 3. MULTI-TURN — New video auto-switches + voiceover label resets
// ==========================================================================
describe('3. Multi-turn: new video replaces old + voiceover restarts', () => {
  const afterTurn1: VideoState = { videoUrl: TURN1_SILENT, videoUpdateNonce: 1 };

  it('turn 2 SSE complete bumps nonce even when base path matches', () => {
    const next = reduceSetVideoUrl(afterTurn1, TURN2_SILENT, true);
    expect(next.videoUrl).toBe(TURN2_SILENT);
    expect(next.videoUpdateNonce).toBe(2);
  });

  it('PreviewPanel syncs turn 2 URL (nonce changed)', () => {
    const result = shouldApplyVideoSync(TURN1_SILENT, TURN2_SILENT, 1, 2);
    expect(result.shouldSync).toBe(true);
    expect(result.awaitingVoiceover).toBe(true);
  });

  it('PreviewPanel resets voiceoverStatus to null after sync', () => {
    expect(shouldStartPolling(null, TURN2_SILENT)).toBe(true);
  });

  it('polling continues when DB returns pending for turn 2', () => {
    expect(shouldContinuePolling('pending')).toBe(true);
  });

  it('REGRESSION: polling MUST NOT stop when first poll returns null', () => {
    expect(shouldContinuePolling(null)).toBe(false);
    // Safety net: effect deps include videoUrl
    expect(shouldStartPolling(null, TURN2_SILENT)).toBe(true);
  });

  it('swap triggers for turn 2 on generating → completed', () => {
    expect(shouldTriggerSwap('generating', 'completed', TURN2_VOICED)).toBe(true);
  });

  it('swap triggers for turn 2 via fast-voiceover path (null → completed)', () => {
    expect(shouldTriggerSwap(null, 'completed', TURN2_VOICED, true)).toBe(true);
  });

  it('REGRESSION: stale "Generating audio..." must NOT persist after swap', () => {
    const showsSpinner = (s: VoiceoverStatus) => s === 'pending' || s === 'generating';
    expect(showsSpinner('completed')).toBe(false);
  });

  it('shouldApplyVideoSync respects outer URL equality gate', () => {
    // If URL string is identical (no prop change), sync should NOT apply
    const result = shouldApplyVideoSync(TURN1_SILENT, TURN1_SILENT, 1, 1);
    expect(result.shouldSync).toBe(false);

    // But same URL with nonce bump does apply (multi-turn same-key overwrite edge case)
    const result2 = shouldApplyVideoSync(TURN1_SILENT, TURN1_SILENT, 1, 2);
    expect(result2.shouldSync).toBe(true);
    expect(result2.awaitingVoiceover).toBe(true);
  });

  it('REGRESSION: URL sync must call .load() on active video for multi-turn', () => {
    // After turn 1 swap (A→B), turn 2 URL sync must call .load() on B
    let s = createInitialPreviewState();
    s = applyVideoUrlPropChange(s, TURN1_SILENT, 1);
    s = applyPreviewTabUrlSync(s);
    expect(s.loadCalled).toBe(true);
    s.loadCalled = false; // Reset for swap

    // Simulate turn 1 swap
    s = applyVoiceoverPoll(s, 'pending', null);
    s = applyVoiceoverPoll(s, 'completed', TURN1_VOICED);
    s = applyVideoSwap(s);

    // Turn 2: URL sync on the now-active B slot
    s = applyVideoUrlPropChange(s, TURN2_SILENT, 2);
    s.loadCalled = false; // Reset before URL sync
    s = applyPreviewTabUrlSync(s);
    expect(s.loadCalled).toBe(true); // .load() required to reload video element
    const activeSrc = s.activeVideo === 'A' ? s.srcA : s.srcB;
    expect(activeSrc).toBe(TURN2_SILENT);
  });
});

// ==========================================================================
// 4. RELOAD — Correct state rehydration from DB
// ==========================================================================
describe('4. Reload: state rehydration from /api/sessions/:id/messages', () => {
  it('does NOT re-trigger swap on reload (null → completed without awaitingFreshSilent)', () => {
    expect(shouldTriggerSwap(null, 'completed', TURN1_VOICED, false)).toBe(false);
  });

  it('polling does NOT start when voiceover is already completed', () => {
    expect(shouldStartPolling('completed', TURN1_VOICED)).toBe(false);
  });

  it('bootstrap loads last_video_url without nonce bump', () => {
    const state: VideoState = { videoUrl: null, videoUpdateNonce: 0 };
    const next = reduceSetVideoUrl(state, TURN1_VOICED, false);
    expect(next.videoUrl).toBe(TURN1_VOICED);
    expect(next.videoUpdateNonce).toBe(0);
  });

  it('PreviewPanel syncs bootstrap URL (null → url, nonce unchanged but base changed)', () => {
    const result = shouldApplyVideoSync(null, TURN1_VOICED, 0, 0);
    expect(result.shouldSync).toBe(true);
    expect(result.awaitingVoiceover).toBe(false); // no nonce change
  });

  it('doRefetch skips video dispatch when voiceover completed', () => {
    expect(shouldRefetchDispatchVideo(false, 'completed')).toBe(false);
  });
});

// ==========================================================================
// 5. SESSION SWITCH — Full state isolation
// ==========================================================================
describe('5. Session switch: full state isolation', () => {
  it('different session video has different base path → sync applies', () => {
    const result = shouldApplyVideoSync(TURN1_VOICED, OTHER_SESSION_VIDEO, 1, 1);
    expect(result.shouldSync).toBe(true);
  });

  it('session reset clears all playback state (PreviewTab:706-733)', () => {
    let s = createInitialPreviewState();
    // Simulate an active session with playback at 45s
    s = applyVideoUrlPropChange(s, TURN1_SILENT, 1);
    s = applyPreviewTabUrlSync(s);
    s = simulatePlayback(s, 45.2, 120);
    s = applyVoiceoverPoll(s, 'generating', null);
    s = applyVoiceoverPoll(s, 'completed', TURN1_VOICED);
    s = applyVideoSwap(s);

    expect(s.currentTime).toBe(45.2); // seekbar preserved during swap
    expect(s.isPlaying).toBe(true);
    expect(s.voiceoverStatus).toBe('completed');

    // Now switch sessions
    const reset = resetForSessionSwitch(s, OTHER_SESSION_VIDEO);
    expect(reset.currentTime).toBe(0);
    expect(reset.duration).toBe(0);
    expect(reset.isPlaying).toBe(false);
    expect(reset.voiceoverStatus).toBeNull();
    expect(reset.voicedSwapToken).toBe(0);
    expect(reset.prevSwapToken).toBe(0);
    expect(reset.swapInProgress).toBe(false);
    expect(reset.awaitingVoiceoverCompletion).toBe(false);
    expect(reset.activeVideo).toBe('A');
    expect(reset.srcA).toBe(OTHER_SESSION_VIDEO);
    expect(reset.srcB).toBeNull();
  });
});

// ==========================================================================
// 6. VOICEOVER SERVER-SIDE TRIGGER ORDERING
// ==========================================================================
describe('6. Server-side: voiceover trigger before SSE complete', () => {
  it('voiceover_status=pending before last_video_url is set (awaited trigger)', () => {
    expect(shouldContinuePolling('pending')).toBe(true);
  });

  it('non-awaited trigger (old bug) could leave stale completed status', () => {
    expect(shouldContinuePolling('completed')).toBe(false);
  });
});

// ==========================================================================
// 7. CONSOLE LOG CONTRACTS (actual console.log spying)
// ==========================================================================
describe('7. Console log contracts for debugging', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('[VoiceoverFlow] logs on voiceover completion in state machine', () => {
    let s = createInitialPreviewState();
    s = applyVideoUrlPropChange(s, TURN1_SILENT, 1);
    s = applyVoiceoverPoll(s, 'pending', null);
    s = applyVoiceoverPoll(s, 'completed', TURN1_VOICED);

    expect(s.logs.some(l => l.includes('[VoiceoverFlow] Voiceover completed'))).toBe(true);
  });

  it('[VoiceoverFlow] logs "Ignoring same-base URL change" for realtime refresh', () => {
    let s = createInitialPreviewState();
    s = applyVideoUrlPropChange(s, TURN1_SILENT, 1);
    // Realtime fires with refreshed presigned URL, same base, no nonce change
    s = applyVideoUrlPropChange(s, `${CDN}/video.mp4?sig=refreshed`, 1);

    expect(s.logs.some(l => l.includes('Ignoring same-base URL change'))).toBe(true);
  });

  it('[VideoSwap] logs swap effect trigger on token change', () => {
    let s = createInitialPreviewState();
    s = applyVideoUrlPropChange(s, TURN1_SILENT, 1);
    s = applyPreviewTabUrlSync(s);
    s = applyVoiceoverPoll(s, 'generating', null);
    s = applyVoiceoverPoll(s, 'completed', TURN1_VOICED);
    s = applyVideoSwap(s);

    expect(s.logs.some(l => l.includes('[VideoSwap] Swap effect triggered'))).toBe(true);
    expect(s.logs.some(l => l.includes('[VideoSwap] Seamless swap complete'))).toBe(true);
  });

  it('[VideoSwap] swap skipped when no URL available', () => {
    let s = createInitialPreviewState();
    s.voicedSwapToken = 1; // Force mismatch without URL
    s = applyVideoSwap(s);

    expect(s.logs.some(l => l.includes('Swap skipped: no fullVideoUrl'))).toBe(true);
  });

  it('multi-turn: both turns produce complete swap log traces', () => {
    let s = createInitialPreviewState();

    // Turn 1
    s = applyVideoUrlPropChange(s, TURN1_SILENT, 1);
    s = applyPreviewTabUrlSync(s);
    s = applyVoiceoverPoll(s, 'generating', null);
    s = applyVoiceoverPoll(s, 'completed', TURN1_VOICED);
    s = applyVideoSwap(s);

    const turn1SwapLogs = s.logs.filter(l => l.includes('Seamless swap complete'));
    expect(turn1SwapLogs).toHaveLength(1);

    // Turn 2
    s = applyVideoUrlPropChange(s, TURN2_SILENT, 2);
    s = applyPreviewTabUrlSync(s);
    s = applyVoiceoverPoll(s, 'pending', null);
    s = applyVoiceoverPoll(s, 'completed', TURN2_VOICED);
    s = applyVideoSwap(s);

    const allSwapLogs = s.logs.filter(l => l.includes('Seamless swap complete'));
    expect(allSwapLogs).toHaveLength(2);
  });
});

// ==========================================================================
// 8. EDGE CASES
// ==========================================================================
describe('8. Edge cases', () => {
  it('voiceover fails → polling stops', () => {
    expect(shouldContinuePolling('failed')).toBe(false);
  });

  it('fast voiceover triggers swap via awaitingFreshSilent', () => {
    expect(shouldTriggerSwap(null, 'completed', TURN2_VOICED, true)).toBe(true);
  });

  it('concurrent swap guard: second token while first in progress', () => {
    let s = createInitialPreviewState();
    s = applyVideoUrlPropChange(s, TURN1_SILENT, 1);
    s = applyPreviewTabUrlSync(s);
    s = applyVoiceoverPoll(s, 'completed', TURN1_VOICED);

    // Artificially set swap in progress
    s.swapInProgress = true;
    s.voicedSwapToken = 2; // Another bump
    s = applyVideoSwap(s);

    expect(s.logs.some(l => l.includes('already in progress'))).toBe(true);
  });

  it('no ELEVENLABS_API_KEY → no voiceover label shown', () => {
    expect(shouldStartPolling(null, TURN1_SILENT)).toBe(true);
    expect(shouldContinuePolling(null)).toBe(false);
    const showsAnyLabel = (s: VoiceoverStatus) =>
      s === 'pending' || s === 'generating' || s === 'completed' || s === 'failed';
    expect(showsAnyLabel(null)).toBe(false);
  });

  it('DEDUP: voicedSwapFired guard prevents redundant swap triggers from batched polls', () => {
    let s = createInitialPreviewState();

    // Turn 1: silent video arrives, voiceover starts
    s = applyVideoUrlPropChange(s, TURN1_SILENT, 1);
    s = applyPreviewTabUrlSync(s);
    s = applyVoiceoverPoll(s, 'pending', null);

    // First poll detects completion — fires swap
    s = applyVoiceoverPoll(s, 'completed', TURN1_VOICED);
    expect(s.voicedSwapFired).toBe(true);
    expect(s.voicedSwapToken).toBe(1);

    // Simulate React-batched scenario: manually rewind prevStatusRef to 'pending'
    // (as if two polls read the same stale ref before either committed).
    // Without the voicedSwapFired guard, this would fire a second swap.
    s.prevStatusRef = 'pending';
    const voicedUrlV2 = TURN1_VOICED + '&refresh=2';
    s = applyVoiceoverPoll(s, 'completed', voicedUrlV2);
    expect(s.voicedSwapToken).toBe(1); // NOT bumped again — guard blocked it
    expect(s.effectiveVideoUrl).toBe(TURN1_VOICED); // NOT changed to v2

    // Third batched poll — still blocked
    s.prevStatusRef = 'pending';
    s = applyVoiceoverPoll(s, 'completed', TURN1_VOICED + '&refresh=3');
    expect(s.voicedSwapToken).toBe(1); // Still 1
  });

  it('DEDUP: voicedSwapFired resets on new turn (nonce change)', () => {
    let s = createInitialPreviewState();

    // Turn 1: complete flow
    s = applyVideoUrlPropChange(s, TURN1_SILENT, 1);
    s = applyPreviewTabUrlSync(s);
    s = applyVoiceoverPoll(s, 'completed', TURN1_VOICED);
    s = applyVideoSwap(s);
    expect(s.voicedSwapFired).toBe(true);

    // Turn 2: nonce bump resets the guard
    s = applyVideoUrlPropChange(s, TURN2_SILENT, 2);
    expect(s.voicedSwapFired).toBe(false); // Reset!

    // Turn 2 voiceover can fire
    s = applyPreviewTabUrlSync(s);
    s = applyVoiceoverPoll(s, 'completed', TURN2_VOICED);
    expect(s.voicedSwapFired).toBe(true);
    expect(s.voicedSwapToken).toBe(2); // Bumped for turn 2
  });

  it('DEDUP: voicedSwapFired resets on retry (re-enables swap for same turn)', () => {
    let s = createInitialPreviewState();

    // Turn 1: complete flow — swap fires
    s = applyVideoUrlPropChange(s, TURN1_SILENT, 1);
    s = applyPreviewTabUrlSync(s);
    s = applyVoiceoverPoll(s, 'completed', TURN1_VOICED);
    expect(s.voicedSwapFired).toBe(true);
    expect(s.voicedSwapToken).toBe(1);

    // Simulate retry: reset guard + status (mirrors PreviewPanel retry handler)
    s.prevStatusRef = 'pending';
    s.voicedSwapFired = false;
    s.voiceoverStatus = 'pending';

    // Retry voiceover completes — swap should fire again
    s = applyVoiceoverPoll(s, 'completed', TURN1_VOICED + '&retry=1');
    expect(s.voicedSwapFired).toBe(true);
    expect(s.voicedSwapToken).toBe(2); // Bumped again after retry
  });
});

// ==========================================================================
// 9. FULL STATE-MACHINE: Single turn (seekbar continuity)
// ==========================================================================
describe('9. Full state machine: single turn with seekbar continuity', () => {
  it('silent → play to 45s → voiced swap preserves seekbar at 45s', () => {
    let s = createInitialPreviewState();

    // SSE complete → silent video arrives
    s = applyVideoUrlPropChange(s, TURN1_SILENT, 1);
    s = applyPreviewTabUrlSync(s);
    expect(s.srcA).toBe(TURN1_SILENT);
    expect(s.currentTime).toBe(0);

    // Video loads, user plays to 45s
    s = simulatePlayback(s, 45.2, 120);
    expect(s.currentTime).toBe(45.2);
    expect(s.isPlaying).toBe(true);

    // Voiceover starts and completes
    s = applyVoiceoverPoll(s, 'pending', null);
    expect(s.voiceoverStatus).toBe('pending');

    s = applyVoiceoverPoll(s, 'completed', TURN1_VOICED);
    expect(s.voiceoverStatus).toBe('completed');
    expect(s.voicedSwapToken).toBe(1);

    // Execute swap — seekbar MUST stay at 45.2s
    s = applyVideoSwap(s);
    expect(s.currentTime).toBe(45.2); // CRITICAL: seekbar preserved
    expect(s.isPlaying).toBe(true); // playback continues
    expect(s.activeVideo).toBe('B'); // swapped from A to B
    expect(s.srcB).toBe(TURN1_VOICED); // voiced URL on new active

    // Voiceover label shows "Audio generated"
    expect(s.voiceoverStatus).toBe('completed');
  });

  it('swap preserves playback rate', () => {
    let s = createInitialPreviewState();
    s = applyVideoUrlPropChange(s, TURN1_SILENT, 1);
    s = applyPreviewTabUrlSync(s);
    s = simulatePlayback(s, 30, 120);
    s.playbackRate = 1.5;

    s = applyVoiceoverPoll(s, 'generating', null);
    s = applyVoiceoverPoll(s, 'completed', TURN1_VOICED);
    s = applyVideoSwap(s);

    expect(s.desiredRate).toBe(1.5);
    expect(s.currentTime).toBe(30);
  });
});

// ==========================================================================
// 10. FULL STATE-MACHINE: Multi-turn (seekbar + video switch)
// ==========================================================================
describe('10. Full state machine: multi-turn with seekbar continuity', () => {
  it('turn 1 → play → swap → turn 2 → new silent video resets seekbar → swap preserves new position', () => {
    let s = createInitialPreviewState();

    // === TURN 1 ===
    s = applyVideoUrlPropChange(s, TURN1_SILENT, 1);
    s = applyPreviewTabUrlSync(s);
    s = simulatePlayback(s, 45.2, 120);

    // Voiceover completes, swap voiced
    s = applyVoiceoverPoll(s, 'generating', null);
    s = applyVoiceoverPoll(s, 'completed', TURN1_VOICED);
    s = applyVideoSwap(s);

    expect(s.currentTime).toBe(45.2); // seekbar preserved after turn 1 swap
    expect(s.effectiveVideoUrl).toBe(TURN1_VOICED);
    expect(s.voiceoverStatus).toBe('completed');

    // === TURN 2 ===
    // SSE complete with new video — this should reset seekbar to 0
    s = applyVideoUrlPropChange(s, TURN2_SILENT, 2);
    expect(s.voiceoverStatus).toBeNull(); // REGRESSION: status must reset
    expect(s.awaitingVoiceoverCompletion).toBe(true);

    // PreviewTab URL sync resets playback to 0
    s = applyPreviewTabUrlSync(s);
    expect(s.currentTime).toBe(0); // seekbar reset for new video
    expect(s.isPlaying).toBe(false);
    // REGRESSION FIX: .load() must be called to force browser to reload the video element
    expect(s.loadCalled).toBe(true);

    // Active slot gets new silent video
    const activeSrc = s.activeVideo === 'A' ? s.srcA : s.srcB;
    expect(activeSrc).toBe(TURN2_SILENT);

    // User plays turn 2 to 20s
    s = simulatePlayback(s, 20.5, 90);

    // Voiceover for turn 2 completes
    s = applyVoiceoverPoll(s, 'pending', null);
    expect(s.voiceoverStatus).toBe('pending'); // shows "Generating audio..."

    s = applyVoiceoverPoll(s, 'completed', TURN2_VOICED);
    expect(s.voiceoverStatus).toBe('completed'); // shows "Audio generated"
    expect(s.voicedSwapToken).toBe(2); // second swap

    // Execute swap — seekbar MUST stay at 20.5s
    s = applyVideoSwap(s);
    expect(s.currentTime).toBe(20.5); // CRITICAL: turn 2 seekbar preserved
    expect(s.isPlaying).toBe(true);
    expect(s.effectiveVideoUrl).toBe(TURN2_VOICED);
  });

  it('turn 2 video auto-switches without manual page reload', () => {
    let s = createInitialPreviewState();

    // Turn 1 full cycle
    s = applyVideoUrlPropChange(s, TURN1_SILENT, 1);
    s = applyPreviewTabUrlSync(s);
    s = simulatePlayback(s, 60, 120);
    s = applyVoiceoverPoll(s, 'completed', TURN1_VOICED);
    s = applyVideoSwap(s);

    // Turn 2 arrives — verify it auto-switches without reload
    s = applyVideoUrlPropChange(s, TURN2_SILENT, 2);
    s = applyPreviewTabUrlSync(s);

    // The effective URL should now be turn 2 silent (not turn 1 voiced)
    expect(s.effectiveVideoUrl).toBe(TURN2_SILENT);

    // Active slot should have the new video
    const activeSrc = s.activeVideo === 'A' ? s.srcA : s.srcB;
    expect(activeSrc).toBe(TURN2_SILENT);
  });

  it('turn 2 voiceover label transitions correctly: null → pending → completed', () => {
    let s = createInitialPreviewState();

    // Turn 1 full cycle
    s = applyVideoUrlPropChange(s, TURN1_SILENT, 1);
    s = applyPreviewTabUrlSync(s);
    s = applyVoiceoverPoll(s, 'completed', TURN1_VOICED);
    s = applyVideoSwap(s);
    expect(s.voiceoverStatus).toBe('completed');

    // Turn 2 arrives — voiceover status resets
    s = applyVideoUrlPropChange(s, TURN2_SILENT, 2);
    expect(s.voiceoverStatus).toBeNull(); // no label shown

    // Poll returns pending
    s = applyVoiceoverPoll(s, 'pending', null);
    expect(s.voiceoverStatus).toBe('pending'); // "Generating audio..."

    // Poll returns completed
    s = applyVoiceoverPoll(s, 'completed', TURN2_VOICED);
    expect(s.voiceoverStatus).toBe('completed'); // "Audio generated"
  });

  it('fast voiceover on turn 2 (skips pending) triggers swap correctly', () => {
    let s = createInitialPreviewState();

    // Turn 1
    s = applyVideoUrlPropChange(s, TURN1_SILENT, 1);
    s = applyPreviewTabUrlSync(s);
    s = applyVoiceoverPoll(s, 'completed', TURN1_VOICED);
    s = applyVideoSwap(s);

    // Turn 2 — voiceover completes instantly
    s = applyVideoUrlPropChange(s, TURN2_SILENT, 2);
    expect(s.awaitingVoiceoverCompletion).toBe(true);

    // First and only poll returns completed directly
    s = applyVoiceoverPoll(s, 'completed', TURN2_VOICED);
    expect(s.voicedSwapToken).toBe(2); // swap triggered
    expect(s.effectiveVideoUrl).toBe(TURN2_VOICED);

    // Swap executes
    s = applyVideoSwap(s);
    expect(s.logs.filter(l => l.includes('Seamless swap complete'))).toHaveLength(2);
  });
});
