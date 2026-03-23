import { NextRequest, NextResponse } from "next/server";
import fsp from "node:fs/promises";
import path from "node:path";
import { ensureLocalSessionLayout } from "@/lib/local/config";
import { getLocalSession } from "@/lib/local/db";
import type { ImageAttachment } from "@/lib/types";

const MAX_IMAGES = 12;
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

function getImageExtension(name: string, type: string): string {
  const extFromName = name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (extFromName) return extFromName;
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/gif") return "gif";
  if (type === "application/pdf") return "pdf";
  return "png";
}

export async function POST(request: NextRequest): Promise<Response> {
  const formData = await request.formData();
  const sessionId = formData.get("session_id") as string | null;

  if (!sessionId) {
    return NextResponse.json({ error: "session_id is required" }, { status: 400 });
  }

  const session = getLocalSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const imageFiles = formData
    .getAll("images")
    .filter((entry): entry is File => entry instanceof File);

  if (imageFiles.length === 0) {
    return NextResponse.json({ error: "At least one attachment is required" }, { status: 400 });
  }

  if (imageFiles.length > MAX_IMAGES) {
    return NextResponse.json(
      { error: `Maximum ${MAX_IMAGES} attachments per request` },
      { status: 400 }
    );
  }

  for (const file of imageFiles) {
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: `Invalid file type: ${file.type}. Allowed: png, jpeg, webp, gif, pdf` },
        { status: 400 }
      );
    }
    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json(
        { error: `File "${file.name}" exceeds 10MB limit` },
        { status: 400 }
      );
    }
  }

  const { projectDir } = ensureLocalSessionLayout(sessionId);
  const inputDir = path.join(projectDir, "inputs");
  await fsp.mkdir(inputDir, { recursive: true });
  const uploaded: ImageAttachment[] = [];

  for (const file of imageFiles) {
    const ext = getImageExtension(file.name, file.type);
    const id = crypto.randomUUID();
    const filename = `${id}.${ext}`;
    const absolutePath = path.join(inputDir, filename);

    const buffer = Buffer.from(await file.arrayBuffer());
    await fsp.writeFile(absolutePath, buffer);

    uploaded.push({
      id,
      path: absolutePath,
      name: file.name,
      size: file.size,
      type: file.type,
    });
  }

  return NextResponse.json({ images: uploaded });
}
