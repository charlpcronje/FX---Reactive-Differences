// webui — Server Entry
import "../fx/fx.ts";
import * as esbuild from "npm:esbuild@0.24.0";

// Initialize esbuild for TypeScript transpilation
await esbuild.initialize({});

// Transpile cache — avoids re-transpiling unchanged files
const transpileCache = new Map<string, { mtime: number; js: string }>();

async function transpileTS(filePath: string): Promise<string> {
  const stat = await Deno.stat(filePath);
  const mtime = stat.mtime?.getTime() || 0;
  const cached = transpileCache.get(filePath);
  if (cached && cached.mtime === mtime) return cached.js;

  const code = await Deno.readTextFile(filePath);
  const result = await esbuild.transform(code, {
    loader: "ts",
    format: "esm",
    target: "esnext",
  });
  transpileCache.set(filePath, { mtime, js: result.code });
  return result.code;
}

// Load server plugins via native Deno import
const serverPlugins: [string, string][] = [
  ["../fx/plugins/fx-markdown.ts", "$markdown"],
  ["../fx/plugins/fx-flow.ts", "$flow"],
  ["../fx/plugins/fx-cache.ts", "$cache"],
  ["../fx/plugins/fx-orm.ts", "$orm"],
  ["../fx/plugins/fx-serialize.ts", "$serialize"],
  ["../fx/plugins/fx-filesystem.ts", "$fs"],
  ["../fx/plugins/fx-safe.ts", "$safe"],
  ["../fx/plugins/fx-atomics.ts", "$atomics"],
  ["../fx/plugins/fx-time-travel.ts", "$timeTravel"],
  ["../fx/plugins/fx-devtools.ts", "$devtools"],
  ["../fx/plugins/fx-visualizer.ts", "$viz"],
  ["../fx/plugins/fx-api.ts", "$api"],
  ["../fx/plugins/fx-hono.ts", "$hono"],
  ["../fx/plugins/fx-server.ts", "$server"],
  ["../fx/plugins/fx-relay.ts", "$relay"],
];

const fxCore = (globalThis as any).fx;

for (const [path, global] of serverPlugins) {
  try {
    const mod = await import(path);
    const exp = mod.default || mod;
    let instance;
    if (typeof exp === "function") {
      const isClass = /^class\s/.test(Function.prototype.toString.call(exp));
      if (isClass) {
        try { instance = new exp(fxCore); }
        catch { try { instance = new exp(); if (instance.init) await instance.init(fxCore); } catch { instance = null; } }
      } else {
        try { instance = await exp(fxCore); }
        catch { try { instance = await exp({ fx: $$, $$, fxCore }); } catch { try { instance = exp(); } catch { instance = null; } } }
      }
    } else { instance = exp; }
    if (instance) {
      try { Object.defineProperty(globalThis, global, { value: instance, writable: true, configurable: true }); }
      catch { (globalThis as any)[global] = instance; }
    }
  } catch (e: any) {
    console.warn(`[FX] Plugin ${global}: ${e.message}`);
  }
}

$$("app.name").set("webui");

const PORT = parseInt(Deno.env.get("PORT") || "8787");
Deno.serve({ port: PORT, onListen: ({ hostname, port }) => {
  console.log(`\n  ✦ FX running at http://${hostname}:${port}/\n`);
}}, async (req) => {
  const url = new URL(req.url);
  let path = url.pathname === "/" ? "/index.html" : url.pathname;

  // ── API stubs ──────────────────────────────────────────────
  // TODO: replace with real handlers. These return empty/dummy data
  // so the UI loads cleanly while the backend is being built.
  if (path.startsWith("/api/")) {
    const jsonHeaders = {
      "content-type": "application/json",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-site",
    };
    if (path === "/api/projects") {
      return new Response(JSON.stringify({ projects: [] }), { headers: jsonHeaders });
    }
    if (path.match(/^\/api\/projects\/[^/]+\/compare$/)) {
      return new Response(JSON.stringify({ comparison: null }), { headers: jsonHeaders });
    }
    if (path === "/api/files/content") {
      return new Response(JSON.stringify({ content: "", error: "Not implemented" }), { headers: jsonHeaders });
    }
    return new Response(JSON.stringify({ error: "Endpoint not implemented" }), { status: 404, headers: jsonHeaders });
  }

  try {
    const filePath = "." + path;

    // Auto-transpile TypeScript files for the browser
    if (path.endsWith(".ts")) {
      const js = await transpileTS(filePath);
      return new Response(js, {
        headers: { "content-type": "application/javascript" },
      });
    }

    const file = await Deno.readFile(filePath);
    const ext = path.split(".").pop() || "";
    const types: Record<string, string> = {
      html: "text/html", js: "application/javascript",
      css: "text/css", json: "application/json",
      png: "image/png", jpg: "image/jpeg", svg: "image/svg+xml",
      wasm: "application/wasm",
      fxb: "application/octet-stream",
      rs: "text/plain",
    };
    return new Response(file, {
      headers: {
        "content-type": types[ext] || "application/octet-stream",
        // Enable cross-origin isolation so SharedArrayBuffer (sync ORM) works
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Resource-Policy": "same-site",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
});

// Server URL printed by onListen callback above
