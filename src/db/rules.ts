import { Database, FileRule } from "./schema.ts";

export class RuleRepository {
  constructor(private db: Database) {}

  addRule(rule: FileRule): number {
    const result = this.db.getDB().query<[number]>(
      `INSERT INTO file_rules (project_id, folder_path, rule_type, pattern, action)
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
      [rule.project_id, rule.folder_path || null, rule.rule_type, rule.pattern, rule.action]
    );
    return result[0]?.[0] || 0;
  }

  getRules(projectId: number, folderPath?: string): FileRule[] {
    let query = `
      SELECT id, project_id, folder_path, rule_type, pattern, action, created_at, is_deleted
      FROM file_rules
      WHERE project_id = ? AND is_deleted = 0
    `;
    const params: (number | string | null)[] = [projectId];

    if (folderPath !== undefined) {
      query += ` AND (folder_path IS NULL OR folder_path = ?)`;
      params.push(folderPath);
    }

    query += ` ORDER BY folder_path NULLS FIRST, created_at ASC`;

    const result = this.db.getDB().query<[number, number, string | null, "extension" | "file" | "folder", string, "include" | "exclude", string, number]>(
      query,
      params
    );

    return result.map(([id, project_id, folder_path, rule_type, pattern, action, created_at, is_deleted]: [number, number, string | null, "extension" | "file" | "folder", string, "include" | "exclude", string, number]) => ({
      id,
      project_id,
      folder_path,
      rule_type,
      pattern,
      action,
      created_at,
      is_deleted
    }));
  }

  getGlobalRules(projectId: number): FileRule[] {
    const result = this.db.getDB().query<[number, number, string | null, "extension" | "file" | "folder", string, "include" | "exclude", string, number]>(
      `SELECT id, project_id, folder_path, rule_type, pattern, action, created_at, is_deleted
       FROM file_rules
       WHERE project_id = ? AND folder_path IS NULL AND is_deleted = 0
       ORDER BY created_at ASC`,
      [projectId]
    );

    return result.map(([id, project_id, folder_path, rule_type, pattern, action, created_at, is_deleted]: [number, number, string | null, "extension" | "file" | "folder", string, "include" | "exclude", string, number]) => ({
      id,
      project_id,
      folder_path,
      rule_type,
      pattern,
      action,
      created_at,
      is_deleted
    }));
  }

  getFolderRules(projectId: number, folderPath: string): FileRule[] {
    const result = this.db.getDB().query<[number, number, string | null, "extension" | "file" | "folder", string, "include" | "exclude", string, number]>(
      `SELECT id, project_id, folder_path, rule_type, pattern, action, created_at, is_deleted
       FROM file_rules
       WHERE project_id = ? AND folder_path = ? AND is_deleted = 0
       ORDER BY created_at ASC`,
      [projectId, folderPath]
    );

    return result.map(([id, project_id, folder_path, rule_type, pattern, action, created_at, is_deleted]: [number, number, string | null, "extension" | "file" | "folder", string, "include" | "exclude", string, number]) => ({
      id,
      project_id,
      folder_path,
      rule_type,
      pattern,
      action,
      created_at,
      is_deleted
    }));
  }

  removeRule(ruleId: number): void {
    this.db.getDB().execute(
      `UPDATE file_rules SET is_deleted = 1 WHERE id = ?`,
      [ruleId]
    );
  }

  getDefaultExclusions(): string[] {
    const result = this.db.getDB().query<[string]>(
      `SELECT pattern FROM exclusion_templates WHERE pattern_type = 'folder'`
    );
    return result.map(([pattern]: [string]) => pattern);
  }
}
