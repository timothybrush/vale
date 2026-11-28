import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

import { build, TARGETS } from '../build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.join(here, '..', 'vale');
const require = createRequire(import.meta.url);
// Resolved, since require.resolve returns real paths (macOS's /var is a link).
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vale-npm-')));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const unix = process.platform !== 'win32';

// A stand-in for Vale: echoes its arguments and stdin as an alert, or fails
// the way Vale does when FAKE_VALE says to.
function fakeVale(dir) {
	const file = path.join(dir, 'fake-vale');
	fs.writeFileSync(
		file,
		`#!/usr/bin/env node
const args = process.argv.slice(2);
const mode = process.env.FAKE_VALE || 'ok';
if (mode === 'e201') {
  process.stderr.write(JSON.stringify({ Line: 3, Path: '.vale.ini', Text: 'bad config', Code: 'E201', Span: 1 }));
  process.exit(2);
}
if (mode === 'crash') { process.stderr.write('boom'); process.exit(2); }
if (mode === 'exit') process.exit(Number(process.env.FAKE_STATUS));
const cmd = args.find((a) => ['sync', 'fix', 'ls-config', 'ls-dirs'].includes(a));
if (cmd === 'sync') { process.stdout.write(' SUCCESS  Synced 0 package(s).\\n'); process.exit(0); }
if (cmd === 'fix' && args.includes('--apply')) {
  process.stdout.write(JSON.stringify([{ Path: args[args.length - 1], Applied: 1, Skipped: [], args }]));
  process.exit(0);
}
if (cmd === 'fix') {
  process.stdout.write(JSON.stringify({ suggestions: [args[args.length - 1]], error: process.env.FAKE_FIX_ERROR || '' }));
  process.exit(0);
}
if (cmd) { process.stdout.write(JSON.stringify({ args })); process.exit(0); }
let input = '';
if (!process.stdin.isTTY) { try { input = require('fs').readFileSync(0, 'utf8'); } catch {} }
const alert = { Check: 'Fake.Args', Message: JSON.stringify({ args, input, cwd: process.cwd() }), Severity: 'error', Line: 1, Span: [1, 2] };
process.stdout.write(JSON.stringify({ [input ? 'stdin.md' : args[args.length - 1]]: [alert] }));
process.exit(mode === 'errors' ? 1 : 0);
`
	);
	fs.chmodSync(file, 0o755);
	return file;
}

