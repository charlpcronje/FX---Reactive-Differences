const serverPath = "./src/web/server.ts";
const htmlPath = "./webui/index.html";
let serverCode = await Deno.readTextFile(serverPath);
const htmlCode = await Deno.readTextFile(htmlPath);

// Normalize line endings to \n
serverCode = serverCode.replace(/\r\n/g, '\n');

const startPattern = 'app.get("/*", async (c) => {\n  const html = `';
const endPattern = '`;\n  return c.html(html);\n});';

const startIndex = serverCode.indexOf(startPattern);
const endIndex = serverCode.indexOf(endPattern, startIndex);

if (startIndex === -1 || endIndex === -1) {
  console.error("Patterns not found in server.ts");
  console.error("Start index:", startIndex, "End index:", endIndex);
  Deno.exit(1);
}

const escapedHtml = htmlCode.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

const newServerCode = serverCode.substring(0, startIndex + startPattern.length) + 
                      escapedHtml + 
                      serverCode.substring(endIndex);
                      
await Deno.writeTextFile(serverPath, newServerCode);
console.log("Updated server.ts successfully");
