#!/usr/bin/env node
/**
 * Builds supabase/setup.sql: every migration, in order, in ONE file that can be
 * pasted into the Supabase SQL editor.
 *
 *   npm run db:bundle           write supabase/setup.sql
 *   npm run db:bundle -- --check   exit 1 if setup.sql is out of date (used by the tests)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "supabase", "migrations");
const out = path.join(root, "supabase", "setup.sql");

export function buildBundle() {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const header = [
    "-- ============================================================================",
    "-- The Human Experiment: complete database setup (GENERATED FILE, do not edit).",
    "-- Source of truth: supabase/migrations/*.sql. Regenerate with `npm run db:bundle`.",
    "--",
    "-- Paste this whole file into Supabase > SQL Editor > New query > Run.",
    "-- Run it ONCE on an empty project. It is not safe to run twice.",
    `-- Contains ${files.length} migrations: ${files.join(", ")}`,
    "-- ============================================================================",
    "",
  ].join("\n");
  const body = files
    .map((f) => `-- ---------- ${f} ----------\n${fs.readFileSync(path.join(dir, f), "utf8").trimEnd()}\n`)
    .join("\n");
  return `${header}\n${body}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const bundle = buildBundle();
  if (process.argv.includes("--check")) {
    const current = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
    if (current !== bundle) {
      console.error("supabase/setup.sql is out of date. Run: npm run db:bundle");
      process.exit(1);
    }
    console.log("supabase/setup.sql is up to date");
  } else {
    fs.writeFileSync(out, bundle);
    console.log(`wrote ${path.relative(root, out)} (${bundle.length} bytes)`);
  }
}
