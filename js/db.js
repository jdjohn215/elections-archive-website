import * as duckdb from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm";

let conn = null;

export async function initDB() {
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  const worker = await duckdb.createWorker(bundle.mainWorker);
  const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker);
  try {
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  } catch (err) {
    throw new Error(`wasm instantiate failed: ${err?.message || err}`, { cause: err });
  }
  conn = await db.connect();
  try {
    await conn.query("INSTALL spatial; LOAD spatial;");
  } catch (err) {
    throw new Error(`spatial extension load failed: ${err?.message || err}`, { cause: err });
  }
  return conn;
}

export function dataUrl(path) {
  // DuckDB-wasm only fetches over HTTP when the URL has a scheme, so resolve
  // relative paths against the page origin before encoding each segment.
  const abs = new URL(path, window.location.href);
  abs.pathname = abs.pathname.split("/").map(encodeURIComponent).join("/");
  return abs.href;
}

export async function query(sql) {
  try {
    const result = await conn.query(sql);
    return result.toArray().map((r) => r.toJSON());
  } catch (err) {
    console.error("DuckDB query failed:", sql, err);
    throw err;
  }
}

export function sqlString(s) {
  return `'${String(s).replaceAll("'", "''")}'`;
}
