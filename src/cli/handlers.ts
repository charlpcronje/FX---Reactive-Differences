import { Input, Confirm, Select } from "@cliffy/prompt";
import { Database, ProjectRepository, RuleRepository, Project, ProjectFolder } from "../db/index.ts";
import { basename, resolve } from "@std/path";
import { ParsedCommand } from "./parser.ts";

export class CommandHandler {
  private db: Database;
  private projectRepo: ProjectRepository;
  private ruleRepo: RuleRepository;

  constructor() {
    this.db = new Database();
    this.projectRepo = new ProjectRepository(this.db);
    this.ruleRepo = new RuleRepository(this.db);
  }

  async handleNew(currentPath: string): Promise<void> {
    console.log("🎯 Create New Project\n");

    const folderName = basename(currentPath);
    const existingProject = this.projectRepo.getProjectByPath(currentPath);

    if (existingProject) {
      console.log(`⚠️  A project already exists for this folder: "${existingProject.project_name}"`);
      console.log(`   Project code: ${existingProject.project_code}\n`);

      const shouldContinue = await Confirm.prompt({
        message: "Do you want to view this project instead?",
        default: true
      });

      if (shouldContinue) {
        console.log("\n✨ Opening project view...\n");
        return;
      }
      return;
    }

    const projectName = await Input.prompt({
      message: "Project name:",
      default: folderName,
      minLength: 1
    });

    const projectCode = await Input.prompt({
      message: "Project code:",
      default: projectName.toLowerCase().replace(/\s+/g, '-'),
      minLength: 1,
      validate: (value) => {
        const existing = this.projectRepo.getProjectByCode(value);
        if (existing) {
          return `Project code "${value}" already exists!`;
        }
        return true;
      }
    });

    const normalizedPath = Database.normalizePath(currentPath);
    const projectId = this.projectRepo.createProject({
      project_name: projectName,
      project_code: projectCode,
      base_path: normalizedPath
    });

    // Add the current folder as the master folder
    this.projectRepo.addFolder({
      project_id: projectId,
      folder_path: normalizedPath,
      is_master: 1
    });

    console.log("\n✅ Project created successfully!");
    console.log(`   Name: ${projectName}`);
    console.log(`   Code: ${projectCode}`);
    console.log(`   Path: ${currentPath}`);
    console.log(`\n💡 Next steps:`);
    console.log(`   1. Navigate to other folders you want to compare`);
    console.log(`   2. Run: fxdif ${projectCode}+`);
    console.log(`   3. View differences: fxdif ${projectCode}\n`);
  }

  async handleAdd(command: ParsedCommand, currentPath: string): Promise<void> {
    if (!command.projectCode) {
      console.error("❌ Error: Project code is required");
      return;
    }

    const project = this.projectRepo.getProjectByCode(command.projectCode);
    if (!project) {
      console.error(`❌ Error: Project "${command.projectCode}" not found`);
      return;
    }

    // Check if we're adding rules or a folder
    if (command.extensions.include.length || command.extensions.exclude.length ||
        command.files.include.length || command.files.exclude.length) {
      await this.handleAddRules(project, command, currentPath);
      return;
    }

    // Add folder
    const normalizedPath = Database.normalizePath(currentPath);

    // Check if folder already exists
    const folders = this.projectRepo.getFolders(project.id!);
    const existing = folders.find(f => f.folder_path === normalizedPath);

    if (existing && !existing.is_deleted) {
      console.log(`ℹ️  Folder already added to project "${command.projectCode}"`);
      return;
    }

    this.projectRepo.addFolder({
      project_id: project.id!,
      folder_path: normalizedPath,
      is_master: 0
    });

    console.log(`✅ Folder added to project "${command.projectCode}"`);
    console.log(`   Path: ${currentPath}\n`);
    console.log(`💡 View differences: fxdif ${command.projectCode}\n`);
  }

  async handleAddRules(project: Project, command: ParsedCommand, currentPath: string): Promise<void> {
    const normalizedPath = Database.normalizePath(currentPath);
    const basePath = Database.denormalizePath(project.base_path);

    // Determine if this is a global rule (in base folder) or folder-specific
    const isGlobal = resolve(currentPath) === resolve(basePath);
    const folderPath = isGlobal ? null : normalizedPath;

    let rulesAdded = 0;

    // Add extension rules
    for (const ext of command.extensions.include) {
      this.ruleRepo.addRule({
        project_id: project.id!,
        folder_path: folderPath,
        rule_type: 'extension',
        pattern: ext,
        action: 'include'
      });
      rulesAdded++;
    }

    for (const ext of command.extensions.exclude) {
      this.ruleRepo.addRule({
        project_id: project.id!,
        folder_path: folderPath,
        rule_type: 'extension',
        pattern: ext,
        action: 'exclude'
      });
      rulesAdded++;
    }

    // Add file rules
    for (const file of command.files.include) {
      this.ruleRepo.addRule({
        project_id: project.id!,
        folder_path: folderPath,
        rule_type: 'file',
        pattern: file,
        action: 'include'
      });
      rulesAdded++;
    }

    for (const file of command.files.exclude) {
      this.ruleRepo.addRule({
        project_id: project.id!,
        folder_path: folderPath,
        rule_type: 'file',
        pattern: file,
        action: 'exclude'
      });
      rulesAdded++;
    }

    console.log(`✅ ${rulesAdded} rule(s) added to project "${command.projectCode}"`);
    console.log(`   Scope: ${isGlobal ? 'Global' : 'Folder-specific'}`);
    if (!isGlobal) {
      console.log(`   Path: ${currentPath}`);
    }
    console.log();
  }

  async handleRemove(command: ParsedCommand, currentPath: string): Promise<void> {
    if (!command.projectCode) {
      console.error("❌ Error: Project code is required");
      return;
    }

    const project = this.projectRepo.getProjectByCode(command.projectCode);
    if (!project) {
      console.error(`❌ Error: Project "${command.projectCode}" not found`);
      return;
    }

    const normalizedPath = Database.normalizePath(currentPath);

    // Remove the folder
    this.projectRepo.removeFolder(project.id!, normalizedPath);

    console.log(`✅ Folder removed from project "${command.projectCode}"`);
    console.log(`   Path: ${currentPath}\n`);
  }

  getDatabase(): Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}
