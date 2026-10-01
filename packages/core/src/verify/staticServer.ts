// Minimal static file server for G4 runtime probes — Spec Section 13.2.
// Serves `rootDir` on an ephemeral port with SPA fallback to index.html for
// any path that doesn't match a real file on disk.

import { createServer, type Server } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

export interface StaticServerHandle {
  url: string;
  close: () => Promise<void>;
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    const st = await stat(absPath);
    return st.isFile();
  } catch {
    return false;
  }
}

/** Serves `rootDir` (an absolute path to a built app's output directory) on
 * an ephemeral port (`listen(0)`). Any request path that doesn't resolve to
 * a real file under `rootDir` falls back to `index.html` (SPA routing). */
export async function startStaticServer(rootDir: string): Promise<StaticServerHandle> {
  const server: Server = createServer((req, res) => {
    void (async () => {
      try {
        const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "/");
        const safeRel = path.posix.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
        let absPath = path.join(rootDir, safeRel);

        let serveTarget = absPath;
        if (!(await fileExists(serveTarget))) {
          serveTarget = path.join(rootDir, "index.html");
        }
        if (!(await fileExists(serveTarget))) {
          res.statusCode = 404;
          res.end("Not found");
          return;
        }

        const ext = path.extname(serveTarget);
        const contentType = MIME[ext] ?? "application/octet-stream";
        const body = await readFile(serveTarget);
        res.statusCode = 200;
        res.setHeader("Content-Type", contentType);
        res.end(body);
      } catch (cause) {
        res.statusCode = 500;
        res.end(`Internal server error: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
