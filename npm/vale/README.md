# @vale-cli/vale

[Vale](https://vale.sh), the prose linter, packaged for npm. Installing it gets
the prebuilt Vale binary for your platform from the npm registry: no install
script and no download from GitHub, so it works with `--ignore-scripts`, with
`pnpm` at its default settings, and through registry mirrors. The package version matches the Vale
release it ships.

```sh
npm install --save-dev @vale-cli/vale
npx vale sync
npx vale docs/
```

Prebuilt binaries cover macOS, Linux, and Windows, each on x64 and arm64.

## From JavaScript

```js
import { lint, lintText } from '@vale-cli/vale';

// Alerts by path, using the .vale.ini that Vale finds from `cwd`.
const results = await lint(['docs/'], { cwd: process.cwd() });

// A string, linted as Markdown.
const alerts = await lintText('This is very good.', { ext: '.md' });
```

Both take `cwd`, `config`, `minAlertLevel`, `filter`, and `args` (any other
Vale flags). They resolve whether or not Vale found errors.

The rest of the CLI is there too:

```js
import { sync, fix, fixFiles, config, dirs } from '@vale-cli/vale';

await sync({ ifNeeded: true });           // vale sync --if-needed
const replacements = await fix(alert);    // what an alert's action offers
const reports = await fixFiles(['docs/']); // write the unambiguous fixes
const resolved = await config();          // vale ls-config
const defaults = await dirs();            // vale ls-dirs
```

Every call takes `cwd`, `config`, `args`, and `env`. A runtime error, such as a
missing config file, rejects with a `ValeError` whose `code` is Vale's (`E100`,
`E201`).

`binaryPath()` returns the path to the binary. Set `VALE_BINARY`, in the
environment or in a call's `env`, to use a different one.
