-- Tabelas do J.A.R.V.I.S. no Supabase.
-- Rode no SQL Editor do projeto (ou via Composio: SUPABASE_BETA_RUN_SQL_QUERY).
-- O app acessa com a service_role no servidor; RLS fica ligado e sem policies públicas.

create table if not exists jarvis_conversations (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Nova conversa',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists jarvis_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references jarvis_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system', 'tool')),
  content text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists jarvis_messages_conversation_idx
  on jarvis_messages (conversation_id, created_at);

create table if not exists jarvis_reminders (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  due_at timestamptz,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists jarvis_memories (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists jarvis_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table jarvis_conversations enable row level security;
alter table jarvis_messages enable row level security;
alter table jarvis_reminders enable row level security;
alter table jarvis_memories enable row level security;
alter table jarvis_settings enable row level security;

-- Sem policies: apenas a service_role (usada só no servidor) enxerga os dados.
