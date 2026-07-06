#!/usr/bin/env node
/**
 * One-time migration: SQLite (~/.manimate/db/app.db) -> session.json per session dir.
 *
 * - Writes <sessions-root>/<id>/session.json (schema version 2).
 * - Folds each session's runs into the user message that started them.
 * - Converts absolute video paths to session-relative ones.
 * - Backfills project/plan.md, script.py, subtitles.srt from DB content columns
 *   when the file is missing on disk, so dropping those columns loses nothing.
 * - Leaves the SQLite database untouched (rollback safety net).
 *
 * Usage:
 *   node scripts/migrate-sessions-to-json.mjs [--dry-run] [--force]
 *
 *   --dry-run  report what would be written without writing
 *   --force    overwrite existing session.json files
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const LOCAL_ROOT = process.env.MANIMATE_LOCAL_ROOT || path.join(os.homedir(), ".manimate");
const DB_PATH = path.join(LOCAL_ROOT, "db", "app.db");
const SESSIONS_ROOT = path.join(LOCAL_ROOT, "sessions");

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

function sanitizeLocalId(id) {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function parseJson(raw) {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toRelativeVideoPath(sessionRoot, videoPath) {
  if (!videoPath) return null;
  const relative = path.relative(sessionRoot, videoPath);
  return relative.startsWith("..") ? videoPath : relative;
}

function statVersion(filePath) {
  try {
    return Math.round(fs.statSync(filePath).mtimeMs);
  } catch {
    return null;
  }
}

function backfillArtifact(projectDir, fileName, content, stats) {
  if (!content) return;
  const filePath = path.join(projectDir, fileName);
  if (fs.existsSync(filePath)) return;
  stats.backfilled.push(path.basename(projectDir) === "project" ? fileName : filePath);
  if (dryRun) return;
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

if (!fs.existsSync(DB_PATH)) {
  console.error(`No database at ${DB_PATH} — nothing to migrate.`);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });

const sessions = db.prepare("SELECT * FROM sessions ORDER BY created_at ASC").all();
const allMessages = db
  .prepare("SELECT * FROM messages ORDER BY created_at ASC, id ASC")
  .all();
const allRuns = db.prepare("SELECT * FROM runs ORDER BY created_at ASC").all();

const messagesBySession = new Map();
for (const message of allMessages) {
  const list = messagesBySession.get(message.session_id) || [];
  list.push(message);
  messagesBySession.set(message.session_id, list);
}

const runsBySession = new Map();
for (const run of allRuns) {
  const list = runsBySession.get(run.session_id) || [];
  list.push(run);
  runsBySession.set(run.session_id, list);
}

let written = 0;
let skippedExisting = 0;
let orphanRuns = 0;
const backfillTotals = [];

for (const session of sessions) {
  const sessionRoot = path.join(SESSIONS_ROOT, sanitizeLocalId(session.id));
  const projectDir = path.join(sessionRoot, "project");
  const outPath = path.join(sessionRoot, "session.json");

  if (fs.existsSync(outPath) && !force) {
    skippedExisting += 1;
    continue;
  }

  const stats = { backfilled: [] };
  backfillArtifact(projectDir, "plan.md", session.plan_content, stats);
  backfillArtifact(projectDir, "script.py", session.script_content, stats);
  backfillArtifact(projectDir, "subtitles.srt", session.subtitles_content, stats);
  if (stats.backfilled.length > 0) {
    backfillTotals.push(`${session.id}: ${stats.backfilled.join(", ")}`);
  }

  const runByMessageId = new Map();
  const sessionRuns = runsBySession.get(session.id) || [];
  const sessionMessages = messagesBySession.get(session.id) || [];

  for (const run of sessionRuns) {
    let messageId = run.user_message_id;
    if (!messageId || !sessionMessages.some((m) => m.id === messageId)) {
      // Attach to the latest user message at or before the run's creation.
      const candidate = [...sessionMessages]
        .reverse()
        .find((m) => m.role === "user" && m.created_at <= run.created_at);
      messageId = candidate?.id ?? null;
    }
    if (!messageId) {
      orphanRuns += 1;
      continue;
    }
    // Last run per message wins (retries after failures reuse the message).
    runByMessageId.set(messageId, run);
  }

  const messages = sessionMessages.map((message) => {
    const entry = {
      id: message.id,
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content ?? "",
      metadata: parseJson(message.metadata),
      created_at: message.created_at,
    };
    const run = runByMessageId.get(message.id);
    if (run) {
      entry.run = {
        id: run.id,
        status: run.status,
        pid: run.pid ?? null,
        agent_session_id: run.agent_session_id ?? run.claude_session_id ?? null,
        started_at: run.started_at ?? null,
        last_event_at: run.last_event_at ?? null,
        finished_at: run.finished_at ?? null,
        error: run.error_message ?? null,
        video_url: run.video_url ?? null,
        created_at: run.created_at,
      };
    }
    return entry;
  });

  const chapters = parseJson(session.chapters);
  const relativeVideoPath = toRelativeVideoPath(sessionRoot, session.video_path);
  const video = relativeVideoPath
    ? {
        path: relativeVideoPath,
        version: statVersion(path.join(sessionRoot, relativeVideoPath)),
        chapters: Array.isArray(chapters) && chapters.length > 0 ? chapters : null,
      }
    : null;

  const stored = {
    version: 2,
    id: session.id,
    session_number: session.session_number ?? 0,
    title: session.title ?? "Untitled Animation",
    status: session.status ?? "active",
    model: session.model ?? "claude",
    agent_session_id: session.agent_session_id ?? session.claude_session_id ?? null,
    aspect_ratio: session.aspect_ratio ?? null,
    voice_id: session.voice_id ?? null,
    created_at: session.created_at,
    updated_at: session.updated_at,
    last_user_activity_at: session.last_user_activity_at || session.updated_at || session.created_at,
    video,
    cloud: {
      status: session.cloud_sync_status ?? "idle",
      last_synced_at: session.cloud_last_synced_at ?? null,
      last_error: session.cloud_last_error ?? null,
      public_video_url: session.cloud_public_video_url ?? null,
    },
    messages,
  };

  if (!dryRun) {
    fs.mkdirSync(sessionRoot, { recursive: true });
    const tmpPath = `${outPath}.migrate.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(stored, null, 2));
    fs.renameSync(tmpPath, outPath);
  }
  written += 1;
}

db.close();

console.log(`${dryRun ? "[dry-run] Would write" : "Wrote"} ${written} session.json files`);
if (skippedExisting > 0) console.log(`Skipped ${skippedExisting} sessions with existing session.json (use --force to overwrite)`);
if (orphanRuns > 0) console.log(`Dropped ${orphanRuns} runs with no attributable user message`);
if (backfillTotals.length > 0) {
  console.log(`Backfilled ${backfillTotals.length} sessions' artifacts from DB content columns:`);
  for (const line of backfillTotals.slice(0, 20)) console.log(`  ${line}`);
  if (backfillTotals.length > 20) console.log(`  ... and ${backfillTotals.length - 20} more`);
}
console.log(`Database left untouched at ${DB_PATH}`);
