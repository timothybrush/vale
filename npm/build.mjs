#!/usr/bin/env node
// Builds the npm packages for one release from its archives:
//
//    node npm/build.mjs --version 3.29.0 --archives dist --out npm/out
//
// Each archive is checked against the release's checksums file and unpacked
// into its platform package; @vale-cli/vale then lists every platform package
// as an optional dependency at the same version. The package directories are
// printed in publish order, platforms first.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));

// Node's platform and arch, and the archive goreleaser names for each.
export const TARGETS = [
	{ os: 'darwin', cpu: 'arm64', archive: 'macOS_arm64.tar.gz' },
	{ os: 'darwin', cpu: 'x64', archive: 'macOS_64-bit.tar.gz' },
	{ os: 'linux', cpu: 'arm64', archive: 'Linux_arm64.tar.gz' },
	{ os: 'linux', cpu: 'x64', archive: 'Linux_64-bit.tar.gz' },
	{ os: 'win32', cpu: 'arm64', archive: 'Windows_arm64.zip' },
	{ os: 'win32', cpu: 'x64', archive: 'Windows_64-bit.zip' }
];

const shared = {
	license: 'MIT',
	homepage: 'https://vale.sh',
	repository: { type: 'git', url: 'git+https://github.com/vale-cli/vale.git', directory: 'npm' }
};

function checksums(file) {
	const sums = new Map();
	for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
		const [sum, name] = line.trim().split(/\s+/);
		if (sum && name) sums.set(name, sum);
	}
	return sums;
}

function write(file, data) {
	fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

export function build({ version, archives, out }) {
	if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
		throw new Error(`not a release version: ${version}`);
	}
	const sumsFile = path.join(archives, `vale_${version}_checksums.txt`);
	if (!fs.existsSync(sumsFile)) {
		throw new Error(`missing ${sumsFile}`);
	}
	const sums = checksums(sumsFile);
	const license = path.join(here, '..', 'LICENSE');

	fs.rmSync(out, { recursive: true, force: true });
	const dirs = [];
	const optional = {};

	for (const t of TARGETS) {
		const name = `@vale-cli/vale-${t.os}-${t.cpu}`;
		const archive = `vale_${version}_${t.archive}`;
		const src = path.join(archives, archive);
		const want = sums.get(archive);
		if (!want) {
			throw new Error(`${archive} is not in the checksums file`);
		}
		const got = createHash('sha256').update(fs.readFileSync(src)).digest('hex');
		if (got !== want) {
			throw new Error(`${archive}: checksum ${got} does not match ${want}`);
		}

		const dir = path.join(out, `vale-${t.os}-${t.cpu}`);
		fs.mkdirSync(dir, { recursive: true });
		const bin = t.os === 'win32' ? 'vale.exe' : 'vale';
		if (archive.endsWith('.zip')) {
			execFileSync('unzip', ['-q', '-o', src, bin, '-d', dir]);
		} else {
			execFileSync('tar', ['-xzf', src, '-C', dir, bin]);
		}
		fs.chmodSync(path.join(dir, bin), 0o755);
		fs.copyFileSync(license, path.join(dir, 'LICENSE'));
		fs.writeFileSync(
			path.join(dir, 'README.md'),
			`# ${name}\n\nThe Vale binary for ${t.os} on ${t.cpu}. Install [@vale-cli/vale](https://www.npmjs.com/package/@vale-cli/vale) instead; it picks this package for you.\n`
		);
		write(path.join(dir, 'package.json'), {
			name,
			version,
			description: `The Vale binary for ${t.os}-${t.cpu}.`,
			...shared,
			os: [t.os],
			cpu: [t.cpu],
			files: [bin],
			preferUnplugged: true
		});
		optional[name] = version;
		dirs.push(dir);
	}

	const main = path.join(out, 'vale');
	fs.mkdirSync(main, { recursive: true });
	const pkg = JSON.parse(fs.readFileSync(path.join(here, 'vale', 'package.json'), 'utf8'));
	for (const file of pkg.files.concat('README.md')) {
		fs.copyFileSync(path.join(here, 'vale', file), path.join(main, file));
	}
	fs.chmodSync(path.join(main, 'cli.js'), 0o755);
	fs.copyFileSync(license, path.join(main, 'LICENSE'));
	write(path.join(main, 'package.json'), { ...pkg, version, optionalDependencies: optional });
	dirs.push(main);
	return dirs;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const { values } = parseArgs({
		options: {
			version: { type: 'string' },
			archives: { type: 'string', default: 'dist' },
			out: { type: 'string', default: path.join(here, 'out') }
		}
	});
	if (!values.version) {
		console.error('usage: node npm/build.mjs --version X.Y.Z [--archives dist] [--out npm/out]');
		process.exit(2);
	}
	const version = values.version.replace(/^v/, '');
	for (const dir of build({ version, archives: values.archives, out: values.out })) {
		console.log(dir);
	}
}
