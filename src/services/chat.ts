/**
 * Live chat service — DEMO MODE.
 *
 * Stores chat threads & messages in localStorage and broadcasts updates
 * across browser tabs via BroadcastChannel + the storage event.
 *
 * Model:
 *   - 1 thread per agent ↔ supervisor pair (key by agent.id).
 *   - Supervisor sees all their agents. Agent sees their single thread.
 *   - Admin can see everything (read + participate).
 */

import { getCurrentUser, listAgents, type AuthUser } from "./api";

const THREADS_KEY = "aib_chat_threads";
const MESSAGES_KEY = "aib_chat_messages";
const READS_KEY = "aib_chat_reads";
const TYPING_KEY = "aib_chat_typing";
const CHANNEL = "aib:chat";

export type ChatRole = "agent" | "supervisor" | "admin";

export type ChatThread = {
  id: string;            // = agentId for simplicity
  agentId: string;
  agentName: string;
  supervisorId?: string; // user id of supervisor (e.g. "u-supervisor")
  supervisorName?: string;
  branch?: string;
  lastMessageAt?: string;
  lastMessagePreview?: string;
};

export type ChatAttachment = {
  name: string;
  type: string;
  size: number;
  /** data: URL (demo) */
  url: string;
};

export type ChatMessage = {
  id: string;
  threadId: string;
  senderId: string;
  senderName: string;
  senderRole: ChatRole;
  body: string;
  attachment?: ChatAttachment;
  createdAt: string;
};

type ReadsMap = Record<string, Record<string, string>>; // threadId -> userId -> ISO date
type TypingMap = Record<string, Record<string, number>>; // threadId -> userId -> expiry ms

// ---------- storage helpers ----------

function isBrowser() {
  return typeof window !== "undefined";
}

function readJSON<T>(key: string, fallback: T): T {
  if (!isBrowser()) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown) {
  if (!isBrowser()) return;
  localStorage.setItem(key, JSON.stringify(value));
}

function uid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ---------- broadcast ----------

let bc: BroadcastChannel | null = null;
function getBC(): BroadcastChannel | null {
  if (!isBrowser()) return null;
  if (typeof BroadcastChannel === "undefined") return null;
  if (!bc) bc = new BroadcastChannel(CHANNEL);
  return bc;
}

function broadcast(kind: string, payload?: unknown) {
  if (!isBrowser()) return;
  const ch = getBC();
  ch?.postMessage({ kind, payload, ts: Date.now() });
  // Fire same-tab event too
  window.dispatchEvent(new CustomEvent("aib:chat:change", { detail: { kind, payload } }));
}

export function subscribeChat(cb: (kind: string) => void): () => void {
  if (!isBrowser()) return () => {};
  const onMsg = (e: MessageEvent) => cb(e.data?.kind ?? "*");
  const onLocal = (e: Event) => cb((e as CustomEvent).detail?.kind ?? "*");
  const onStorage = (e: StorageEvent) => {
    if (e.key && [MESSAGES_KEY, THREADS_KEY, READS_KEY, TYPING_KEY].includes(e.key)) cb("*");
  };
  const ch = getBC();
  ch?.addEventListener("message", onMsg);
  window.addEventListener("aib:chat:change", onLocal);
  window.addEventListener("storage", onStorage);
  return () => {
    ch?.removeEventListener("message", onMsg);
    window.removeEventListener("aib:chat:change", onLocal);
    window.removeEventListener("storage", onStorage);
  };
}

// ---------- threads ----------

function readThreads(): ChatThread[] {
  return readJSON<ChatThread[]>(THREADS_KEY, []);
}
function writeThreads(list: ChatThread[]) {
  writeJSON(THREADS_KEY, list);
}

/** Build/refresh threads from current agent directory.
 *  Each agent (role=agent) with a supervisor gets a thread.
 */
export function syncThreads(): ChatThread[] {
  const agents = listAgents();
  const supervisors = agents.filter((a) => a.role === "supervisor");
  const existing = readThreads();
  const map = new Map(existing.map((t) => [t.id, t]));

  for (const a of agents) {
    if (a.role !== "agent") continue;
    // Find supervisor: prefer explicit supervisorId on agent, else same-branch supervisor.
    const explicit = (a as Agent & { supervisorId?: string }).supervisorId;
    let sup = explicit ? supervisors.find((s) => s.id === explicit || s.userId === explicit) : undefined;
    if (!sup) sup = supervisors.find((s) => s.branch === a.branch);
    if (!sup) continue;
    const prev = map.get(a.id);
    map.set(a.id, {
      id: a.id,
      agentId: a.id,
      agentName: a.name,
      supervisorId: sup.userId ?? `agent:${sup.id}`,
      supervisorName: sup.name,
      branch: a.branch,
      lastMessageAt: prev?.lastMessageAt,
      lastMessagePreview: prev?.lastMessagePreview,
    });
  }
  const list = Array.from(map.values());
  writeThreads(list);
  return list;
}

