export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Readonly<Record<string, unknown>>;

/** Structured logging. Runtime adapters write to stderr, never stdout. */
export type LoggerPort = Readonly<
	Record<LogLevel, (message: string, fields?: LogFields) => void>
>;
