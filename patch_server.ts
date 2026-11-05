const serverPath = "./src/web/server.ts";
let serverCode = await Deno.readTextFile(serverPath);

if (!serverCode.includes("esbuild")) {
  const importPattern = 'import { FolderComparator } from "../core/comparator.ts";\n';
  const newImports = importPattern + `import * as esbuild from "npm:esbuild@0.24.0";

let esbuildInitialized = false;
const transpileCache = new Map<string, { mtime: number; js: string }>();

async function transpileTS(filePath: string): Promise<string> {
  if (!esbuildInitialized) {
    await esbuild.initialize({});
    esbuildInitialized = true;
  }
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
`;
  
  serverCode = serverCode.replace(importPattern, newImports);
  
  const staticRoute = `// Serve static files from webui folder
app.get("/fx/*", serveStaticFile);
app.get("/src/*", serveStaticFile);

async function serveStaticFile(c: any) {
  const url = new URL(c.req.url);
  const path = url.pathname;
  try {
    const filePath = "./webui" + path;
    
    if (path.endsWith(".ts")) {
      const js = await transpileTS(filePath);
      return c.body(js, 200, {
        "Content-Type": "application/javascript",
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Resource-Policy": "same-site",
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
    return c.body(file, 200, {
      "Content-Type": types[ext] || "application/octet-stream",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-site",
    });
  } catch (e) {
    return c.text("Not found", 404);
  }
}

// Fallback to index.html for SPA routing`;
  
  serverCode = serverCode.replace("// Fallback to index.html for SPA routing", staticRoute);
  await Deno.writeTextFile(serverPath, serverCode);
  console.log("Static file serving and transpiler added.");
} else {
  console.log("Already has esbuild.");
}
