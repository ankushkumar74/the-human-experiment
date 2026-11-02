#!/usr/bin/env node
/**
 * Local development database. No Supabase account needed.
 *
 *   npm run db:local          start (creates and migrates on first run)
 *   npm run db:local -- stop
 *   npm run db:local -- reset   wipe everything and start fresh
 *   npm run db:local -- status
 *
 * Needs PostgreSQL 14+ server binaries (initdb, pg_ctl). It prints the
 * LOCAL_DATABASE_URL to put in .env.local. Data lives OUTSIDE the project (default
 * ~/.cache/the-human-experiment/local-db, or LOCAL_DB_DIR) because PostgreSQL rewrites
 * its files on every write, and `next dev` would otherwise reload the page each time.
 *
 * It mirrors the roles Supabase provisions (anon, authenticated, service_role)
 * so grants and Row Level Security behave as they will in production.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
// PostgreSQL refuses to run as root; as root it runs as the 'postgres' user, which cannot read /root.
const base =
  process.env.LOCAL_DB_DIR ??
  (isRoot ? "/var/tmp/the-human-experiment-db" : path.join(os.homedir(), ".cache", "the-human-experiment", "local-db"));
const data = path.join(base, "data");
const migrationsDir = path.join(root, "supabase", "migrations");
const port = Number(process.env.LOCAL_DB_PORT ?? 54329);
const dbName = "human_experiment";
const adminUrl = (db = "postgres") => `postgresql://postgres@127.0.0.1:${port}/${db}`;

// Keep in sync with tests/helpers/global-setup.ts (the test harness uses the same roles).
const SUPABASE_BOOTSTRAP = `
  create role anon          nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role  nologin noinherit bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
`;
const DEFAULT_PRIVILEGES = `
  alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

function findBinDir() {
  const candidates = [];
  try {
    candidates.push(execFileSync("pg_config", ["--bindir"], { encoding: "utf8" }).trim());
  } catch {
    /* not on PATH */
  }
  const rootDir = "/usr/lib/postgresql";
  if (fs.existsSync(rootDir)) {
    for (const v of fs.readdirSync(rootDir).sort((a, b) => Number(b) - Number(a))) {
      candidates.push(path.join(rootDir, v, "bin"));
    }
  }
  const found = candidates.find((d) => d && fs.existsSync(path.join(d, "initdb")));
  if (!found) {
    console.error("PostgreSQL server binaries not found. Install PostgreSQL 14+ (initdb/pg_ctl), or use Supabase.");
    process.exit(1);
  }
  return found;
}

const bin = findBinDir();

/** PostgreSQL refuses to run as root, so fall back to the 'postgres' OS user. */
function pgRun(cmd, args, opts = {}) {
  const [c, a] = isRoot ? ["runuser", ["-u", "postgres", "--", path.join(bin, cmd), ...args]] : [path.join(bin, cmd), args];
  return spawnSync(c, a, { encoding: "utf8", ...opts });
}

const isUp = () => pgRun("pg_isready", ["-h", "127.0.0.1", "-p", String(port)]).status === 0;

function start() {
  if (isUp()) return;
  fs.mkdirSync(base, { recursive: true });
  if (isRoot) {
    execFileSync("chmod", ["755", base]);
    execFileSync("chown", ["-R", "postgres:postgres", base]);
  }
  if (!fs.existsSync(path.join(data, "PG_VERSION"))) {
    const init = pgRun("initdb", ["-D", data, "-U", "postgres", "-A", "trust", "-E", "UTF8", "--locale=C"]);
    if (init.status !== 0) throw new Error(`initdb failed: ${init.stderr}`);
  }
  const res = pgRun("pg_ctl", [
    "-D", data, "-w", "-l", path.join(base, "postgres.log"),
    "-o", `-p ${port} -k ${base} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off`,
    "start",
  ]);
  if (res.status !== 0) throw new Error(`pg_ctl start failed: ${res.stderr || res.stdout}`);
}

function stop() {
  if (!fs.existsSync(path.join(data, "PG_VERSION"))) return;
  pgRun("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]);
}

async function migrate() {
  const admin = new pg.Client({ connectionString: adminUrl() });
  await admin.connect();
  try {
    const roles = await admin.query("select 1 from pg_roles where rolname = 'service_role'");
    if (roles.rowCount === 0) await admin.query(SUPABASE_BOOTSTRAP);
    const exists = await admin.query("select 1 from pg_database where datname = $1", [dbName]);
    if (exists.rowCount === 0) await admin.query(`create database ${dbName}`);
  } finally {
    await admin.end();
  }

  const client = new pg.Client({ connectionString: adminUrl(dbName) });
  await client.connect();
  try {
    await client.query(DEFAULT_PRIVILEGES);
    await client.query("create table if not exists public._local_migrations (name text primary key)");
    const done = new Set((await client.query("select name from public._local_migrations")).rows.map((r) => r.name));
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      process.stdout.write(`applying ${file} ... `);
      try {
        await client.query(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
        await client.query("insert into public._local_migrations (name) values ($1)", [file]);
        console.log("ok");
      } catch (err) {
        console.log("FAILED");
        throw new Error(`${file}: ${err.message}`);
      }
    }
  } finally {
    await client.end();
  }
}

const command = process.argv[2] ?? "start";

try {
  if (command === "stop") {
    stop();
    console.log("local database stopped");
  } else if (command === "status") {
    console.log(isUp() ? `running on port ${port}` : "not running");
    process.exit(isUp() ? 0 : 1);
  } else if (command === "reset") {
    stop();
    fs.rmSync(data, { recursive: true, force: true });
    start();
    await migrate();
    console.log(`\nLOCAL_DATABASE_URL=${adminUrl(dbName)}`);
  } else if (command === "start") {
    start();
    await migrate();
    console.log(`\nLOCAL_DATABASE_URL=${adminUrl(dbName)}`);
  } else {
    console.error(`unknown command "${command}". Use: start | stop | reset | status`);
    process.exit(2);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
