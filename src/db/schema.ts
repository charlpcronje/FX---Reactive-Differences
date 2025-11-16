import { DB } from "@db/sqlite";
import { join } from "@std/path";

export interface Project {
  id?: number;
  project_name: string;
  project_code: string;
  base_path: string;
  created_at?: string;
  updated_at?: string;
  is_deleted?: number;
}

export interface ProjectFolder {
  id?: number;
  project_id: number;
  folder_path: string;
  is_master?: number;
  created_at?: string;
  is_deleted?: number;
}

export interface FileRule {
  id?: number;
  project_id: number;
  folder_path?: string | null;
  rule_type: 'extension' | 'file' | 'folder';
  pattern: string;
  action: 'include' | 'exclude';
  created_at?: string;
  is_deleted?: number;
}

export interface ExclusionTemplate {
  id?: number;
  pattern: string;
  pattern_type: 'folder' | 'extension';
  description: string;
}

export class Database {
  private db: DB;
  private dbPath: string;

  constructor(dbPath?: string) {
    // Store database in user's home directory or app data
    const homeDir = Deno.env.get("USERPROFILE") || Deno.env.get("HOME") || ".";
    const appDir = join(homeDir, ".fxdif");

    try {
      Deno.mkdirSync(appDir, { recursive: true });
    } catch {
      // Directory might already exist
    }

    this.dbPath = dbPath || join(appDir, "fxdif.db");
    this.db = new DB(this.dbPath);
    this.initialize();
  }

  private initialize() {
    // Create projects table
    this.db.execute(`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_name TEXT NOT NULL,
        project_code TEXT UNIQUE NOT NULL,
        base_path TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_deleted INTEGER DEFAULT 0
      )
    `);

    // Create project_folders table
    this.db.execute(`
      CREATE TABLE IF NOT EXISTS project_folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        folder_path TEXT NOT NULL,
        is_master INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_deleted INTEGER DEFAULT 0,
        FOREIGN KEY (project_id) REFERENCES projects(id),
        UNIQUE(project_id, folder_path)
      )
    `);

    // Create file_rules table
    this.db.execute(`
      CREATE TABLE IF NOT EXISTS file_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        folder_path TEXT,
        rule_type TEXT NOT NULL CHECK(rule_type IN ('extension', 'file', 'folder')),
        pattern TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('include', 'exclude')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_deleted INTEGER DEFAULT 0,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      )
    `);

    // Create exclusion_templates table
    this.db.execute(`
      CREATE TABLE IF NOT EXISTS exclusion_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern TEXT NOT NULL UNIQUE,
        pattern_type TEXT NOT NULL CHECK(pattern_type IN ('folder', 'extension')),
        description TEXT
      )
    `);

    // Insert default exclusion templates
    const defaultExclusions = [
      { pattern: '.git', type: 'folder', desc: 'Git repository' },
      { pattern: 'node_modules', type: 'folder', desc: 'Node.js dependencies' },
      { pattern: 'vendor', type: 'folder', desc: 'PHP/Go dependencies' },
      { pattern: 'composer', type: 'folder', desc: 'Composer cache' },
      { pattern: '__pycache__', type: 'folder', desc: 'Python cache' },
      { pattern: '.pytest_cache', type: 'folder', desc: 'Pytest cache' },
      { pattern: '.next', type: 'folder', desc: 'Next.js build' },
      { pattern: '.nuxt', type: 'folder', desc: 'Nuxt.js build' },
      { pattern: 'dist', type: 'folder', desc: 'Distribution folder' },
      { pattern: 'build', type: 'folder', desc: 'Build folder' },
      { pattern: '.deno', type: 'folder', desc: 'Deno cache' },
      { pattern: 'target', type: 'folder', desc: 'Rust build' },
      { pattern: 'bin', type: 'folder', desc: 'Binary folder' },
      { pattern: 'obj', type: 'folder', desc: 'Object files' },
      { pattern: '.vscode', type: 'folder', desc: 'VS Code settings' },
      { pattern: '.idea', type: 'folder', desc: 'IntelliJ settings' },
    ];

    for (const exc of defaultExclusions) {
      this.db.execute(
        `INSERT OR IGNORE INTO exclusion_templates (pattern, pattern_type, description) VALUES (?, ?, ?)`,
        [exc.pattern, exc.type, exc.desc]
      );
    }

    // Create indexes for performance
    this.db.execute(`CREATE INDEX IF NOT EXISTS idx_projects_code ON projects(project_code)`);
    this.db.execute(`CREATE INDEX IF NOT EXISTS idx_projects_deleted ON projects(is_deleted)`);
    this.db.execute(`CREATE INDEX IF NOT EXISTS idx_folders_project ON project_folders(project_id)`);
    this.db.execute(`CREATE INDEX IF NOT EXISTS idx_folders_deleted ON project_folders(is_deleted)`);
    this.db.execute(`CREATE INDEX IF NOT EXISTS idx_rules_project ON file_rules(project_id)`);
  }

  // Helper method to normalize Windows paths for storage
  static normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/:/g, '--');
  }

  // Helper method to denormalize paths for display/use
  static denormalizePath(path: string): string {
    // Handle both Windows and Unix paths
    if (Deno.build.os === 'windows') {
      return path.replace(/--/, ':').replace(/\//g, '\\');
    }
    return path;
  }

  close() {
    this.db.close();
  }

  getDB(): DB {
    return this.db;
  }

  getPath(): string {
    return this.dbPath;
  }
}
