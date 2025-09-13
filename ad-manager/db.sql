create extension if not exists "uuid-ossp";

create table if not exists users (
  id uuid primary key default uuid_generate_v4(),
  email text unique not null,
  company_name text not null,
  password_hash text not null,
  role text check (role in ('business','admin')) default 'business',
  verified boolean default true,
  created_at timestamptz default now()
);

create table if not exists email_verifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references users(id) on delete cascade,
  token text not null,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

create table if not exists campaigns (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references users(id) on delete cascade,
  title text,
  file_key text not null,
  mime text,
  status text check (status in ('pending','approved','denied')) default 'pending',
  created_at timestamptz default now(),
  scheduled_from timestamptz,
  scheduled_to timestamptz
);
