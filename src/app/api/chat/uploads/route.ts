import { NextRequest, NextResponse } from "next/server";
import fsp from "node:fs/promises";
import path from "node:path";
import { normalizeAttachmentExtension, resolveAttachmentContentType } from "@/lib/chat-attachments";
import { ensureLocalSessionLayout } from "@/lib/local/config";
import { getLocalSession } from "@/lib/local/db";
import type { ImageAttachment } from "@/lib/types";

const MAX_ATTACHMENTS = 12;

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

  const attachmentFiles = formData
    .getAll("images")
    .filter((entry): entry is File => entry instanceof File);

  if (attachmentFiles.length === 0) {
    return NextResponse.json({ error: "At least one attachment is required" }, { status: 400 });
  }

  if (attachmentFiles.length > MAX_ATTACHMENTS) {
    return NextResponse.json(
      { error: `Maximum ${MAX_ATTACHMENTS} attachments per request` },
      { status: 400 }
    );
  }

  const { projectDir } = ensureLocalSessionLayout(sessionId);
  const inputDir = path.join(projectDir, "inputs");
  await fsp.mkdir(inputDir, { recursive: true });
  const uploaded: ImageAttachment[] = [];

  for (const file of attachmentFiles) {
    const contentType = resolveAttachmentContentType(file.name, file.type);
    const ext = normalizeAttachmentExtension(file.name, contentType);
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
      type: contentType,
    });
  }

  return NextResponse.json({ images: uploaded });
}
