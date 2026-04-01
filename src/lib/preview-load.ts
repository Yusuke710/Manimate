export type PreviewSlot = "A" | "B";

export function buildPreviewLoadKey(
  videoUrl: string | null,
  videoRefreshNonce: number,
): string {
  return `${videoRefreshNonce}:${videoUrl ?? ""}`;
}

export function shouldResetPreviewReady(params: {
  previousVideoUrl: string | null;
  nextVideoUrl: string | null;
  previousVideoRefreshNonce: number;
  nextVideoRefreshNonce: number;
}): boolean {
  return (
    params.previousVideoUrl !== params.nextVideoUrl ||
    params.previousVideoRefreshNonce !== params.nextVideoRefreshNonce
  );
}

export function shouldAcceptPreviewCanPlay(params: {
  activeSlot: PreviewSlot;
  eventSlot: PreviewSlot;
  requestedLoadId: number;
  eventLoadId: number;
  requestedUrl: string | null;
  slotUrl: string | null;
}): boolean {
  if (!params.requestedUrl || !params.slotUrl) return false;

  return (
    params.activeSlot === params.eventSlot &&
    params.requestedLoadId === params.eventLoadId &&
    params.requestedUrl === params.slotUrl
  );
}