describe('build', { skip: !unix && 'uses tar and unzip' }, () => {
	const version = '3.29.0';
	const archives = path.join(tmp, 'archives');
	const out = path.join(tmp, 'out');

	function archivesFor(corrupt) {
		fs.rmSync(archives, { recursive: true, force: true });
		fs.mkdirSync(archives, { recursive: true });
		const lines = [];
		for (const t of TARGETS) {
			const stage = path.join(tmp, 'stage', t.archive);
			fs.mkdirSync(stage, { recursive: true });
			const bin = t.os === 'win32' ? 'vale.exe' : 'vale';
			fs.writeFileSync(path.join(stage, bin), `binary for ${t.os}-${t.cpu}`);
			fs.writeFileSync(path.join(stage, 'README.md'), 'not packaged');
			const name = `vale_${version}_${t.archive}`;
			const file = path.join(archives, name);
			if (name.endsWith('.zip')) {
				execFileSync('zip', ['-q', file, bin, 'README.md'], { cwd: stage });
			} else {
				execFileSync('tar', ['-czf', file, bin, 'README.md'], { cwd: stage });
			}
			const sum = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
			lines.push(`${corrupt === t.archive ? '0'.repeat(64) : sum}  ${name}`);
		}
		fs.writeFileSync(path.join(archives, `vale_${version}_checksums.txt`), lines.join('\n') + '\n');
	}

	test('writes one package per platform, then the main package', () => {
		archivesFor();
		const dirs = build({ version, archives, out });
		assert.equal(dirs.length, TARGETS.length + 1);
		assert.equal(path.basename(dirs.at(-1)), 'vale');

		for (const t of TARGETS) {
			const dir = path.join(out, `vale-${t.os}-${t.cpu}`);
			const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
			const bin = t.os === 'win32' ? 'vale.exe' : 'vale';
			assert.equal(pkg.name, `@vale-cli/vale-${t.os}-${t.cpu}`);
			assert.equal(pkg.version, version);
			assert.deepEqual([pkg.os, pkg.cpu, pkg.files], [[t.os], [t.cpu], [bin]]);
			assert.equal(fs.readFileSync(path.join(dir, bin), 'utf8'), `binary for ${t.os}-${t.cpu}`);
			assert.equal(fs.statSync(path.join(dir, bin)).mode & 0o111, 0o111);
			assert.ok(!fs.existsSync(path.join(dir, 'README.md')) || !fs.readFileSync(path.join(dir, 'README.md'), 'utf8').includes('not packaged'));
		}

		const main = JSON.parse(fs.readFileSync(path.join(out, 'vale', 'package.json'), 'utf8'));
		assert.equal(main.version, version);
		assert.deepEqual(
			Object.keys(main.optionalDependencies).sort(),
			TARGETS.map((t) => `@vale-cli/vale-${t.os}-${t.cpu}`).sort()
		);
		assert.ok(Object.values(main.optionalDependencies).every((v) => v === version));
		for (const f of ['cli.js', 'index.js', 'index.d.ts', 'README.md', 'LICENSE']) {
			assert.ok(fs.existsSync(path.join(out, 'vale', f)), f);
		}
	});

	test('rejects an archive whose checksum does not match', () => {
		archivesFor('Linux_arm64.tar.gz');
		assert.throws(() => build({ version, archives, out }), /vale_3\.29\.0_Linux_arm64\.tar\.gz: checksum/);
	});

	test('rejects a release without a checksums file', () => {
		archivesFor();
		fs.rmSync(path.join(archives, `vale_${version}_checksums.txt`));
		assert.throws(() => build({ version, archives, out }), /missing .*checksums\.txt/);
	});

	test('rejects a version that is not a release', () => {
		assert.throws(() => build({ version: 'master', archives, out }), /not a release version/);
	});
});

describe('binaryPath', () => {
	test('finds the binary in the platform package', () => {
		const root = path.join(tmp, 'resolve', 'node_modules', '@vale-cli');
		const plat = path.join(root, `vale-${process.platform}-${process.arch}`);
		fs.mkdirSync(plat, { recursive: true });
		fs.mkdirSync(path.join(root, 'vale'), { recursive: true });
		fs.writeFileSync(path.join(plat, 'package.json'), '{}');
		fs.copyFileSync(path.join(pkgDir, 'index.js'), path.join(root, 'vale', 'index.js'));

		const saved = process.env.VALE_BINARY;
		delete process.env.VALE_BINARY;
		try {
			const { binaryPath } = require(path.join(root, 'vale', 'index.js'));
			assert.equal(binaryPath(), path.join(plat, unix ? 'vale' : 'vale.exe'));
		} finally {
			if (saved !== undefined) process.env.VALE_BINARY = saved;
		}
	});

	test('says how to fix a missing platform package', () => {
		const root = path.join(tmp, 'missing', 'node_modules', '@vale-cli', 'vale');
		fs.mkdirSync(root, { recursive: true });
		fs.copyFileSync(path.join(pkgDir, 'index.js'), path.join(root, 'index.js'));
		const saved = process.env.VALE_BINARY;
		delete process.env.VALE_BINARY;
		try {
			const { binaryPath } = require(path.join(root, 'index.js'));
			assert.throws(binaryPath, (err) => err.code === 'ENOTINSTALLED' && /--omit=optional/.test(err.message));
		} finally {
			if (saved !== undefined) process.env.VALE_BINARY = saved;
		}
	});
});

