import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import initSqlJs, { type Database } from "sql.js";
import type { TaskSummary } from "@homebot/shared";
import { getStateRoot } from "./state-root.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let sqlPromise: ReturnType<typeof initSqlJs> | null = null;

function wasmPath(): string {
  try {
    return join(dirname(require.resolve("sql.js/dist/sql-wasm.wasm")), "sql-wasm.wasm");
  } catch {
    return join(__dirname, "..", "..", "node_modules", "sql.js", "dist", "sql-wasm.wasm");
  }
}

async function getSql() {
  if (!sqlPromise) {
    const wasm = wasmPath();
    sqlPromise = initSqlJs({
      locateFile: () => wasm,
    });
  }
  return sqlPromise;
}

function getTasksDbPath(): string {
  return join(getStateRoot(), "tasks", "runs.sqlite");
}

export async function readTasks(): Promise<{ running: number; queued: number; recent: TaskSummary[] }> {
  const empty = { running: 0, queued: 0, recent: [] as TaskSummary[] };
  const dbPath = getTasksDbPath();
  if (!existsSync(dbPath)) return empty;

  try {
    const SQL = await getSql();
    const buffer = readFileSync(dbPath);
    const db: Database = new SQL.Database(buffer);

    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
    if (!tables.length || !tables[0]?.values.length) {
      db.close();
      return empty;
    }

    const tableNames = tables[0].values.map((row) => String(row[0]));
    const tableName = tableNames.find((n) => n === "tasks" || n === "runs");
    if (!tableName) {
      db.close();
      return empty;
    }

    const colResult = db.exec(`PRAGMA table_info(${tableName})`);
    const colNames = new Set((colResult[0]?.values ?? []).map((row) => String(row[1])));

    const idCol = colNames.has("id") ? "id" : colNames.has("task_id") ? "task_id" : "rowid";
    const statusCol = colNames.has("status") ? "status" : null;
    if (!statusCol) {
      db.close();
      return empty;
    }

    const titleCol = colNames.has("title") ? "title" : null;
    const kindCol = colNames.has("kind") ? "kind" : null;
    const runtimeCol = colNames.has("runtime") ? "runtime" : null;
    const startedCol = colNames.has("started_at") ? "started_at" : colNames.has("startedAt") ? "startedAt" : null;
    const updatedCol = colNames.has("updated_at") ? "updated_at" : colNames.has("updatedAt") ? "updatedAt" : null;

    const runningRow = db.exec(`SELECT COUNT(*) FROM ${tableName} WHERE ${statusCol} = 'running'`);
    const queuedRow = db.exec(`SELECT COUNT(*) FROM ${tableName} WHERE ${statusCol} = 'queued'`);
    const running = Number(runningRow[0]?.values[0]?.[0] ?? 0);
    const queued = Number(queuedRow[0]?.values[0]?.[0] ?? 0);

    const selectCols = [idCol, statusCol, titleCol, kindCol, runtimeCol, startedCol, updatedCol]
      .filter(Boolean)
      .join(", ");

    const rowsResult = db.exec(
      `SELECT ${selectCols} FROM ${tableName} ORDER BY ${updatedCol ?? startedCol ?? idCol} DESC LIMIT 20`,
    );
    db.close();

    const rows = rowsResult[0]?.values ?? [];
    const columns = rowsResult[0]?.columns ?? [];
    const colIndex = (name: string) => columns.indexOf(name);

    const recent: TaskSummary[] = rows.map((row) => ({
      id: String(row[colIndex(idCol)] ?? ""),
      status: String(row[colIndex(statusCol)] ?? "unknown"),
      title: titleCol ? String(row[colIndex(titleCol)] ?? "") : undefined,
      kind: kindCol ? String(row[colIndex(kindCol)] ?? "") : undefined,
      runtime: runtimeCol ? String(row[colIndex(runtimeCol)] ?? "") : undefined,
      startedAt: startedCol ? String(row[colIndex(startedCol)] ?? "") : undefined,
      updatedAt: updatedCol ? String(row[colIndex(updatedCol)] ?? "") : undefined,
    }));

    return { running, queued, recent };
  } catch {
    return empty;
  }
}
