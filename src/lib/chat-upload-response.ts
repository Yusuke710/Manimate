function isLikelyHtml(text: string): boolean {
  return /^\s*</.test(text);
}

export async function readUploadErrorResponse(response: Response, fallback: string): Promise<string> {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const payload = await response.json().catch(() => null) as { error?: unknown } | null;
    if (typeof payload?.error === "string" && payload.error.trim()) {
      return payload.error.trim();
    }
  }

  const text = (await response.text().catch(() => "")).trim();

  if (response.status === 413 || /FUNCTION_PAYLOAD_TOO_LARGE|Request Entity Too Large/i.test(text)) {
    return "Upload request was too large.";
  }

  if (!text || isLikelyHtml(text)) {
    return fallback;
  }

  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return firstLine || fallback;
}
