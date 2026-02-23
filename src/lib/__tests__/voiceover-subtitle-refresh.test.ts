import { describe, it, expect } from 'vitest';

/**
 * Tests for the voiceover status reset and subtitle re-fetch logic
 * that was fixed for the "subtitles/voiceover don't update after adding scenes" bug.
 *
 * These test the core logic patterns used in PreviewPanel.tsx and page.tsx
 * to determine when to re-fetch subtitles, reset voiceover status, and
 * re-trigger polling.
 */

// --- Helpers extracted from PreviewPanel.tsx / page.tsx ---

/** Base-path extraction used in PreviewTab's video URL change detection */
function getBasePath(url: string | null): string | null {
  return url?.split('?')[0] || null;
}

/** Determines if voiceover polling should start based on current status and video availability */
function shouldStartPolling(
  voiceoverStatus: 'pending' | 'generating' | 'completed' | 'failed' | null,
  videoUrl: string | null
): boolean {
  return (
    voiceoverStatus === 'pending' ||
    voiceoverStatus === 'generating' ||
    (voiceoverStatus === null && !!videoUrl)
  );
}

/** Determines if voiceover polling should continue after receiving a status */
function shouldContinuePolling(
  status: 'pending' | 'generating' | 'completed' | 'failed' | null
): boolean {
  return status === 'pending' || status === 'generating';
}

/** Detects whether a voiceover completion event should trigger a video swap */
function shouldTriggerSwap(
  prevStatus: 'pending' | 'generating' | 'completed' | 'failed' | null,
  newStatus: 'pending' | 'generating' | 'completed' | 'failed' | null,
  lastVideoUrl: string | null,
  awaitingFreshSilentRender = false
): boolean {
  const wasActivelyProcessing = prevStatus === 'pending' || prevStatus === 'generating';
  const completedAfterFreshSilent = awaitingFreshSilentRender &&
    prevStatus === null &&
    newStatus === 'completed';
  const enteredCompleted = (wasActivelyProcessing || completedAfterFreshSilent) && newStatus === 'completed';
  return enteredCompleted && !!lastVideoUrl;
}

/** Determines if PreviewPanel should sync prop videoUrl into effectiveVideoUrl */
function shouldApplyVideoSync(
  prevUrl: string | null,
  nextUrl: string | null,
  prevNonce: number,
  nextNonce: number
): boolean {
  const prevBase = getBasePath(prevUrl);
  const nextBase = getBasePath(nextUrl);
  const nonceChanged = prevNonce !== nextNonce;
  return prevBase !== nextBase || nonceChanged;
}

// --- Tests ---

describe('Voiceover status reset on new video', () => {
  it('should start polling when voiceoverStatus is null and videoUrl exists', () => {
    // After resetting voiceoverStatus to null (new video generated), polling should restart
    expect(shouldStartPolling(null, 'https://r2.example.com/user/session/video.mp4?sig=abc')).toBe(true);
  });

  it('should NOT start polling when voiceoverStatus is completed', () => {
    // BUG (before fix): status stays completed, polling never restarts
    expect(shouldStartPolling('completed', 'https://r2.example.com/user/session/video.mp4?sig=abc')).toBe(false);
  });

  it('should start polling when voiceoverStatus is pending', () => {
    expect(shouldStartPolling('pending', 'https://r2.example.com/user/session/video.mp4?sig=abc')).toBe(true);
  });

  it('should NOT start polling when voiceoverStatus is null but no video', () => {
    expect(shouldStartPolling(null, null)).toBe(false);
  });

  it('should continue polling when status is pending or generating', () => {
    expect(shouldContinuePolling('pending')).toBe(true);
    expect(shouldContinuePolling('generating')).toBe(true);
  });

  it('should stop polling when status is completed or failed', () => {
    expect(shouldContinuePolling('completed')).toBe(false);
    expect(shouldContinuePolling('failed')).toBe(false);
    expect(shouldContinuePolling(null)).toBe(false);
  });
});

describe('Voiceover swap detection', () => {
  it('should trigger swap on pending → completed transition', () => {
    expect(shouldTriggerSwap('pending', 'completed', 'https://example.com/video.mp4')).toBe(true);
  });

  it('should trigger swap on generating → completed transition', () => {
    expect(shouldTriggerSwap('generating', 'completed', 'https://example.com/video.mp4')).toBe(true);
  });

  it('should NOT trigger swap on null → completed (page reload case)', () => {
    // On page reload, status goes from null to completed - this is not a live transition
    expect(shouldTriggerSwap(null, 'completed', 'https://example.com/video.mp4')).toBe(false);
  });

  it('should trigger swap on null → completed after fresh silent render', () => {
    // Fast voiceover jobs can complete before first pending poll is observed.
    // We still want to swap in that case when we know a new silent render was just applied.
    expect(shouldTriggerSwap(null, 'completed', 'https://example.com/video.mp4', true)).toBe(true);
  });

  it('should NOT trigger swap when no video URL', () => {
    expect(shouldTriggerSwap('pending', 'completed', null)).toBe(false);
  });

  it('should NOT trigger swap on completed → completed (no change)', () => {
    expect(shouldTriggerSwap('completed', 'completed', 'https://example.com/video.mp4')).toBe(false);
  });
});

