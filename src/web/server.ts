import { Hono } from "hono";
import { Database, ProjectRepository, RuleRepository } from "../db/index.ts";
import { FolderComparator } from "../core/comparator.ts";

const app = new Hono();

// Enable CORS for all routes
app.use("/*", async (c, next) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type");
  await next();
});

// API Routes
const api = new Hono();

// Get all projects
api.get("/projects", (c) => {
  const db = new Database();
  const projectRepo = new ProjectRepository(db);
  const projects = projectRepo.getAllProjects();
  db.close();
  return c.json({ projects });
});

// Get project by code
api.get("/projects/:code", (c) => {
  const code = c.req.param("code");
  const db = new Database();
  const projectRepo = new ProjectRepository(db);
  const project = projectRepo.getProjectByCode(code);
  db.close();

  if (!project) {
    return c.json({ error: "Project not found" }, 404);
  }

  return c.json({ project });
});

// Get project folders
api.get("/projects/:code/folders", (c) => {
  const code = c.req.param("code");
  const db = new Database();
  const projectRepo = new ProjectRepository(db);
  const project = projectRepo.getProjectByCode(code);

  if (!project) {
    db.close();
    return c.json({ error: "Project not found" }, 404);
  }

  const folders = projectRepo.getFolders(project.id!);
  db.close();

  return c.json({ folders });
});

// Get project comparison
api.get("/projects/:code/compare", async (c) => {
  const code = c.req.param("code");
  const db = new Database();
  const projectRepo = new ProjectRepository(db);
  const ruleRepo = new RuleRepository(db);

  const project = projectRepo.getProjectByCode(code);
  if (!project) {
    db.close();
    return c.json({ error: "Project not found" }, 404);
  }

  const folders = projectRepo.getFolders(project.id!);
  const masterFolder = folders.find(f => f.is_master === 1);

  if (!masterFolder) {
    db.close();
    return c.json({ error: "No master folder set" }, 400);
  }

  const compareFolders = folders.filter(f => f.is_master !== 1);
  const rules = ruleRepo.getRules(project.id!);
  const defaultExclusions = ruleRepo.getDefaultExclusions();

  const scanOptions = {
    excludeFolders: defaultExclusions,
    rules
  };

  const comparator = new FolderComparator();
  const comparison = await comparator.compareFolders(
    masterFolder,
    compareFolders,
    scanOptions
  );

  db.close();

  return c.json({ comparison });
});

// Get file content
api.get("/files/content", async (c) => {
  const filePath = c.req.query("path");

  if (!filePath) {
    return c.json({ error: "File path is required" }, 400);
  }

  try {
    const content = await Deno.readTextFile(Database.denormalizePath(filePath));
    return c.json({ content });
  } catch (error) {
    return c.json({ error: "Failed to read file", details: error.message }, 500);
  }
});

// Mount API routes
app.route("/api", api);

// Fallback to index.html for SPA routing
app.get("/*", async (c) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FXDif - Folder Comparison Tool</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      padding: 20px;
    }
    .container {
      max-width: 800px;
      text-align: center;
      background: rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(10px);
      border-radius: 20px;
      padding: 60px 40px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    }
    h1 {
      font-size: 3rem;
      margin-bottom: 20px;
      background: linear-gradient(to right, #fff, #f0f0f0);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .subtitle {
      font-size: 1.2rem;
      margin-bottom: 40px;
      opacity: 0.9;
    }
    .features {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-top: 40px;
      text-align: left;
    }
    .feature {
      background: rgba(255, 255, 255, 0.15);
      padding: 20px;
      border-radius: 10px;
    }
    .feature h3 {
      font-size: 1.1rem;
      margin-bottom: 10px;
    }
    .feature p {
      font-size: 0.9rem;
      opacity: 0.8;
    }
    .api-info {
      margin-top: 40px;
      padding: 20px;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 10px;
      text-align: left;
    }
    code {
      background: rgba(0, 0, 0, 0.3);
      padding: 2px 8px;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
      font-size: 0.9rem;
    }
    .endpoints {
      margin-top: 20px;
    }
    .endpoint {
      margin: 10px 0;
      padding: 10px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 5px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🎯 FXDif</h1>
    <p class="subtitle">Reactive Folder Differences Tool</p>

    <div class="features">
      <div class="feature">
        <h3>🔍 Multi-Folder Comparison</h3>
        <p>Compare any number of folders against a master directory</p>
      </div>
      <div class="feature">
        <h3>📊 Project Management</h3>
        <p>Save and manage multiple comparison projects</p>
      </div>
      <div class="feature">
        <h3>🎨 Dual Interfaces</h3>
        <p>Beautiful TUI and web-based UI</p>
      </div>
      <div class="feature">
        <h3>🎯 Smart Filtering</h3>
        <p>Include/exclude specific file extensions and files</p>
      </div>
    </div>

    <div class="api-info">
      <h2>🚀 API Endpoints</h2>
      <div class="endpoints">
        <div class="endpoint">
          <code>GET /api/projects</code><br>
          Get all projects
        </div>
        <div class="endpoint">
          <code>GET /api/projects/:code</code><br>
          Get project details
        </div>
        <div class="endpoint">
          <code>GET /api/projects/:code/folders</code><br>
          Get project folders
        </div>
        <div class="endpoint">
          <code>GET /api/projects/:code/compare</code><br>
          Get comparison results
        </div>
        <div class="endpoint">
          <code>GET /api/files/content?path=...</code><br>
          Get file content
        </div>
      </div>
    </div>

    <p style="margin-top: 40px; opacity: 0.7;">
      Full React UI coming soon! For now, use the TUI or API endpoints.
    </p>
  </div>
</body>
</html>`;
  return c.html(html);
});

export async function startWebServer(port: number) {
  console.log(`🚀 Starting FXDif web server on port ${port}...\n`);
  console.log(`   📱 Web UI: http://localhost:${port}`);
  console.log(`   🔌 API:    http://localhost:${port}/api`);
  console.log(`\n💡 Press Ctrl+C to stop the server\n`);

  Deno.serve({ port }, app.fetch);
}
