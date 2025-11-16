export interface ParsedCommand {
  action: 'new' | 'add' | 'remove' | 'view' | 'host' | 'help';
  projectCode?: string;
  extensions: {
    include: string[];
    exclude: string[];
  };
  files: {
    include: string[];
    exclude: string[];
  };
  port?: number;
}

export class CommandParser {
  parse(args: string[]): ParsedCommand {
    // Check for flags
    if (args.includes('--help') || args.includes('-h')) {
      return {
        action: 'help',
        extensions: { include: [], exclude: [] },
        files: { include: [], exclude: [] }
      };
    }

    if (args.includes('--host')) {
      const portIndex = args.indexOf('--port');
      const port = portIndex >= 0 && args[portIndex + 1]
        ? parseInt(args[portIndex + 1], 10)
        : 8000;

      return {
        action: 'host',
        port,
        extensions: { include: [], exclude: [] },
        files: { include: [], exclude: [] }
      };
    }

    // No arguments = new project
    if (args.length === 0) {
      return {
        action: 'new',
        extensions: { include: [], exclude: [] },
        files: { include: [], exclude: [] }
      };
    }

    // Parse first argument for project code and action
    const firstArg = args[0];
    let projectCode: string | undefined;
    let action: 'add' | 'remove' | 'view' = 'view';

    if (firstArg.endsWith('+')) {
      action = 'add';
      projectCode = firstArg.slice(0, -1);
    } else if (firstArg.endsWith('-')) {
      action = 'remove';
      projectCode = firstArg.slice(0, -1);
    } else {
      projectCode = firstArg;
    }

    // Parse remaining arguments for file/extension rules
    const extensions = { include: [] as string[], exclude: [] as string[] };
    const files = { include: [] as string[], exclude: [] as string[] };

    for (let i = 1; i < args.length; i++) {
      const arg = args[i];

      if (arg.startsWith('.')) {
        // Extension rule
        if (arg.endsWith('+')) {
          extensions.include.push(arg.slice(0, -1));
        } else if (arg.endsWith('-')) {
          extensions.exclude.push(arg.slice(0, -1));
        }
      } else {
        // File rule
        if (arg.endsWith('+')) {
          files.include.push(arg.slice(0, -1));
        } else if (arg.endsWith('-')) {
          files.exclude.push(arg.slice(0, -1));
        }
      }
    }

    return {
      action,
      projectCode,
      extensions,
      files
    };
  }
}