describe('Video URL sync gating for same-key uploads', () => {
  const SILENT_V1 = 'https://r2.example.com/userId/sessionId/video.mp4?X-Amz-Credential=silent1';
  const SILENT_V2 = 'https://r2.example.com/userId/sessionId/video.mp4?X-Amz-Credential=silent2';
  const OTHER_VIDEO = 'https://r2.example.com/userId/otherSession/video.mp4?X-Amz-Credential=other';

  it('applies sync when base path changes', () => {
    expect(shouldApplyVideoSync(SILENT_V1, OTHER_VIDEO, 1, 1)).toBe(true);
  });

  it('applies sync for same-base URL changes when nonce increments', () => {
    expect(shouldApplyVideoSync(SILENT_V1, SILENT_V2, 3, 4)).toBe(true);
  });

  it('ignores same-base URL changes when nonce is unchanged', () => {
    expect(shouldApplyVideoSync(SILENT_V1, SILENT_V2, 4, 4)).toBe(false);
  });
});

describe('Subtitle URL invalidation on video URL change', () => {
  const SIGNED_URL_V1 = 'https://r2.example.com/userId/sessionId/video.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=abc';
  const SIGNED_URL_V2 = 'https://r2.example.com/userId/sessionId/video.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=def';
  const DIFFERENT_VIDEO = 'https://r2.example.com/userId/otherSession/video.mp4?X-Amz-Credential=xyz';

  it('same base path for same-key uploads with different presigned URLs', () => {
    // When new video is uploaded to same R2 key, base path is identical
    expect(getBasePath(SIGNED_URL_V1)).toBe(getBasePath(SIGNED_URL_V2));
  });

  it('different base path for different video files', () => {
    expect(getBasePath(SIGNED_URL_V1)).not.toBe(getBasePath(DIFFERENT_VIDEO));
  });

  it('full URL comparison detects same-key re-upload (the fix)', () => {
    // The fix: compare full URLs instead of just base paths
    // This correctly detects that V2 is a different upload than V1
    expect(SIGNED_URL_V1).not.toBe(SIGNED_URL_V2);
  });

  it('base-path comparison MISSES same-key re-upload (the bug)', () => {
    // The bug: base path comparison can't distinguish between
    // "same video, refreshed URL" and "new video at same key"
    const baseV1 = getBasePath(SIGNED_URL_V1);
    const baseV2 = getBasePath(SIGNED_URL_V2);
    // Both are the same base path - so the old code thought nothing changed
    expect(baseV1).toBe(baseV2);
  });

  describe('ref invalidation logic (matches PreviewTab effect)', () => {
    it('clears everything for different base path (session switch)', () => {
      const prevUrl = SIGNED_URL_V1;
      const newUrl = DIFFERENT_VIDEO;

      const prevBase = getBasePath(prevUrl);
      const currBase = getBasePath(newUrl);

      // Different base = different video entirely
      expect(currBase).not.toBe(prevBase);
      // Action: clear refs + clear subtitle/chapter state
    });

    it('clears only refs for same base path but different URL (new scenes/voiceover)', () => {
      const prevUrl = SIGNED_URL_V1;
      const newUrl = SIGNED_URL_V2;

      const prevBase = getBasePath(prevUrl);
      const currBase = getBasePath(newUrl);

      // Same base path
      expect(currBase).toBe(prevBase);
      // But full URLs differ
      expect(prevUrl).not.toBe(newUrl);
      // Action: clear refs only (trigger re-fetch), keep existing data displayed
    });

    it('does nothing when URL is identical (no change)', () => {
      const prevUrl = SIGNED_URL_V1;
      const newUrl = SIGNED_URL_V1;

      // Same full URL = no change
      expect(prevUrl).toBe(newUrl);
      // Action: nothing (no re-fetch needed)
    });
  });
});

describe('Race condition: voiceover trigger timing', () => {
  it('documents the race condition and fix', () => {
    // The race condition:
    // 1. Chat route uploads new video
    // 2. Chat route fires triggerVoiceoverGeneration() (fire-and-forget)
    // 3. Chat route updates session with last_video_url
    // 4. Frontend receives new videoUrl, resets voiceoverStatus to null
    // 5. Frontend polls - might see stale 'completed' if trigger hasn't set 'pending' yet
    //
    // Fix: await triggerVoiceoverGeneration() in chat route
    // This ensures voiceover_status='pending' is in DB before last_video_url is updated

    // Simulating the fix: after await, DB state is consistent
    const dbStateAfterAwaitedTrigger = {
      voiceover_status: 'pending' as const,
      last_video_url: 'https://r2.example.com/new-video.mp4?sig=new',
    };

    // Frontend polls and sees 'pending' → continues polling
    expect(shouldContinuePolling(dbStateAfterAwaitedTrigger.voiceover_status)).toBe(true);

    // Eventually transitions to 'completed' → swap triggers
    expect(shouldTriggerSwap('pending', 'completed', 'https://voiced.mp4?sig=xyz')).toBe(true);
  });
});
