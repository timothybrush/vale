'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

// One package per release target, named after Node's own platform and arch.
const TARGETS = {
	'darwin-arm64': '@vale-cli/vale-darwin-arm64',
	'darwin-x64': '@vale-cli/vale-darwin-x64',
	'linux-arm64': '@vale-cli/vale-linux-arm64',
	'linux-x64': '@vale-cli/vale-linux-x64',
	'win32-arm64': '@vale-cli/vale-win32-arm64',
	'win32-x64': '@vale-cli/vale-win32-x64'
};

class ValeError extends Error {
	constructor(message, code, extra = {}) {
		super(message);
		this.name = 'ValeError';
		this.code = code;
		Object.assign(this, extra);
	}
}

// Returns the Vale executable for this machine. VALE_BINARY, when set in
// `env`, wins, so a system install or a local build can stand in.
function binaryPath(env = process.env) {
	if (env.VALE_BINARY) {
		return env.VALE_BINARY;
	}
	const target = `${process.platform}-${process.arch}`;
	const pkg = TARGETS[target];
	if (!pkg) {
		throw new ValeError(`Vale has no prebuilt binary for ${target}.`, 'EUNSUPPORTED');
	}
	let dir;
	try {
		dir = path.dirname(require.resolve(`${pkg}/package.json`));
	} catch {
		throw new ValeError(
			`${pkg} is not installed. It is an optional dependency of @vale-cli/vale; ` +
				'reinstall without --no-optional (or --omit=optional).',
			'ENOTINSTALLED'
		);
	}
	return path.join(dir, process.platform === 'win32' ? 'vale.exe' : 'vale');
}

// The flags every call shares, with the caller's own `args` last.
function baseFlags(options, extra = []) {
	const args = ['--output=JSON'];
	if (options.config) args.push(`--config=${options.config}`);
	return args.concat(extra, options.args || []);
}

// A lint also reads the alert level and filter.
function lintFlags(options) {
	const extra = [];
	if (options.minAlertLevel) extra.push(`--minAlertLevel=${options.minAlertLevel}`);
	if (options.filter) extra.push(`--filter=${options.filter}`);
	return ['--no-exit'].concat(baseFlags(options, extra));
}

// Runs Vale and resolves to its stdout. A runtime error -- exit status 2,
// with the error as one JSON object on stderr -- rejects as a ValeError.
function exec(args, options, input) {
	return new Promise((resolve, reject) => {
		let child;
		try {
			child = spawn(binaryPath(options.env || process.env), args, {
				cwd: options.cwd,
				env: options.env,
				stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']
			});
		} catch (err) {
			reject(err);
			return;
		}
		let stdout = '';
		let stderr = '';
		child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
		child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
		child.on('error', reject);
		child.on('close', (status) => {
			if (status === 0 || status === 1) {
				resolve(stdout);
				return;
			}
			let err;
			try {
				err = JSON.parse(stderr);
			} catch {
				reject(new ValeError(stderr.trim() || `Vale exited with status ${status}.`, 'EVALE'));
				return;
			}
			reject(new ValeError(err.Text, err.Code, { path: err.Path, line: err.Line, span: err.Span }));
		});
		if (input !== undefined) {
			child.stdin.end(input);
		}
	});
}

async function json(args, options, input, empty) {
	const out = (await exec(args, options, input)).trim();
	if (!out) return empty;
	try {
		return JSON.parse(out);
	} catch {
		throw new ValeError(`Vale printed output that is not JSON: ${out}`, 'EOUTPUT');
	}
}

function paths(files, name) {
	const list = Array.isArray(files) ? files : [files];
	if (list.length === 0) {
		throw new ValeError(`${name} needs at least one file or directory.`, 'EINPUT');
	}
	return list;
}

// Checks files or directories and resolves to Vale's alerts, by path.
async function lint(files, options = {}) {
	return json(lintFlags(options).concat('--', paths(files, 'lint')), options, undefined, {});
}

// Checks a string as if it were a file with the given extension.
async function lintText(text, options = {}) {
	const ext = options.ext || '.md';
	const result = await json(lintFlags(options).concat(`--ext=${ext}`), options, text, {});
	return Object.values(result)[0] || [];
}

// Installs the Packages the active configuration lists into its StylesPath.
async function sync(options = {}) {
	const args = baseFlags(options).concat('--plain-progress');
	if (options.ifNeeded) args.push('--if-needed');
	await exec(args.concat('sync'), options);
}

// Resolves to the replacements an alert's action offers.
async function fix(alert, options = {}) {
	const body = typeof alert === 'string' ? alert : JSON.stringify(alert);
	const result = await json(baseFlags(options).concat('fix', body), options, undefined, {});
	if (result.error) {
		throw new ValeError(result.error, 'EFIX');
	}
	return result.suggestions || [];
}

// Writes every unambiguous fix back to the files and reports, per file, what
// was applied and what was skipped.
async function fixFiles(files, options = {}) {
	const list = paths(files, 'fixFiles');
	return json(baseFlags(options).concat('fix', '--apply', '--', list), options, undefined, []);
}

// The configuration a lint run in `cwd` would use, fully resolved.
async function config(options = {}) {
	return json(baseFlags(options).concat('ls-config'), options, undefined, {});
}

// Where Vale looks for its default StylesPath, .vale.ini, and native host.
async function dirs(options = {}) {
	return json(baseFlags(options).concat('ls-dirs'), options, undefined, {});
}

module.exports = { binaryPath, lint, lintText, sync, fix, fixFiles, config, dirs, ValeError };
