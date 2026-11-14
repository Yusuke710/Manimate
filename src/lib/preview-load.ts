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

export function shouldAcceptPreviewAsyncResult(params: {
  requestedLoadKey: string | null;
  responseLoadKey: string | null;
  aborted: boolean;
}): boolean {
  if (params.aborted) return false;
  if (!params.requestedLoadKey || !params.responseLoadKey) return false;
  return params.requestedLoadKey === params.responseLoadKey;
}
