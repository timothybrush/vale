export interface Alert {
	Action: { Name: string; Params: string[] | null };
	Suggestions: string[];
	Span: [number, number];
	Check: string;
	Description: string;
	Link: string;
	Message: string;
	Severity: 'suggestion' | 'warning' | 'error';
	Match: string;
	Line: number;
}

export interface Options {
	/** The directory Vale runs in, which is where it looks for .vale.ini. */
	cwd?: string;
	/** A .vale.ini to use in place of the one Vale would find. */
	config?: string;
	minAlertLevel?: 'suggestion' | 'warning' | 'error';
	/** A rule filter expression, as `vale --filter`. */
	filter?: string;
	/** Further CLI flags, passed before the files. */
	args?: string[];
	env?: NodeJS.ProcessEnv;
}

export interface TextOptions extends Options {
	/** The extension that sets the text's format. Defaults to .md. */
	ext?: string;
}

export declare class ValeError extends Error {
	/** Vale's error code (E100, E201), or one of the wrapper's own (EUNSUPPORTED, ENOTINSTALLED, EINPUT, EOUTPUT, EFIX, EVALE). */
	code: string;
	path?: string;
	line?: number;
	span?: number;
}

/** The Vale executable for this machine; VALE_BINARY in `env` overrides it. */
export declare function binaryPath(env?: NodeJS.ProcessEnv): string;

/** Lints files or directories and resolves to the alerts for each path. */
export declare function lint(files: string | string[], options?: Options): Promise<Record<string, Alert[]>>;

/** Lints a string as a file with the given extension. */
export declare function lintText(text: string, options?: TextOptions): Promise<Alert[]>;

export interface SyncOptions extends Options {
	/** Skip the sync while the packages and Vale version match the last one's. */
	ifNeeded?: boolean;
}

/** Installs the Packages the active configuration lists into its StylesPath. */
export declare function sync(options?: SyncOptions): Promise<void>;

/** The replacements an alert's action offers. An empty string means removal. */
export declare function fix(alert: Alert | string, options?: Options): Promise<string[]>;

export interface FixReport {
	Path: string;
	Applied: number;
	Skipped: { Check: string; Line: number; Span: [number, number]; Reason: string }[];
}

/** Writes every unambiguous fix back to the files. */
export declare function fixFiles(files: string | string[], options?: Options): Promise<FixReport[]>;

/** The configuration a lint run in `cwd` would use, fully resolved. */
export declare function config(options?: Options): Promise<Record<string, unknown>>;

/** Where Vale looks for its default StylesPath, .vale.ini, and native host. */
export declare function dirs(options?: Options): Promise<{ StylesPath: string; '.vale.ini': string; 'vale-native': string }>;
