import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Client } from "pg";
import type { TestProject } from "vitest/node";

/**
 * Starts (once per test run) a throwaway PostgreSQL cluster, installs a
 * Supabase-like role setup, applies every migration to a template database,
 * and shares the admin URL with the tests. Each test file then clones the
 * template into its own fresh database.
 *
 * No Supabase account or credentials are needed. To use your own PostgreSQL
 * instead, set TEST_DATABASE_URL to a SUPERUSER connection string.
 */

declare module "vitest" {
  export interface ProvidedContext {
    pgAdminUrl: string;
    pgTemplateDb: string;
  }
}

const TEMPLATE_DB = "he_template";
const MIGRATIONS_DIR = path.resolve(__dirname, "../../supabase/migrations");

function findPgBinDir(): string {
  const candidates: string[] = [];
  try {
    candidates.push(execFileSync("pg_config", ["--bindir"], { encoding: "utf8" }).trim());
  } catch {
    /* pg_config not on PATH */
  }
  const root = "/usr/lib/postgresql";
  if (fs.existsSync(root)) {
    for (const v of fs.readdirSync(root).sort((a, b) => Number(b) - Number(a))) {
      candidates.push(path.join(root, v, "bin"));
    }
  }
  for (const dir of candidates) {
    if (dir && fs.existsSync(path.join(dir, "initdb"))) return dir;
  }
  throw new Error(
    "PostgreSQL server binaries (initdb) not found. Install PostgreSQL 14+ or set TEST_DATABASE_URL to a superuser connection string.",
  );
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

/** Mirrors what Supabase provisions, so grants/RLS behave as in production. */
const SUPABASE_BOOTSTRAP = `
  create role anon          nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role  nologin noinherit bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

async function bootstrap(adminUrl: string): Promise<void> {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    const roles = await admin.query("select 1 from pg_roles where rolname = 'service_role'");
    if (roles.rowCount === 0) await admin.query(SUPABASE_BOOTSTRAP);

    await admin.query(`drop database if exists ${TEMPLATE_DB}`);
    await admin.query(`create database ${TEMPLATE_DB}`);
  } finally {
    await admin.end();
  }

  const url = new URL(adminUrl);
  url.pathname = `/${TEMPLATE_DB}`;
  const tpl = new Client({ connectionString: url.toString() });
  await tpl.connect();
  try {
    // Same defaults Supabase applies to objects created by the postgres role.
    await tpl.query(
      `alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
       alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
       alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`,
    );
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
      try {
        await tpl.query(sql);
      } catch (err) {
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await tpl.end();
  }
}

export default async function setup(project: TestProject) {
  let stop = () => {};
  let adminUrl = process.env.TEST_DATABASE_URL;

  if (!adminUrl) {
    const bin = findPgBinDir();
    const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "he-pg-"));
    const data = path.join(base, "data");
    const port = await freePort();

    // PostgreSQL refuses to run as root; fall back to the 'postgres' OS user.
    const asUser = (cmd: string, args: string[]) =>
      isRoot ? { cmd: "runuser", args: ["-u", "postgres", "--", cmd, ...args] } : { cmd, args };
    if (isRoot) {
      fs.chmodSync(base, 0o755);
      execFileSync("chown", ["postgres:postgres", base]);
    }

    const run = (cmd: string, args: string[]) => {
      const r = asUser(cmd, args);
      execFileSync(r.cmd, r.args, { stdio: "pipe" });
    };

    run(path.join(bin, "initdb"), ["-D", data, "-U", "postgres", "-A", "trust", "-E", "UTF8", "--locale=C"]);
    run(path.join(bin, "pg_ctl"), [
      "-D", data, "-w", "-l", path.join(base, "pg.log"),
      "-o",
      `-p ${port} -k ${base} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=300`,
      "start",
    ]);

    adminUrl = `postgresql://postgres@127.0.0.1:${port}/postgres`;

    stop = () => {
      try {
        const r = asUser(path.join(bin, "pg_ctl"), ["-D", data, "-m", "immediate", "stop"]);
        spawnSync(r.cmd, r.args, { stdio: "ignore" });
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    };
    process.once("exit", stop);
  }

  try {
    await bootstrap(adminUrl);
  } catch (err) {
    stop();
    throw err;
  }

  project.provide("pgAdminUrl", adminUrl);
  project.provide("pgTemplateDb", TEMPLATE_DB);

  return () => stop();
}