describe('API', { skip: !unix && 'uses a script as the binary' }, () => {
	const fake = fakeVale(tmp);
	const vale = require(path.join(pkgDir, 'index.js'));
	const env = (mode, extra = {}) => ({ ...process.env, VALE_BINARY: fake, FAKE_VALE: mode, ...extra });
	process.env.VALE_BINARY = fake;

	const seen = (alerts) => JSON.parse(alerts[0].Message);

	test('lint passes the options as flags, before the files', async () => {
		const result = await vale.lint(['a.md', 'b.md'], {
			cwd: tmp,
			config: 'x.ini',
			minAlertLevel: 'error',
			filter: '.Name=="T.Very"',
			args: ['--glob=*.md'],
			env: env('ok')
		});
		const { args, cwd } = seen(result['b.md']);
		assert.deepEqual(args, [
			'--no-exit',
			'--output=JSON',
			'--config=x.ini',
			'--minAlertLevel=error',
			'--filter=.Name=="T.Very"',
			'--glob=*.md',
			'--',
			'a.md',
			'b.md'
		]);
		assert.equal(fs.realpathSync(cwd), fs.realpathSync(tmp));
	});

	test('lint resolves when Vale exits 1 for errors', async () => {
		const result = await vale.lint('doc.md', { env: env('errors') });
		assert.equal(result['doc.md'][0].Check, 'Fake.Args');
	});

	test('lint rejects an empty list', async () => {
		await assert.rejects(vale.lint([]), { code: 'EINPUT' });
	});

	test('lintText sends the text on stdin with its extension', async () => {
		const alerts = await vale.lintText('This is very good.', { ext: '.rst', env: env('ok') });
		const { args, input } = seen(alerts);
		assert.equal(input, 'This is very good.');
		assert.equal(args.at(-1), '--ext=.rst');
	});

	test('a runtime error rejects with Vale\'s code and position', async () => {
		await assert.rejects(vale.lint('doc.md', { env: env('e201') }), (err) => {
			assert.ok(err instanceof vale.ValeError);
			assert.deepEqual([err.code, err.message, err.path, err.line], ['E201', 'bad config', '.vale.ini', 3]);
			return true;
		});
	});

	test('an error that is not JSON keeps its text', async () => {
		await assert.rejects(vale.lint('doc.md', { env: env('crash') }), { code: 'EVALE', message: 'boom' });
	});

	test('cli.js forwards arguments and the exit status', () => {
		const cli = path.join(pkgDir, 'cli.js');
		const ok = spawnSync(process.execPath, [cli, 'one.md'], { env: env('ok'), encoding: 'utf8' });
		assert.equal(ok.status, 0);
		assert.deepEqual(seen(JSON.parse(ok.stdout)['one.md']).args, ['one.md']);

		const failed = spawnSync(process.execPath, [cli], { env: env('exit', { FAKE_STATUS: '3' }) });
		assert.equal(failed.status, 3);
	});

	test('sync asks for plain progress, and --if-needed when told', async () => {
		await vale.sync({ env: env('ok') });
		const argsFile = path.join(tmp, 'sync-args');
		const spy = path.join(tmp, 'spy-vale');
		fs.writeFileSync(spy, `#!/bin/sh\necho "$@" > ${JSON.stringify(argsFile)}\n`);
		fs.chmodSync(spy, 0o755);
		await vale.sync({ ifNeeded: true, config: 'x.ini', env: { ...process.env, VALE_BINARY: spy } });
		assert.equal(fs.readFileSync(argsFile, 'utf8').trim(), '--output=JSON --config=x.ini --plain-progress --if-needed sync');
	});

	test('fix sends the alert as JSON and resolves to its suggestions', async () => {
		const alert = { Check: 'T.Very', Match: 'very', Action: { Name: 'remove', Params: null } };
		assert.deepEqual(await vale.fix(alert, { env: env('ok') }), [JSON.stringify(alert)]);
		assert.deepEqual(await vale.fix('{"Check":"T"}', { env: env('ok') }), ['{"Check":"T"}']);
	});

	test('fix rejects when Vale reports an error in its result', async () => {
		await assert.rejects(vale.fix({}, { env: env('ok', { FAKE_FIX_ERROR: 'no action' }) }), {
			code: 'EFIX',
			message: 'no action'
		});
	});

	test('fixFiles applies fixes after a -- separator', async () => {
		const [report] = await vale.fixFiles('doc.md', { env: env('ok') });
		assert.equal(report.Path, 'doc.md');
		assert.deepEqual(report.args.slice(-4), ['fix', '--apply', '--', 'doc.md']);
		await assert.rejects(vale.fixFiles([]), { code: 'EINPUT' });
	});

	test('config and dirs parse the ls-* output', async () => {
		assert.deepEqual((await vale.config({ config: 'x.ini', env: env('ok') })).args, ['--output=JSON', '--config=x.ini', 'ls-config']);
		assert.deepEqual((await vale.dirs({ env: env('ok') })).args, ['--output=JSON', 'ls-dirs']);
	});

	test('ESM imports get named exports', async () => {
		const mod = await import(path.join(pkgDir, 'index.js'));
		assert.equal(typeof mod.lint, 'function');
		for (const name of ['lint', 'lintText', 'sync', 'fix', 'fixFiles', 'config', 'dirs', 'binaryPath']) {
			assert.equal(typeof mod[name], 'function', name);
		}
	});
});

