import { useEffect, useState } from "react";
import {
  listMessages,
  listThreadsForUser,
  subscribeChat,
  totalUnreadForUser,
  unreadCountForThread,
  type ChatMessage,
  type ChatThread,
} from "@/services/chat";
import type { AuthUser } from "@/services/api";

export function useChatThreads(user: AuthUser | null) {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  useEffect(() => {
    if (!user) { setThreads([]); return; }
    const refresh = () => setThreads(listThreadsForUser(user));
    refresh();
    const off = subscribeChat(refresh);
    return off;
  }, [user]);
  return threads;
}

export function useChatMessages(threadId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  useEffect(() => {
    if (!threadId) { setMessages([]); return; }
    const refresh = () => setMessages(listMessages(threadId));
    refresh();
    const off = subscribeChat(refresh);
    return off;
  }, [threadId]);
  return messages;
}

export function useUnreadTotal(user: AuthUser | null) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!user) { setN(0); return; }
    const refresh = () => setN(totalUnreadForUser(user));
    refresh();
    const off = subscribeChat(refresh);
    return off;
  }, [user]);
  return n;
}

export function useThreadUnread(threadId: string | null, userId: string | null) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!threadId || !userId) { setN(0); return; }
    const refresh = () => setN(unreadCountForThread(threadId, userId));
    refresh();
    const off = subscribeChat(refresh);
    return off;
  }, [threadId, userId]);
  return n;
}
