import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { spawnSync } from 'node:child_process';
import { productionConfig, productionSecrets } from './production-config.mjs';

const repo = process.argv[2];
if (!repo || !/^[-\w.]+\/[-\w.]+$/.test(repo))
  throw new Error('Usage: node scripts/configure-github.mjs OWNER/REPO [--dry-run]');
try {
  const input = {
    ...parseEnv(readFileSync('.dev.vars', 'utf8')),
    ...parseEnv(readFileSync('.env.production.local', 'utf8')),
  };
  if (!input.CLOUDFLARE_API_TOKEN) throw new Error('Fill CLOUDFLARE_API_TOKEN in .dev.vars first.');
  const config = productionConfig(input);
  const secrets = { ...productionSecrets(input), CLOUDFLARE_API_TOKEN: input.CLOUDFLARE_API_TOKEN };
  const variables = {
    ...config.vars,
    CLOUDFLARE_ACCOUNT_ID: config.account_id,
    D1_DATABASE_ID: config.d1_databases[0].database_id,
    D1_DATABASE_NAME: config.d1_databases[0].database_name,
  };
  if (process.argv.includes('--dry-run'))
    console.log(
      JSON.stringify({
        repository: repo,
        variables: Object.keys(variables),
        secrets: Object.keys(secrets),
      }),
    );
  else {
    const check = spawnSync('gh', ['repo', 'view', repo, '--json', 'nameWithOwner'], {
      encoding: 'utf8',
    });
    if (check.status !== 0)
      throw new Error(
        'GitHub repository is unavailable. Complete gh auth login and create/check the repository first.',
      );
    for (const [kind, values] of [
      ['secret', secrets],
      ['variable', variables],
    ])
      for (const [name, value] of Object.entries(values)) {
        // Values go through stdin, never command arguments or terminal output.
        const result = spawnSync('gh', [kind, 'set', name, '--repo', repo], {
          input: String(value),
          encoding: 'utf8',
        });
        if (result.status !== 0)
          throw new Error(
            'Failed to configure ' + kind + ' ' + name + '. Check GitHub repository permissions.',
          );
        console.log('Configured ' + kind + ': ' + name);
      }
    console.log('GitHub deployment settings configured for ' + repo + '.');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
