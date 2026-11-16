
create table if not exists public.players (
    telegram_id bigint primary key,
    username text,
    first_name text,

    coins bigint not null default 0
        check (coins >= 0),

    level integer not null default 1
        check (level >= 1),

    wave integer not null default 1
        check (wave >= 1),

    total_damage bigint not null default 0
        check (total_damage >= 0),

    game_state jsonb not null default '{}'::jsonb,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);

create table if not exists public.referrals (
    id bigint generated always as identity primary key,

    inviter_telegram_id bigint not null
        references public.players(telegram_id),

    invited_telegram_id bigint not null unique
        references public.players(telegram_id),

    reward_coins bigint not null default 0
        check (reward_coins >= 0),

    rewarded_at timestamptz,
    created_at timestamptz not null default now(),

    check (inviter_telegram_id <> invited_telegram_id)
);

create index if not exists players_leaderboard_coins_idx
on public.players (coins desc);

create index if not exists players_leaderboard_level_idx
on public.players (level desc, wave desc);

create index if not exists referrals_inviter_idx
on public.referrals (inviter_telegram_id);

alter table public.players enable row level security;
alter table public.referrals enable row level security;
