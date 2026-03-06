import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  LOCAL_DB_PATH,
  ensureLocalLayout,
  getLocalSandboxId,
} from "@/lib/local/config";

type JsonLike = Record<string, unknown> | Array<unknown> | string | number | boolean | null;

export interface LocalSession {
  id: string;
  title: string;
  status: string;
  sandbox_id: string | null;
  claude_session_id: string | null;
  model: string;
  aspect_ratio: string | null;
  voice_id: string | null;
  video_path: string | null;
  last_video_url: string | null;
  plan_content: string | null;
  script_content: string | null;
  subtitles_content: string | null;
  chapters: string | null;
  created_at: string;
  updated_at: string;
}

export interface LocalMessage {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface LocalRun {
  id: string;
  session_id: string;
  user_message_id: string | null;
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  sandbox_id: string | null;
  claude_session_id: string | null;
  started_at: string | null;
  last_event_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  video_url: string | null;
  created_at: string;
}

export interface LocalActivityEvent {
  id: number;
  session_id: string;
  run_id: string | null;
  turn_id: string | null;
  type: string;
  message: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

type SessionUpdateInput = Partial<{
  title: string;
  status: string;
  sandbox_id: string | null;
  claude_session_id: string | null;
  model: string;
  aspect_ratio: string | null;
  voice_id: string | null;
  video_path: string | null;
  last_video_url: string | null;
  plan_content: string | null;
  script_content: string | null;
  subtitles_content: string | null;
  chapters: string | null;
}>;

type RunUpdateInput = Partial<{
  status: LocalRun["status"];
  sandbox_id: string | null;
  claude_session_id: string | null;
  started_at: string | null;
  last_event_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  video_url: string | null;
}>;

let db: DatabaseSync | null = null;

function getTableColumns(database: DatabaseSync, tableName: string): Set<string> {
  const rows = database
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name?: unknown }>;
  return new Set(
    rows
      .map((row) => (typeof row.name === "string" ? row.name : null))
      .filter((name): name is string => Boolean(name))
  );
}

function ensureSessionColumns(database: DatabaseSync): void {
  const existing = getTableColumns(database, "sessions");
  const required: Array<{ name: string; ddl: string }> = [
    { name: "voice_id", ddl: "voice_id TEXT" },
    { name: "chapters", ddl: "chapters TEXT" },
    {
      name: "last_user_activity_at",
      ddl: "last_user_activity_at TEXT NOT NULL DEFAULT ''",
    },
  ];

  for (const column of required) {
    if (!existing.has(column.name)) {
      database.exec(`ALTER TABLE sessions ADD COLUMN ${column.ddl};`);
    }
  }
}

function parseJson<T>(raw: unknown): T | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function mapSession(row: Record<string, unknown>): LocalSession {
  return {
    id: String(row.id),
    title: String(row.title),
    status: String(row.status),
    sandbox_id: row.sandbox_id ? String(row.sandbox_id) : null,
    claude_session_id: row.claude_session_id ? String(row.claude_session_id) : null,
    model: String(row.model),
    aspect_ratio: row.aspect_ratio ? String(row.aspect_ratio) : null,
    voice_id: row.voice_id ? String(row.voice_id) : null,
    video_path: row.video_path ? String(row.video_path) : null,
    last_video_url: row.last_video_url ? String(row.last_video_url) : null,
    plan_content: row.plan_content ? String(row.plan_content) : null,
    script_content: row.script_content ? String(row.script_content) : null,
    subtitles_content: row.subtitles_content ? String(row.subtitles_content) : null,
    chapters: row.chapters ? String(row.chapters) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapMessage(row: Record<string, unknown>): LocalMessage {
  return {
    id: String(row.id),
    session_id: String(row.session_id),
    role: (row.role === "assistant" ? "assistant" : "user"),
    content: String(row.content ?? ""),
    metadata: parseJson<Record<string, unknown>>(row.metadata),
    created_at: String(row.created_at),
  };
}

function mapRun(row: Record<string, unknown>): LocalRun {
  return {
    id: String(row.id),
    session_id: String(row.session_id),
    user_message_id: row.user_message_id ? String(row.user_message_id) : null,
    status: String(row.status) as LocalRun["status"],
    sandbox_id: row.sandbox_id ? String(row.sandbox_id) : null,
    claude_session_id: row.claude_session_id ? String(row.claude_session_id) : null,
    started_at: row.started_at ? String(row.started_at) : null,
    last_event_at: row.last_event_at ? String(row.last_event_at) : null,
    finished_at: row.finished_at ? String(row.finished_at) : null,
    error_message: row.error_message ? String(row.error_message) : null,
    video_url: row.video_url ? String(row.video_url) : null,
    created_at: String(row.created_at),
  };
}

function mapActivityEvent(row: Record<string, unknown>): LocalActivityEvent {
  return {
    id: Number(row.id),
    session_id: String(row.session_id),
    run_id: row.run_id ? String(row.run_id) : null,
    turn_id: row.turn_id ? String(row.turn_id) : null,
    type: String(row.type),
    message: String(row.message ?? ""),
    payload: parseJson<Record<string, unknown>>(row.payload),
    created_at: String(row.created_at),
  };
}

function openDb(): DatabaseSync {
  if (db) return db;

  ensureLocalLayout();
  db = new DatabaseSync(LOCAL_DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      sandbox_id TEXT,
      claude_session_id TEXT,
      model TEXT NOT NULL,
      aspect_ratio TEXT,
      voice_id TEXT,
      video_path TEXT,
      last_video_url TEXT,
      plan_content TEXT,
      script_content TEXT,
      subtitles_content TEXT,
      chapters TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_user_activity_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_message_id TEXT,
      status TEXT NOT NULL,
      sandbox_id TEXT,
      claude_session_id TEXT,
      started_at TEXT,
      last_event_at TEXT,
      finished_at TEXT,
      error_message TEXT,
      video_url TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS activity_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      run_id TEXT,
      turn_id TEXT,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      payload TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session_created
      ON messages(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_runs_session_created
      ON runs(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_runs_session_status
      ON runs(session_id, status);
    CREATE INDEX IF NOT EXISTS idx_activity_session_created
      ON activity_events(session_id, created_at);
  `);

  ensureSessionColumns(db);

  return db;
}

export function listLocalSessions(): LocalSession[] {
  const rows = openDb()
    .prepare("SELECT * FROM sessions ORDER BY updated_at DESC")
    .all() as Record<string, unknown>[];
  return rows.map(mapSession);
}

export function createLocalSession(input: {
  id?: string;
  model: string;
  aspect_ratio?: string | null;
  voice_id?: string | null;
}): LocalSession {
  const database = openDb();
  const now = new Date().toISOString();
  const id = input.id || randomUUID();
  const sandboxId = getLocalSandboxId(id);

  database
    .prepare(`
      INSERT INTO sessions (
        id,
        title,
        status,
        sandbox_id,
        claude_session_id,
        model,
        aspect_ratio,
        voice_id,
        video_path,
        last_video_url,
        plan_content,
        script_content,
        subtitles_content,
        chapters,
        created_at,
        updated_at,
        last_user_activity_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `)
    .run(
      id,
      "Untitled Animation",
      "active",
      sandboxId,
      null,
      input.model,
      input.aspect_ratio ?? null,
      input.voice_id ?? null,
      null,
      null,
      null,
      null,
      null,
      null,
      now,
      now,
      now
    );

  const session = getLocalSession(id);
  if (!session) {
    throw new Error(`Failed to create local session ${id}`);
  }
  return session;
}

export function getLocalSession(sessionId: string): LocalSession | null {
  const row = openDb()
    .prepare("SELECT * FROM sessions WHERE id = ?")
    .get(sessionId) as Record<string, unknown> | undefined;
  return row ? mapSession(row) : null;
}

export function updateLocalSession(sessionId: string, updates: SessionUpdateInput): void {
  const allowedColumns = new Set<keyof SessionUpdateInput>([
    "title",
    "status",
    "sandbox_id",
    "claude_session_id",
    "model",
    "aspect_ratio",
    "voice_id",
    "video_path",
    "last_video_url",
    "plan_content",
    "script_content",
    "subtitles_content",
    "chapters",
  ]);

  const keys = Object.keys(updates).filter((k) =>
    allowedColumns.has(k as keyof SessionUpdateInput)
  ) as Array<keyof SessionUpdateInput>;

  if (keys.length === 0) return;

  const assignments: string[] = [];
  const values: unknown[] = [];
  for (const key of keys) {
    assignments.push(`${key} = ?`);
    values.push(updates[key] ?? null);
  }

  const now = new Date().toISOString();
  assignments.push("updated_at = ?");
  values.push(now);

  values.push(sessionId);

  openDb()
    .prepare(`UPDATE sessions SET ${assignments.join(", ")} WHERE id = ?`)
    .run(...values);
}

export function insertLocalMessage(input: {
  session_id: string;
  role: "user" | "assistant";
  content: string;
  metadata?: Record<string, unknown> | null;
}): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  openDb()
    .prepare(`
      INSERT INTO messages (id, session_id, role, content, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(
      id,
      input.session_id,
      input.role,
      input.content,
      input.metadata ? JSON.stringify(input.metadata as JsonLike) : null,
      now
    );
  return id;
}

export function listLocalMessages(sessionId: string): LocalMessage[] {
  const rows = openDb()
    .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC")
    .all(sessionId) as Record<string, unknown>[];
  return rows.map(mapMessage);
}

export function hasLocalMessages(sessionId: string): boolean {
  const row = openDb()
    .prepare("SELECT 1 FROM messages WHERE session_id = ? LIMIT 1")
    .get(sessionId);
  return row !== undefined;
}

export function createLocalRun(input: {
  session_id: string;
  user_message_id?: string | null;
  sandbox_id?: string | null;
  claude_session_id?: string | null;
}): LocalRun {
  const now = new Date().toISOString();
  const id = randomUUID();
  openDb()
    .prepare(`
      INSERT INTO runs (
        id, session_id, user_message_id, status, sandbox_id, claude_session_id,
        started_at, last_event_at, finished_at, error_message, video_url, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL, ?)
    `)
    .run(
      id,
      input.session_id,
      input.user_message_id ?? null,
      "queued",
      input.sandbox_id ?? null,
      input.claude_session_id ?? null,
      now,
      now
    );

  const run = getLocalRun(id);
  if (!run) {
    throw new Error(`Failed to create local run ${id}`);
  }
  return run;
}

export function getLocalRun(runId: string): LocalRun | null {
  const row = openDb()
    .prepare("SELECT * FROM runs WHERE id = ?")
    .get(runId) as Record<string, unknown> | undefined;
  return row ? mapRun(row) : null;
}

export function getLocalLatestRunBySandboxId(sandboxId: string): LocalRun | null {
  const row = openDb()
    .prepare("SELECT * FROM runs WHERE sandbox_id = ? ORDER BY created_at DESC LIMIT 1")
    .get(sandboxId) as Record<string, unknown> | undefined;
  return row ? mapRun(row) : null;
}

export function getLocalActiveRun(sessionId: string): LocalRun | null {
  const row = openDb()
    .prepare(`
      SELECT * FROM runs
      WHERE session_id = ? AND status IN ('queued', 'running')
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .get(sessionId) as Record<string, unknown> | undefined;
  return row ? mapRun(row) : null;
}

export function updateLocalRun(runId: string, updates: RunUpdateInput): void {
  const allowedColumns = new Set<keyof RunUpdateInput>([
    "status",
    "sandbox_id",
    "claude_session_id",
    "started_at",
    "last_event_at",
    "finished_at",
    "error_message",
    "video_url",
  ]);

  const keys = Object.keys(updates).filter((k) =>
    allowedColumns.has(k as keyof RunUpdateInput)
  ) as Array<keyof RunUpdateInput>;
  if (keys.length === 0) return;

  const assignments: string[] = [];
  const values: unknown[] = [];
  for (const key of keys) {
    assignments.push(`${key} = ?`);
    values.push(updates[key] ?? null);
  }
  values.push(runId);

  openDb()
    .prepare(`UPDATE runs SET ${assignments.join(", ")} WHERE id = ?`)
    .run(...values);
}

export function insertLocalActivityEvent(input: {
  session_id: string;
  run_id?: string | null;
  turn_id?: string | null;
  type: string;
  message: string;
  payload?: Record<string, unknown> | null;
}): number {
  const now = new Date().toISOString();
  const result = openDb()
    .prepare(`
      INSERT INTO activity_events (session_id, run_id, turn_id, type, message, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      input.session_id,
      input.run_id ?? null,
      input.turn_id ?? null,
      input.type,
      input.message,
      input.payload ? JSON.stringify(input.payload as JsonLike) : null,
      now
    );

  if (input.run_id) {
    updateLocalRun(input.run_id, { last_event_at: now });
  }
  return Number(result.lastInsertRowid);
}

export function listLocalActivityEvents(sessionId: string): LocalActivityEvent[] {
  const rows = openDb()
    .prepare("SELECT * FROM activity_events WHERE session_id = ? ORDER BY created_at ASC")
    .all(sessionId) as Record<string, unknown>[];
  return rows.map(mapActivityEvent);
}

/**
 * Backfill missing activity_events.turn_id by assigning each orphan event
 * to the latest user message at or before the event timestamp.
 */
export function backfillLocalActivityTurnIds(sessionId: string): void {
  openDb()
    .prepare(`
      UPDATE activity_events
      SET turn_id = (
        SELECT messages.id
        FROM messages
        WHERE messages.session_id = activity_events.session_id
          AND messages.role = 'user'
          AND messages.created_at <= activity_events.created_at
        ORDER BY messages.created_at DESC
        LIMIT 1
      )
      WHERE session_id = ?
        AND turn_id IS NULL
    `)
    .run(sessionId);
}
