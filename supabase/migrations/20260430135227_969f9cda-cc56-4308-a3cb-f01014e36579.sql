-- Add supervisor link on agents
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS supervisor_user_id uuid;
CREATE INDEX IF NOT EXISTS idx_agents_supervisor ON public.agents(supervisor_user_id);

-- Chat threads (one per agent)
CREATE TABLE IF NOT EXISTS public.chat_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id text NOT NULL UNIQUE,
  agent_user_id uuid NOT NULL,
  supervisor_user_id uuid NOT NULL,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_threads_agent_user ON public.chat_threads(agent_user_id);
CREATE INDEX IF NOT EXISTS idx_chat_threads_supervisor_user ON public.chat_threads(supervisor_user_id);

-- Chat messages
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL,
  sender_role public.app_role NOT NULL,
  sender_name text,
  body text,
  attachment_url text,
  attachment_name text,
  attachment_mime text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_created ON public.chat_messages(thread_id, created_at);

-- Chat reads (per user per thread)
CREATE TABLE IF NOT EXISTS public.chat_reads (
  thread_id uuid NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id)
);

-- Updated_at trigger for threads
DROP TRIGGER IF EXISTS chat_threads_touch ON public.chat_threads;
CREATE TRIGGER chat_threads_touch BEFORE UPDATE ON public.chat_threads
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Enable RLS
ALTER TABLE public.chat_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_reads ENABLE ROW LEVEL SECURITY;

-- Helper to check if user is participant of a thread
CREATE OR REPLACE FUNCTION public.is_thread_participant(_thread_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.chat_threads t
    WHERE t.id = _thread_id AND (t.agent_user_id = _user_id OR t.supervisor_user_id = _user_id)
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_thread_participant(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.is_thread_participant(uuid, uuid) TO authenticated;

-- RLS: chat_threads
CREATE POLICY "Participants view threads" ON public.chat_threads FOR SELECT TO authenticated
  USING (auth.uid() = agent_user_id OR auth.uid() = supervisor_user_id OR has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage threads" ON public.chat_threads FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Supervisors create threads" ON public.chat_threads FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = supervisor_user_id OR auth.uid() = agent_user_id);
CREATE POLICY "Participants update last_message" ON public.chat_threads FOR UPDATE TO authenticated
  USING (auth.uid() = agent_user_id OR auth.uid() = supervisor_user_id)
  WITH CHECK (auth.uid() = agent_user_id OR auth.uid() = supervisor_user_id);

-- RLS: chat_messages
CREATE POLICY "Participants view messages" ON public.chat_messages FOR SELECT TO authenticated
  USING (public.is_thread_participant(thread_id, auth.uid()) OR has_role(auth.uid(), 'admin'));
CREATE POLICY "Participants send messages" ON public.chat_messages FOR INSERT TO authenticated
  WITH CHECK (sender_user_id = auth.uid() AND public.is_thread_participant(thread_id, auth.uid()));
CREATE POLICY "Admins manage messages" ON public.chat_messages FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));

-- RLS: chat_reads
CREATE POLICY "User manages own reads" ON public.chat_reads FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admins view reads" ON public.chat_reads FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'));

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_threads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_reads;
ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;
ALTER TABLE public.chat_threads REPLICA IDENTITY FULL;
ALTER TABLE public.chat_reads REPLICA IDENTITY FULL;

-- Storage bucket for chat attachments
INSERT INTO storage.buckets (id, name, public) VALUES ('chat-attachments', 'chat-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: path format = {threadId}/{filename}
CREATE POLICY "Chat attachments read for participants" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-attachments' AND (
      has_role(auth.uid(), 'admin') OR
      public.is_thread_participant(((storage.foldername(name))[1])::uuid, auth.uid())
    )
  );
CREATE POLICY "Chat attachments upload for participants" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-attachments' AND
    public.is_thread_participant(((storage.foldername(name))[1])::uuid, auth.uid())
  );