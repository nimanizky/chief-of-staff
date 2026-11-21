import { test } from 'node:test';
import assert from 'node:assert/strict';
import { introduce } from './whatsapp-introduce.mjs';

const number = '+12025550123';
const policy = { dmPolicy: 'allowlist', groupPolicy: 'disabled', allowFrom: [] };

test('allows only the explicitly contacted recipient after successful send', () => {
  const calls = [];
  introduce(number, 'Hello', (...args) => {
    calls.push(args);
    if (args[0] === 'config' && args[1] === 'get') {
      return JSON.stringify({ ...policy, allowFrom: ['+12025550124'] });
    }
  });
  assert.deepEqual(calls.map(args => args.slice(0, 2)), [
    ['config', 'get'], ['message', 'send'], ['config', 'get'], ['config', 'set'],
  ]);
  assert.deepEqual(JSON.parse(calls[3][3]), ['+12025550124', number]);
});

test('does not grant access when send fails', () => {
  assert.throws(() => introduce(number, 'Hello', (...args) => {
    assert.notEqual(args[1], 'set');
    if (args[0] === 'message') throw new Error('send failed');
    return JSON.stringify(policy);
  }), /send failed/);
});

test('rejects wildcard and group sender fallback before sending', () => {
  for (const unsafe of [{ ...policy, allowFrom: ['*'] }, { ...policy, groupPolicy: 'allowlist' }]) {
    assert.throws(() => introduce(number, 'Hello', (...args) => {
      assert.equal(args[1], 'get');
      return JSON.stringify(unsafe);
    }), /allowlist|group sender policy/);
  }
});
