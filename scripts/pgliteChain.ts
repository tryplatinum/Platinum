// Postgres in WebAssembly (PGlite) with the whole migration chain applied, for
// offline checks of what the database itself enforces: policies, grants and
// functions. No network and no real project.
//
// PGlite is not one of this project's dependencies. The checks that use this
// file look for it in node_modules, or in the folder named by PGLITE_DIR, and
// say plainly that they were skipped when it is not there:
//
//   npm install --no-save --no-package-lock @electric-sql/pglite
//
// Supabase's own schemas are replaced by small stand-ins: the three roles,
// auth.users, auth.uid() read from a setting, and the two storage tables the
// migrations name. Row level security and grants behave as in Postgres.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export interface Db {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; affectedRows?: number }>
  exec: (sql: string) => Promise<unknown>
  transaction: <T>(work: (tx: Db) => Promise<T>) => Promise<T>
  close: () => Promise<void>
}

const STUBS = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  email_confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant select on table auth.users to service_role;
create schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create schema storage;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text, owner uuid, created_at timestamptz default now()
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on table storage.objects to authenticated;
grant all on all tables in schema storage to service_role;
grant usage on schema public to anon, authenticated, service_role;
`

export const MIGRATIONS = resolve(import.meta.dirname, '../supabase/migrations')

/** Every migration file, oldest first. */
export const migrationFiles = () => readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()

type Lib = { PGlite: new (options?: { extensions?: Record<string, unknown> }) => Db; trgm: unknown }

async function loadPglite(): Promise<Lib | undefined> {
  const places = [process.env.PGLITE_DIR, resolve(import.meta.dirname, '../node_modules/@electric-sql/pglite')].filter((p): p is string => Boolean(p))
  for (const place of places) {
    const entry = join(place, 'dist/index.js')
    if (!existsSync(entry)) continue
    const main = (await import(pathToFileURL(entry).href)) as Pick<Lib, 'PGlite'>
    // The college directory's search indexes use pg_trgm, which PGlite ships beside itself.
    const contrib = (await import(pathToFileURL(join(place, 'dist/contrib/pg_trgm.js')).href)) as { pg_trgm: unknown }
    return { PGlite: main.PGlite, trgm: contrib.pg_trgm }
  }
  return undefined
}

/**
 * A fresh database with every migration applied, or undefined when PGlite is
 * not installed. `upTo` stops before the first file whose name sorts after it.
 */
export async function chain(upTo?: string): Promise<{ db: Db; applied: string[] } | undefined> {
  const lib = await loadPglite()
  if (!lib) return undefined
  const db = new lib.PGlite({ extensions: { pg_trgm: lib.trgm } })
  await db.exec(STUBS)
  const applied: string[] = []
  for (const file of migrationFiles()) {
    if (upTo && file > upTo) break
    try {
      await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'))
    } catch (error) {
      throw new Error(`${file} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
    applied.push(file)
  }
  return { db, applied }
}

/** Runs `work` as one signed-in person: the role and auth.uid() a request from the browser would have. */
export async function asUser<T>(db: Db, userId: string, work: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId])
    await tx.exec('set local role authenticated')
    return work(tx)
  })
}

/** Runs `work` as the server's service role: no row level security, no auth.uid(). */
export async function asService<T>(db: Db, work: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', '', true)`)
    await tx.exec('set local role service_role')
    return work(tx)
  })
}

/** The error a statement raises, or undefined when it ran. A failed statement ends its own transaction. */
export async function refusal(run: () => Promise<unknown>): Promise<{ code?: string; message: string } | undefined> {
  try {
    await run()
    return undefined
  } catch (error) {
    const e = error as { code?: string; message?: string }
    return { code: e.code, message: e.message ?? String(error) }
  }
}
