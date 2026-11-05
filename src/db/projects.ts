import { Database, Project, ProjectFolder } from "./schema.ts";

export class ProjectRepository {
  constructor(private db: Database) {}

  createProject(project: Project): number {
    const result = this.db.getDB().query<[number]>(
      `INSERT INTO projects (project_name, project_code, base_path) VALUES (?, ?, ?) RETURNING id`,
      [project.project_name, project.project_code, project.base_path]
    );
    return result[0]?.[0] || 0;
  }

  getProjectByCode(code: string): Project | null {
    const result = this.db.getDB().query<[number, string, string, string, string, string, number]>(
      `SELECT id, project_name, project_code, base_path, created_at, updated_at, is_deleted
       FROM projects
       WHERE project_code = ? AND is_deleted = 0`,
      [code]
    );

    if (result.length === 0) return null;

    const [id, project_name, project_code, base_path, created_at, updated_at, is_deleted] = result[0];
    return { id, project_name, project_code, base_path, created_at, updated_at, is_deleted };
  }

  getProjectByPath(path: string): Project | null {
    const normalizedPath = Database.normalizePath(path);
    const result = this.db.getDB().query<[number, string, string, string, string, string, number]>(
      `SELECT id, project_name, project_code, base_path, created_at, updated_at, is_deleted
       FROM projects
       WHERE base_path = ? AND is_deleted = 0`,
      [normalizedPath]
    );

    if (result.length === 0) return null;

    const [id, project_name, project_code, base_path, created_at, updated_at, is_deleted] = result[0];
    return { id, project_name, project_code, base_path, created_at, updated_at, is_deleted };
  }

  getAllProjects(): Project[] {
    const result = this.db.getDB().query<[number, string, string, string, string, string, number]>(
      `SELECT id, project_name, project_code, base_path, created_at, updated_at, is_deleted
       FROM projects
       WHERE is_deleted = 0
       ORDER BY created_at DESC`
    );

    return result.map(([id, project_name, project_code, base_path, created_at, updated_at, is_deleted]: [number, string, string, string, string, string, number]) => ({
      id, project_name, project_code, base_path, created_at, updated_at, is_deleted
    }));
  }

  deleteProject(projectId: number): void {
    this.db.getDB().execute(
      `UPDATE projects SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [projectId]
    );
  }

  addFolder(folder: ProjectFolder): number {
    try {
      this.db.getDB().execute(
        `INSERT INTO project_folders (project_id, folder_path, is_master)
         VALUES (?, ?, ?)`,
        [folder.project_id, folder.folder_path, folder.is_master || 0]
      );
      return this.db.getDB().lastInsertRowId;
    } catch (error) {
      // Handle unique constraint violation
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        // Folder already exists, restore if deleted
        this.db.getDB().execute(
          `UPDATE project_folders SET is_deleted = 0 WHERE project_id = ? AND folder_path = ?`,
          [folder.project_id, folder.folder_path]
        );
        const result = this.db.getDB().query<[number]>(
          `SELECT id FROM project_folders WHERE project_id = ? AND folder_path = ?`,
          [folder.project_id, folder.folder_path]
        );
        return result[0]?.[0] || 0;
      }
      throw error;
    }
  }

  getFolders(projectId: number): ProjectFolder[] {
    const result = this.db.getDB().query<[number, number, string, number, string, number]>(
      `SELECT id, project_id, folder_path, is_master, created_at, is_deleted
       FROM project_folders
       WHERE project_id = ? AND is_deleted = 0
       ORDER BY is_master DESC, created_at ASC`,
      [projectId]
    );

    return result.map(([id, project_id, folder_path, is_master, created_at, is_deleted]: [number, number, string, number, string, number]) => ({
      id, project_id, folder_path, is_master, created_at, is_deleted
    }));
  }

  removeFolder(projectId: number, folderPath: string): void {
    this.db.getDB().execute(
      `UPDATE project_folders SET is_deleted = 1 WHERE project_id = ? AND folder_path = ?`,
      [projectId, folderPath]
    );
  }

  setMasterFolder(projectId: number, folderId: number): void {
    // First, unset all master folders
    this.db.getDB().execute(
      `UPDATE project_folders SET is_master = 0 WHERE project_id = ?`,
      [projectId]
    );
    // Then set the new master
    this.db.getDB().execute(
      `UPDATE project_folders SET is_master = 1 WHERE id = ?`,
      [folderId]
    );
  }

  getMasterFolder(projectId: number): ProjectFolder | null {
    const result = this.db.getDB().query<[number, number, string, number, string, number]>(
      `SELECT id, project_id, folder_path, is_master, created_at, is_deleted
       FROM project_folders
       WHERE project_id = ? AND is_master = 1 AND is_deleted = 0`,
      [projectId]
    );

    if (result.length === 0) return null;

    const [id, project_id, folder_path, is_master, created_at, is_deleted] = result[0];
    return { id, project_id, folder_path, is_master, created_at, is_deleted };
  }
}
