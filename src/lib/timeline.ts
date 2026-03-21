export interface TimelineChapter {
  name: string;
  start: number;
  duration: number;
}

export interface NormalizedChapterTimeline {
  chapters: TimelineChapter[];
  totalDuration: number;
}

const MAX_CHAPTER_TIMELINE_DRIFT_SECONDS = 2;
const MAX_CHAPTER_TIMELINE_DRIFT_RATIO = 0.02;

function scaleChaptersToVideoDuration(
  chapters: TimelineChapter[],
  chapterTotalDuration: number,
  videoDuration: number
): NormalizedChapterTimeline {
  const scale = videoDuration / chapterTotalDuration;
  const lastIndex = chapters.length - 1;
  let offset = 0;

  return {
    chapters: chapters.map((chapter, index) => {
      const duration = index === lastIndex
        ? videoDuration - offset
        : chapter.duration * scale;
      const normalizedChapter = {
        ...chapter,
        start: offset,
        duration,
      };
      offset += duration;
      return normalizedChapter;
    }),
    totalDuration: videoDuration,
  };
}

export function normalizeChaptersToVideoDuration(
  chapters: TimelineChapter[],
  videoDuration: number
): NormalizedChapterTimeline | null {
  if (chapters.length <= 1) return null;
  if (!Number.isFinite(videoDuration) || videoDuration <= 0) return null;

  const chapterTotalDuration = chapters.reduce(
    (sum, chapter) => sum + chapter.duration,
    0
  );
  if (!Number.isFinite(chapterTotalDuration) || chapterTotalDuration <= 0) {
    return null;
  }

  const drift = videoDuration - chapterTotalDuration;
  const maxAllowedDrift = Math.max(
    MAX_CHAPTER_TIMELINE_DRIFT_SECONDS,
    videoDuration * MAX_CHAPTER_TIMELINE_DRIFT_RATIO
  );
  if (Math.abs(drift) > maxAllowedDrift) {
    return scaleChaptersToVideoDuration(
      chapters,
      chapterTotalDuration,
      videoDuration
    );
  }

  const lastIndex = chapters.length - 1;
  const adjustedLastDuration = chapters[lastIndex].duration + drift;
  if (!Number.isFinite(adjustedLastDuration) || adjustedLastDuration <= 0) {
    return null;
  }

  return {
    chapters: chapters.map((chapter, index) =>
      index === lastIndex
        ? { ...chapter, duration: adjustedLastDuration }
        : chapter
    ),
    totalDuration: videoDuration,
  };
}