// The same calls against a real Vale, when VALE_TEST_BINARY names one.
describe('API with Vale', { skip: !process.env.VALE_TEST_BINARY && 'VALE_TEST_BINARY is not set' }, () => {
	const vale = require(path.join(pkgDir, 'index.js'));
	const dir = path.join(tmp, 'project');
	const opts = () => ({ cwd: dir, env: { ...process.env, VALE_BINARY: process.env.VALE_TEST_BINARY } });

	fs.mkdirSync(path.join(dir, 'styles', 'T'), { recursive: true });
	fs.writeFileSync(path.join(dir, '.vale.ini'), 'StylesPath = styles\nMinAlertLevel = suggestion\n[*]\nT.Very = YES\n');
	fs.writeFileSync(
		path.join(dir, 'styles', 'T', 'Very.yml'),
		'extends: existence\nmessage: "Avoid %s."\nlevel: error\naction:\n  name: remove\ntokens:\n  - very\n'
	);

	test('lint, lintText, and fix', async () => {
		fs.writeFileSync(path.join(dir, 'doc.md'), 'It is very hot.\n');
		const results = await vale.lint('doc.md', opts());
		assert.deepEqual(results['doc.md'].map((a) => a.Check), ['T.Very']);

		const [alert] = await vale.lintText('This is very good.', opts());
		assert.equal(alert.Match, 'very');
		assert.deepEqual(await vale.fix(alert, opts()), ['']);
	});

	test('fixFiles rewrites the file', async () => {
		fs.writeFileSync(path.join(dir, 'fixme.md'), 'It is very hot.\n');
		const [report] = await vale.fixFiles(['fixme.md'], opts());
		assert.equal(report.Applied, 1);
		assert.equal(fs.readFileSync(path.join(dir, 'fixme.md'), 'utf8'), 'It is hot.\n');
	});

	test('sync, config, and dirs', async () => {
		await vale.sync(opts());
		const cfg = await vale.config(opts());
		assert.ok(cfg.Checks.includes('T.Very'));
		assert.ok('StylesPath' in (await vale.dirs(opts())));
	});

	test('a missing config rejects with E100', async () => {
		await assert.rejects(vale.lint('doc.md', { ...opts(), config: path.join(dir, 'nope.ini') }), { code: 'E100' });
	});
});
