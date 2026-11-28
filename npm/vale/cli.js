#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const { binaryPath } = require('./index.js');

let bin;
try {
	bin = binaryPath();
} catch (err) {
	console.error(err.message);
	process.exit(2);
}

const result = spawnSync(bin, process.argv.slice(2), { stdio: 'inherit' });
if (result.error) {
	console.error(`Could not run ${bin}: ${result.error.message}`);
	process.exit(2);
}
if (result.signal) {
	process.kill(process.pid, result.signal);
}
process.exit(result.status ?? 2);
