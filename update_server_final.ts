const serverPath = "./src/web/server.ts";
let serverCode = await Deno.readTextFile(serverPath);

const startIdx = serverCode.indexOf("// Serve static files from webui folder");
const endStr = "return c.html(html);\n});";
const endIdx = serverCode.indexOf(endStr) + endStr.length;

const newCode = `// Serve static assets from bundled map
app.get("/*", async (c) => {
  const url = new URL(c.req.url);
  const path = url.pathname === "/" ? "/index.html" : url.pathname;
  
  if (staticAssets.has(path)) {
    const asset = staticAssets.get(path)!;
    return c.body(asset.data, 200, {
      "Content-Type": asset.type,
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-site",
    });
  }
  
  // Fallback to index.html for SPA routing if not found and not an API call
  if (!path.startsWith("/api/")) {
    const asset = staticAssets.get("/index.html")!;
    return c.body(asset.data, 200, {
      "Content-Type": asset.type,
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-site",
    });
  }

  return c.text("Not found", 404);
});`;

serverCode = serverCode.substring(0, startIdx) + newCode + serverCode.substring(endIdx);
await Deno.writeTextFile(serverPath, serverCode);
console.log("Updated server to use staticAssets.");
