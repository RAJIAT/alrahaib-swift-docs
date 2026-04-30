import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, MessageSquare, Paperclip, Send, X } from "lucide-react";
import { useLang } from "@/i18n/LanguageProvider";
import { getCurrentUser } from "@/services/api";
import {
  getTypingUsers,
  markRead,
  sendMessage,
  setTyping,
  subscribeChat,
  type ChatMessage,
  type ChatThread,
} from "@/services/chat";
import { useChatMessages, useChatThreads, useUnreadTotal, useThreadUnread } from "@/hooks/useChat";

export function ChatWidget() {
  const { t, dir } = useLang();
  const [user, setUser] = useState(() => getCurrentUser());
  const [open, setOpen] = useState(false);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const threads = useChatThreads(user);
  const total = useUnreadTotal(user);

  // Refresh user once (e.g. after login state change in same SPA)
  useEffect(() => {
    const id = setInterval(() => {
      const cur = getCurrentUser();
      setUser((prev) => (prev?.id === cur?.id ? prev : cur));
    }, 1500);
    return () => clearInterval(id);
  }, []);

  // For agent: auto-pick the only thread when opening
  useEffect(() => {
    if (!open || activeThread) return;
    if (user?.role === "agent" && threads.length === 1) {
      setActiveThread(threads[0].id);
    }
  }, [open, activeThread, user, threads]);

  if (!user) return null;

  const showList = !activeThread;
  const current = threads.find((tt) => tt.id === activeThread) ?? null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t.chat.title}
        className={`fixed bottom-5 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-elevated transition hover:scale-105 ${
          dir === "rtl" ? "left-5" : "right-5"
        }`}
      >
        <MessageSquare className="h-6 w-6" />
        {total > 0 && (
          <span className="absolute -top-1 -right-1 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-destructive px-1.5 text-[11px] font-bold text-destructive-foreground">
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>

      {open && (
        <div
          dir={dir}
          className={`fixed bottom-24 z-40 flex h-[560px] max-h-[80vh] w-[360px] max-w-[92vw] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-elevated ${
            dir === "rtl" ? "left-5" : "right-5"
          }`}
        >
          <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3">
            <div className="flex items-center gap-2">
              {!showList && user.role !== "agent" && (
                <button
                  className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
                  onClick={() => setActiveThread(null)}
                  aria-label={t.chat.backToList}
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              <h3 className="text-sm font-bold text-foreground">
                {showList ? t.chat.title : (current?.agentName ?? current?.supervisorName ?? "")}
              </h3>
            </div>
            <button
              className="rounded-lg p-1 text-muted-foreground hover:bg-muted"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          {showList ? (
            <ThreadList threads={threads} onPick={setActiveThread} userId={user.id} />
          ) : current ? (
            <ChatPane thread={current} />
          ) : null}
        </div>
      )}
    </>
  );
}

function ThreadList({
  threads, onPick, userId,
}: { threads: ChatThread[]; onPick: (id: string) => void; userId: string }) {
  const { t } = useLang();
  if (threads.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {t.chat.noThreads}
      </div>
    );
  }
  return (
    <ul className="flex-1 overflow-y-auto">
      {threads.map((th) => (
        <ThreadRow key={th.id} thread={th} userId={userId} onPick={onPick} />
      ))}
    </ul>
  );
}

function ThreadRow({
  thread, userId, onPick,
}: { thread: ChatThread; userId: string; onPick: (id: string) => void }) {
  const unread = useThreadUnread(thread.id, userId);
  const time = thread.lastMessageAt ? new Date(thread.lastMessageAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <li>
      <button
        onClick={() => onPick(thread.id)}
        className="flex w-full items-start gap-3 border-b border-border px-4 py-3 text-start transition hover:bg-muted/50"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
          {(thread.agentName ?? "?").slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{thread.agentName}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">{time}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-xs text-muted-foreground">
              {thread.lastMessagePreview || "—"}
            </span>
            {unread > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                {unread}
              </span>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

function ChatPane({ thread }: { thread: ChatThread }) {
  const { t } = useLang();
  const me = getCurrentUser()!;
  const messages = useChatMessages(thread.id);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);

  // Auto-scroll on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  // Mark as read when thread is open
  useEffect(() => {
    markRead(thread.id);
  }, [thread.id, messages.length]);

  // Typing subscription
  useEffect(() => {
    const refresh = () => setTypingUsers(getTypingUsers(thread.id, me.id));
    refresh();
    const off = subscribeChat(refresh);
    const id = setInterval(refresh, 1000);
    return () => { off(); clearInterval(id); };
  }, [thread.id, me.id]);

  const onSend = async () => {
    if (sending) return;
    if (!text.trim() && !file) return;
    setSending(true);
    try {
      await sendMessage({ threadId: thread.id, body: text, file });
      setText("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const onChangeText = (v: string) => {
    setText(v);
    if (v.trim()) setTyping(thread.id);
  };

  const otherTyping = typingUsers.length > 0;
  const grouped = useMemo(() => groupByDay(messages), [messages]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {grouped.map((g) => (
          <div key={g.day}>
            <div className="my-2 text-center text-[10px] uppercase tracking-wide text-muted-foreground">{g.day}</div>
            {g.items.map((m) => <Bubble key={m.id} m={m} mine={m.senderId === me.id} />)}
          </div>
        ))}
        {otherTyping && (
          <div className="text-xs italic text-muted-foreground">{t.chat.typing}</div>
        )}
      </div>

      <div className="border-t border-border p-2">
        {file && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-muted px-2 py-1 text-xs">
            <span className="truncate">📎 {file.name}</span>
            <button onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ""; }} className="text-muted-foreground hover:text-destructive">
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted"
            aria-label={t.chat.attach}
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <textarea
            value={text}
            onChange={(e) => onChangeText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t.chat.placeholder}
            rows={1}
            className="max-h-24 min-h-9 flex-1 resize-none rounded-lg border border-input bg-surface px-3 py-2 text-sm text-foreground"
          />
          <button
            type="button"
            onClick={onSend}
            disabled={sending || (!text.trim() && !file)}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
            aria-label={t.chat.send}
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function Bubble({ m, mine }: { m: ChatMessage; mine: boolean }) {
  const time = new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const isImage = m.attachment?.type?.startsWith("image/");
  return (
    <div className={`mb-2 flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm shadow-soft ${
        mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
      }`}>
        {!mine && <div className="mb-0.5 text-[10px] font-bold opacity-70">{m.senderName}</div>}
        {m.attachment && (
          isImage ? (
            <img src={m.attachment.url} alt={m.attachment.name} className="mb-1 max-h-48 rounded-lg" />
          ) : (
            <a
              href={m.attachment.url}
              download={m.attachment.name}
              className="mb-1 flex items-center gap-1 text-xs underline opacity-90"
            >
              <Paperclip className="h-3 w-3" />
              {m.attachment.name}
            </a>
          )
        )}
        {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
        <div className={`mt-0.5 text-end text-[10px] ${mine ? "opacity-70" : "text-muted-foreground"}`}>{time}</div>
      </div>
    </div>
  );
}

function groupByDay(messages: ChatMessage[]) {
  const map = new Map<string, ChatMessage[]>();
  for (const m of messages) {
    const day = new Date(m.createdAt).toLocaleDateString();
    if (!map.has(day)) map.set(day, []);
    map.get(day)!.push(m);
  }
  return Array.from(map.entries()).map(([day, items]) => ({ day, items }));
}
