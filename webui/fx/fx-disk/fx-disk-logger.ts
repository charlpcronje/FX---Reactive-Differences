// fx-disk/fx-disk-logger.ts
/**
 * FXDisk WASM Smart Client - Unified Logger
 */

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    NONE = 4,
}

export class FXDiskLogger {
    private static instance: FXDiskLogger;
    private level: LogLevel = LogLevel.INFO;
    private prefix = '[FXDisk]';

    private constructor() {}

    static getInstance(): FXDiskLogger {
        if (!FXDiskLogger.instance) {
            FXDiskLogger.instance = new FXDiskLogger();
        }
        return FXDiskLogger.instance;
    }

    setLevel(level: LogLevel): void {
        this.level = level;
    }

    setPrefix(prefix: string): void {
        this.prefix = prefix;
    }

    debug(msg: string, data?: unknown): void {
        if (this.level <= LogLevel.DEBUG) {
            console.debug(`${this.prefix} ${msg}`, data ?? '');
        }
    }

    info(msg: string, data?: unknown): void {
        if (this.level <= LogLevel.INFO) {
            console.log(`${this.prefix} ${msg}`, data ?? '');
        }
    }

    warn(msg: string, data?: unknown): void {
        if (this.level <= LogLevel.WARN) {
            console.warn(`${this.prefix} ${msg}`, data ?? '');
        }
    }

    error(msg: string, err?: unknown): void {
        if (this.level <= LogLevel.ERROR) {
            console.error(`${this.prefix} ${msg}`, err ?? '');
        }
    }

    time(label: string): void {
        if (this.level <= LogLevel.DEBUG) {
            console.time(`${this.prefix} ${label}`);
        }
    }

    timeEnd(label: string): void {
        if (this.level <= LogLevel.DEBUG) {
            console.timeEnd(`${this.prefix} ${label}`);
        }
    }
}

export const logger = FXDiskLogger.getInstance();
