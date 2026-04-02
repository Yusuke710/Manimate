export type PreviewSlot = "A" | "B";

export function buildPreviewLoadKey(
  videoUrl: string | null,
  videoRefreshNonce: number,
): string {
  return `${videoRefreshNonce}:${videoUrl ?? ""}`;
}

export function buildPreviewAssetLoadKey(
  previewLoadKey: string | null,
  assetUrl: string | null,
): string | null {
  if (!previewLoadKey || !assetUrl) return null;
  return `${previewLoadKey}:${assetUrl}`;
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

export function shouldAcceptPreviewAsyncResult(params: {
  requestedLoadKey: string | null;
  responseLoadKey: string | null;
  aborted: boolean;
}): boolean {
  if (params.aborted) return false;
  if (!params.requestedLoadKey || !params.responseLoadKey) return false;
  return params.requestedLoadKey === params.responseLoadKey;
}
