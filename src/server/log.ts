// Structured JSON server logs: one JSON object per line on stdout/stderr, which
// Vercel and most log collectors parse natively. Server-only.
type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel(): Level {
  const v = process.env.LOG_LEVEL as Level | undefined;
  if (v && v in order) return v;
  return process.env.NODE_ENV === "test" ? "warn" : "info";
}

export type LogFields = Record<string, unknown>;

function serialize(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v instanceof Error) out[k] = { name: v.name, message: v.message, code: (v as { code?: unknown }).code };
    else if (v instanceof Date) out[k] = v.toISOString();
    else out[k] = v;
  }
  return out;
}

function write(level: Level, msg: string, fields: LogFields = {}) {
  if (order[level] < order[minLevel()]) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...serialize(fields) });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

function make(base: LogFields): Logger {
  return {
    debug: (m, f) => write("debug", m, { ...base, ...f }),
    info: (m, f) => write("info", m, { ...base, ...f }),
    warn: (m, f) => write("warn", m, { ...base, ...f }),
    error: (m, f) => write("error", m, { ...base, ...f }),
    child: (f) => make({ ...base, ...f }),
  };
}

export const log: Logger = make({ service: "driveeasy" });
