import * as esbuild from "npm:esbuild@0.24.0";
import { encodeBase64 } from "jsr:@std/encoding@0.224.0/base64";

const assets = [
  { path: "webui/index.html", route: "/index.html", type: "text/html", transpile: false },
  { path: "webui/fx/bundle.fxb", route: "/fx/bundle.fxb", type: "application/octet-stream", transpile: false },
  { path: "webui/fx/fx.ts", route: "/fx/fx.ts", type: "application/javascript", transpile: true },
  { path: "webui/src/client.ts", route: "/src/client.ts", type: "application/javascript", transpile: true },
  { path: "webui/src/app.ts", route: "/src/app.ts", type: "application/javascript", transpile: true },
];

await esbuild.initialize({});

let outputCode = `// Auto-generated static assets
import { decodeBase64 } from "jsr:@std/encoding@0.224.0/base64";
export const staticAssets = new Map<string, { type: string, data: Uint8Array }>();\n\n`;

for (const asset of assets) {
  let dataBytes: Uint8Array;
  
  if (asset.transpile) {
    const tsCode = await Deno.readTextFile(asset.path);
    const result = await esbuild.transform(tsCode, {
      loader: "ts",
      format: "esm",
      target: "esnext",
    });
    dataBytes = new TextEncoder().encode(result.code);
  } else {
    dataBytes = await Deno.readFile(asset.path);
  }
  
  const b64 = encodeBase64(dataBytes);
  outputCode += `staticAssets.set("${asset.route}", {
  type: "${asset.type}",
  data: decodeBase64("${b64}")
});\n`;
}

await Deno.writeTextFile("src/web/static_assets.ts", outputCode);
console.log("Static assets bundled to src/web/static_assets.ts");

esbuild.stop();
