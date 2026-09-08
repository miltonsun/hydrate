-- ============================================================
-- Paste this into Supabase → SQL Editor → New query → Run
-- It creates two tables: profiles and leaderboard
-- ============================================================

-- Profiles: one row per user, stores their settings + full history JSON
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique not null,
  weight real,
  weight_unit text default 'lbs',
  gender text,
  unit text default 'oz',
  bottle_size text,
  goal real,
  history jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- Leaderboard: one row per user, public stats
create table if not exists leaderboard (
  username text primary key,
  longest_streak int default 0,
  current_streak int default 0,
  total_oz real default 0,
  updated_at timestamptz default now()
);

-- Row Level Security: users can only read/write their own profile
alter table profiles enable row level security;

create policy "Users can read own profile"
  on profiles for select
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on profiles for insert
  with check (auth.uid() = id);

create policy "Users can update own profile"
  on profiles for update
  using (auth.uid() = id);

-- Leaderboard is readable by everyone, writable only by the row owner
alter table leaderboard enable row level security;

create policy "Anyone can read leaderboard"
  on leaderboard for select
  using (true);

create policy "Users can insert own leaderboard row"
  on leaderboard for insert
  with check (
    username = (select username from profiles where id = auth.uid())
  );

create policy "Users can update own leaderboard row"
  on leaderboard for update
  using (
    username = (select username from profiles where id = auth.uid())
  );