/** Threads visible to the current user. */
export function listThreadsForUser(user: AuthUser): ChatThread[] {
  const all = syncThreads();
  if (user.role === "admin") return all;
  if (user.role === "supervisor") {
    return all.filter(
      (t) =>
        t.supervisorId === user.id ||
        t.supervisorName === user.name ||
        // demo: supervisor user matches by branch when no explicit link
        false,
    );
  }
  // agent — single thread keyed by agentId
  if (user.agentId) return all.filter((t) => t.agentId === user.agentId);
  return [];
}

/** Get-or-create thread for a given agent id. */
export function ensureThread(agentId: string): ChatThread | null {
  const list = syncThreads();
  return list.find((t) => t.agentId === agentId) ?? null;
}

// Re-import Agent type for syncThreads
import type { Agent } from "./api";

// ---------- messages ----------

function readAllMessages(): Record<string, ChatMessage[]> {
  return readJSON<Record<string, ChatMessage[]>>(MESSAGES_KEY, {});
}
function writeAllMessages(map: Record<string, ChatMessage[]>) {
  writeJSON(MESSAGES_KEY, map);
}

export function listMessages(threadId: string): ChatMessage[] {
  return readAllMessages()[threadId] ?? [];
}

export async function sendMessage(input: {
  threadId: string;
  body: string;
  file?: File | null;
}): Promise<ChatMessage> {
  const me = getCurrentUser();
  if (!me) throw new Error("Not authenticated");
  const text = (input.body ?? "").trim();
  let attachment: ChatAttachment | undefined;
  if (input.file) {
    attachment = {
      name: input.file.name,
      type: input.file.type,
      size: input.file.size,
      url: await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = rej;
        r.readAsDataURL(input.file as File);
      }),
    };
  }
  if (!text && !attachment) throw new Error("Empty message");

  const msg: ChatMessage = {
    id: uid(),
    threadId: input.threadId,
    senderId: me.id,
    senderName: me.name,
    senderRole: (me.role as ChatRole),
    body: text,
    attachment,
    createdAt: new Date().toISOString(),
  };

  const map = readAllMessages();
  map[input.threadId] = [...(map[input.threadId] ?? []), msg];
  writeAllMessages(map);

  // Update thread preview
  const threads = readThreads();
  const idx = threads.findIndex((t) => t.id === input.threadId);
  if (idx !== -1) {
    threads[idx] = {
      ...threads[idx],
      lastMessageAt: msg.createdAt,
      lastMessagePreview: text || (attachment ? "📎 " + attachment.name : ""),
    };
    writeThreads(threads);
  }

  // Mark sender as read for this thread
  markRead(input.threadId);

  broadcast("message", { threadId: input.threadId });
  return msg;
}

// ---------- read receipts ----------

function readReads(): ReadsMap {
  return readJSON<ReadsMap>(READS_KEY, {});
}
function writeReads(map: ReadsMap) {
  writeJSON(READS_KEY, map);
}

export function markRead(threadId: string) {
  const me = getCurrentUser();
  if (!me) return;
  const map = readReads();
  map[threadId] = { ...(map[threadId] ?? {}), [me.id]: new Date().toISOString() };
  writeReads(map);
  broadcast("read", { threadId, userId: me.id });
}

export function getLastRead(threadId: string, userId: string): string | undefined {
  return readReads()[threadId]?.[userId];
}

export function unreadCountForThread(threadId: string, userId: string): number {
  const lastRead = getLastRead(threadId, userId);
  const msgs = listMessages(threadId);
  return msgs.filter((m) => m.senderId !== userId && (!lastRead || m.createdAt > lastRead)).length;
}

export function totalUnreadForUser(user: AuthUser): number {
  const threads = listThreadsForUser(user);
  return threads.reduce((acc, t) => acc + unreadCountForThread(t.id, user.id), 0);
}

// ---------- typing ----------

function readTyping(): TypingMap {
  return readJSON<TypingMap>(TYPING_KEY, {});
}
function writeTyping(map: TypingMap) {
  writeJSON(TYPING_KEY, map);
}

export function setTyping(threadId: string, durationMs = 3500) {
  const me = getCurrentUser();
  if (!me) return;
  const map = readTyping();
  map[threadId] = { ...(map[threadId] ?? {}), [me.id]: Date.now() + durationMs };
  writeTyping(map);
  broadcast("typing", { threadId, userId: me.id });
}

export function getTypingUsers(threadId: string, excludeUserId: string): string[] {
  const map = readTyping();
  const now = Date.now();
  const obj = map[threadId] ?? {};
  return Object.entries(obj)
    .filter(([uid, expiry]) => uid !== excludeUserId && expiry > now)
    .map(([uid]) => uid);
}
