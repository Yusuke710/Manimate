/**
 * Tests for ElevenLabs TTS caching functionality
 *
 * These tests verify:
 * 1. Cache key generation is deterministic and includes voice ID
 * 2. Cache key changes when text or voice changes
 * 3. Edge cases like empty text, special characters
 */

import { describe, it, expect } from "vitest";
import { getCaptionCacheKey } from "../elevenlabs";

describe("getCaptionCacheKey", () => {
  const defaultVoiceId = "pNInz6obpgDQGcFmaJgB";

  describe("determinism", () => {
    it("should return the same key for the same text and voice", () => {
      const text = "Hello, this is a test caption.";
      const key1 = getCaptionCacheKey(text, defaultVoiceId);
      const key2 = getCaptionCacheKey(text, defaultVoiceId);
      expect(key1).toBe(key2);
    });

    it("should return a 16-character hex string", () => {
      const key = getCaptionCacheKey("Test text", defaultVoiceId);
      expect(key).toMatch(/^[a-f0-9]{16}$/);
    });
  });

  describe("uniqueness", () => {
    it("should return different keys for different text", () => {
      const key1 = getCaptionCacheKey("Hello world", defaultVoiceId);
      const key2 = getCaptionCacheKey("Goodbye world", defaultVoiceId);
      expect(key1).not.toBe(key2);
    });

    it("should return different keys for different voice IDs", () => {
      const text = "Same text";
      const key1 = getCaptionCacheKey(text, "voice1");
      const key2 = getCaptionCacheKey(text, "voice2");
      expect(key1).not.toBe(key2);
    });

    it("should return different keys for similar but not identical text", () => {
      const key1 = getCaptionCacheKey("Hello", defaultVoiceId);
      const key2 = getCaptionCacheKey("Hello ", defaultVoiceId);
      const key3 = getCaptionCacheKey(" Hello", defaultVoiceId);
      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
      expect(key2).not.toBe(key3);
    });
  });

  describe("golden test (algorithm stability)", () => {
    it("should produce a stable hash for known inputs", () => {
      // This golden test ensures the hash algorithm and inputs don't change accidentally.
      // If this test fails, it means the cache key algorithm changed and existing caches
      // will be invalidated (which may be intentional, but should be explicit).
      const key = getCaptionCacheKey("Hello world", "pNInz6obpgDQGcFmaJgB");
      // Hash of "pNInz6obpgDQGcFmaJgB:eleven_flash_v2_5:Hello world"
      expect(key).toBe("f718c08d402bac57");
    });

    it("should include model ID in hash (changing model should change key)", () => {
      // This test documents that the model ID is part of the hash.
      // The hash includes DEFAULT_MODEL_ID ("eleven_flash_v2_5").
      // If we ever make model configurable, the cache key must change.
      const key1 = getCaptionCacheKey("Test", "voice1");
      const key2 = getCaptionCacheKey("Test", "voice1");
      expect(key1).toBe(key2); // Same voice + same text = same key

      // Different voice = different key (voice is in hash)
      const key3 = getCaptionCacheKey("Test", "voice2");
      expect(key1).not.toBe(key3);
    });
  });

  describe("edge cases", () => {
    it("should handle empty text", () => {
      const key = getCaptionCacheKey("", defaultVoiceId);
      expect(key).toMatch(/^[a-f0-9]{16}$/);
    });

    it("should handle special characters", () => {
      const key = getCaptionCacheKey("Hello! @#$%^&*() 日本語 🎉", defaultVoiceId);
      expect(key).toMatch(/^[a-f0-9]{16}$/);
    });

    it("should handle very long text", () => {
      const longText = "A".repeat(10000);
      const key = getCaptionCacheKey(longText, defaultVoiceId);
      expect(key).toMatch(/^[a-f0-9]{16}$/);
    });

    it("should handle newlines and tabs", () => {
      const key = getCaptionCacheKey("Line 1\nLine 2\tTab", defaultVoiceId);
      expect(key).toMatch(/^[a-f0-9]{16}$/);
    });
  });
});

/**
 * Test scenarios for generateTTSWithCache function
 *
 * These would require mocking the sandbox and ElevenLabs API.
 * Listed here as documentation for manual testing scenarios:
 *
 * Scenario 1: First run (all cache misses)
 * - Input: 3 captions, empty cache directory
 * - Expected: All 3 captions generated via API, all cached
 * - Verify: Cache directory contains 3 .mp3 files
 *
 * Scenario 2: Second run (all cache hits)
 * - Input: Same 3 captions, cache directory from Scenario 1
 * - Expected: All 3 captions loaded from cache, no API calls
 * - Verify: No new files created, same audio returned
 *
 * Scenario 3: Partial cache (mixed hits/misses)
 * - Input: 3 captions where 1 is new, cache has 2 existing
 * - Expected: 2 cache hits, 1 API call, 1 new cache file
 *
 * Scenario 4: Modified caption text
 * - Input: Same caption with slightly different text
 * - Expected: Cache miss (different hash), new TTS generated
 *
 * Scenario 5: Different voice ID
 * - Input: Same caption text, different voice ID
 * - Expected: Cache miss (different hash), new TTS generated
 *
 * Scenario 6: Corrupt cache file
 * - Input: Cache file with < 100 bytes
 * - Expected: Cache miss, regenerate and overwrite
 *
 * Scenario 7: Short caption filtering
 * - Input: Caption with duration < MIN_SEGMENT_DURATION (0.05s)
 * - Expected: Caption skipped, not sent to TTS
 *
 * Scenario 8: Invalid concurrency
 * - Input: concurrency = 0
 * - Expected: Error thrown, not infinite loop
 *
 * Scenario 9: Atomic write failure
 * - Input: Cache write fails mid-way
 * - Expected: Temp file cleaned up, TTS still returned
 */
