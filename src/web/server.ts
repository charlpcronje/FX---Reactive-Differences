import { Hono } from "hono";
import { Database, ProjectRepository, RuleRepository } from "../db/index.ts";
import { FolderComparator } from "../core/comparator.ts";
import { staticAssets } from "./static_assets.ts";

const app = new Hono();

// Enable CORS for all routes
app.use("/*", async (c, next) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type");
  if (c.req.method === "OPTIONS") {
    return c.body(null, 204);
  }
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

// Create project
api.post("/projects", async (c) => {
  const body = await c.req.json();
  const db = new Database();
  const projectRepo = new ProjectRepository(db);
  
  if (!body.project_name || !body.project_code || !body.base_path) {
    db.close();
    return c.json({ error: "Missing required fields" }, 400);
  }

  const existing = projectRepo.getProjectByCode(body.project_code);
  if (existing) {
    db.close();
    return c.json({ error: "Project code already exists" }, 400);
  }

  try {
    const normalizedPath = Database.normalizePath(body.base_path);
    const projectId = projectRepo.createProject({
      project_name: body.project_name,
      project_code: body.project_code,
      base_path: normalizedPath
    });

    // Automatically add base path as master folder
    projectRepo.addFolder({
      project_id: projectId,
      folder_path: normalizedPath,
      is_master: 1
    });

    db.close();
    return c.json({ success: true, project_id: projectId });
  } catch (error) {
    db.close();
    return c.json({ error: "Failed to create project" }, 500);
  }
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

// Delete project
api.delete("/projects/:code", (c) => {
  const code = c.req.param("code");
  const db = new Database();
  const projectRepo = new ProjectRepository(db);
  const project = projectRepo.getProjectByCode(code);
  
  if (!project) {
    db.close();
    return c.json({ error: "Project not found" }, 404);
  }

  // Delete associated rules and folders first (simplified cascade delete here or inside db.ts normally, but we will just delete the project if cascade is set in schema)
  try {
    projectRepo.deleteProject(project.id!);
    db.close();
    return c.json({ success: true });
  } catch (err) {
    db.close();
    return c.json({ error: "Failed to delete project" }, 500);
  }
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

// Add project folder
api.post("/projects/:code/folders", async (c) => {
  const code = c.req.param("code");
  const body = await c.req.json();
  const db = new Database();
  const projectRepo = new ProjectRepository(db);
  const project = projectRepo.getProjectByCode(code);

  if (!project) {
    db.close();
    return c.json({ error: "Project not found" }, 404);
  }

  if (!body.folder_path) {
    db.close();
    return c.json({ error: "Missing folder path" }, 400);
  }

  const normalizedPath = Database.normalizePath(body.folder_path);
  const isMaster = body.is_master ? 1 : 0;

  try {
    projectRepo.addFolder({
      project_id: project.id!,
      folder_path: normalizedPath,
      is_master: isMaster
    });
    db.close();
    return c.json({ success: true });
  } catch (error) {
    db.close();
    return c.json({ error: "Failed to add folder" }, 500);
  }
});

// Remove project folder
api.delete("/projects/:code/folders", async (c) => {
  const code = c.req.param("code");
  const body = await c.req.json();
  const db = new Database();
  const projectRepo = new ProjectRepository(db);
  const project = projectRepo.getProjectByCode(code);

  if (!project) {
    db.close();
    return c.json({ error: "Project not found" }, 404);
  }

  if (!body.folder_path) {
    db.close();
    return c.json({ error: "Missing folder path" }, 400);
  }

  const normalizedPath = Database.normalizePath(body.folder_path);

  try {
    projectRepo.removeFolder(project.id!, normalizedPath);
    db.close();
    return c.json({ success: true });
  } catch (error) {
    db.close();
    return c.json({ error: "Failed to remove folder" }, 500);
  }
});

// Get project rules
api.get("/projects/:code/rules", (c) => {
  const code = c.req.param("code");
  const db = new Database();
  const projectRepo = new ProjectRepository(db);
  const ruleRepo = new RuleRepository(db);
  const project = projectRepo.getProjectByCode(code);

  if (!project) {
    db.close();
    return c.json({ error: "Project not found" }, 404);
  }

  const rules = ruleRepo.getRules(project.id!);
  db.close();

  return c.json({ rules });
});

// Add project rule
api.post("/projects/:code/rules", async (c) => {
  const code = c.req.param("code");
  const body = await c.req.json();
  const db = new Database();
  const projectRepo = new ProjectRepository(db);
  const ruleRepo = new RuleRepository(db);
  const project = projectRepo.getProjectByCode(code);

  if (!project) {
    db.close();
    return c.json({ error: "Project not found" }, 404);
  }

  if (!body.rule_type || !body.pattern || !body.action) {
    db.close();
    return c.json({ error: "Missing required fields" }, 400);
  }

  try {
    ruleRepo.addRule({
      project_id: project.id!,
      folder_path: body.folder_path ? Database.normalizePath(body.folder_path) : null,
      rule_type: body.rule_type,
      pattern: body.pattern,
      action: body.action
    });
    db.close();
    return c.json({ success: true });
  } catch (error) {
    db.close();
    return c.json({ error: "Failed to add rule" }, 500);
  }
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
    if (error instanceof Error) {
      return c.json({ error: "Failed to read file", details: error.message }, 500);
    }
    return c.json({ error: "Failed to read file", details: "An unknown error occurred" }, 500);
  }
});

// Mount API routes
app.route("/api", api);

// Serve static assets from bundled map
app.get("/*", async (c) => {
  const url = new URL(c.req.url);
  const path = url.pathname === "/" ? "/index.html" : url.pathname;
  
  if (staticAssets.has(path)) {
    const asset = staticAssets.get(path)!;
    return new Response(asset.data, {
      status: 200,
      headers: {
        "Content-Type": asset.type,
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Resource-Policy": "same-site",
      }
    });
  }
  
  // Fallback to index.html for SPA routing if not found and not an API call
  if (!path.startsWith("/api/")) {
    const asset = staticAssets.get("/index.html")!;
    return new Response(asset.data, {
      status: 200,
      headers: {
        "Content-Type": asset.type,
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Resource-Policy": "same-site",
        "X-Fallback-Reason": `NotFound-${path}`
      }
    });
  }

  return c.text("Not found", 404);
});

export async function startWebServer(port: number) {
  console.log(`🚀 Starting FXDif web server on port ${port}...\n`);
  console.log(`   📱 Web UI: http://localhost:${port}`);
  console.log(`   🔌 API:    http://localhost:${port}/api`);
  console.log(`\n💡 Press Ctrl+C to stop the server\n`);

  Deno.serve({ port }, app.fetch);
}
