import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function introduce(number, message, run) {
  if (typeof number !== 'string' || !/^\+[1-9]\d{6,14}$/.test(number) ||
      typeof message !== 'string' || !message.trim()) {
    throw new Error('Expected an international phone number and a nonempty message.');
  }
  function readPolicy() {
    const config = JSON.parse(run('config', 'get', 'channels.whatsapp', '--json'));
    const entries = config.allowFrom ?? [];
    if (config.dmPolicy !== 'allowlist' || Object.keys(config.accounts ?? {}).length ||
        !Array.isArray(entries) || entries.some(entry => String(entry).includes('*'))) {
      throw new Error('Requires a single WhatsApp account with an explicit DM allowlist and no wildcard.');
    }
    if (![ 'open', 'disabled' ].includes(config.groupPolicy) &&
        !Array.isArray(config.groupAllowFrom)) {
      throw new Error('Set a separate WhatsApp group sender policy before extending DM access.');
    }
    return entries;
  }
  readPolicy();
  run('message', 'send', '--channel', 'whatsapp', '--target', number, '--message', message, '--json');
  try {
    const entries = readPolicy();
    if (!entries.includes(number)) {
      run('config', 'set', 'channels.whatsapp.allowFrom', JSON.stringify([...entries, number]));
    }
  } catch {
    throw new Error('Message sent, but reply access was not confirmed. Check the allowlist before retrying; do not resend blindly.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { number, message } = JSON.parse(readFileSync(0, 'utf8'));
    introduce(number, message, (...args) => {
      try {
        return execFileSync('/app/node_modules/.bin/openclaw', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      } catch {
        throw new Error('OpenClaw command failed. Check gateway status and message delivery before retrying.');
      }
    });
    console.log('Message sent; recipient added to the DM allowlist.');
  } catch (error) {
    console.error(error instanceof SyntaxError ? 'Expected valid JSON on stdin.' : error.message);
    process.exitCode = 1;
  }
}
