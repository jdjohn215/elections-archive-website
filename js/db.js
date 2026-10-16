import * as duckdb from "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm";

let conn = null;
let db = null;

export async function initDB() {
  const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  const worker = await duckdb.createWorker(bundle.mainWorker);
  const theDb = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING), worker);
  try {
    await theDb.instantiate(bundle.mainModule, bundle.pthreadWorker);
  } catch (err) {
    throw new Error(`wasm instantiate failed: ${err?.message || err}`, { cause: err });
  }
  db = theDb;
  conn = await theDb.connect();
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

// GitHub Pages gzip-compresses responses on the fly and applies HTTP range
// requests to the *compressed* bytes, which corrupts duckdb-wasm's ranged
// parquet reads. So we fetch whole files (a full-file gzip response is
// transparently decoded by the browser) and register them as in-memory
// buffers instead of letting DuckDB read them over HTTP.
const parquetCache = new Map(); // path -> registered file name
const PARQUET_CACHE_MAX = 12;
let parquetCounter = 0;

export async function parquetRef(path) {
  const hit = parquetCache.get(path);
  if (hit) return hit;
  const url = dataUrl(path);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const name = `buf${parquetCounter++}.parquet`;
  await db.registerFileBuffer(name, new Uint8Array(await res.arrayBuffer()));
  // Evict the oldest entry to bound wasm memory (geo files are up to ~40 MB)
  if (parquetCache.size >= PARQUET_CACHE_MAX) {
    const [oldPath, oldName] = parquetCache.entries().next().value;
    parquetCache.delete(oldPath);
    db.unregisterFileBuffer(oldName);
  }
  parquetCache.set(path, name);
  return name;
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
