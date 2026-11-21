import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createHandoffStore, hasActiveHandoff, isLiveOwnerSend, rememberIntroducedPeer, registerHandoffTool } from './whatsapp-handoff.mjs';
import { patchWhatsApp } from './patch-whatsapp-handoff.mjs';

test('pinned plugin patch applies and parses', () => {
  const root = mkdtempSync(join(tmpdir(), 'wa-patch-'));
  try {
    mkdirSync(join(root, 'dist/.setup'), { recursive: true });
    for (const file of ['package.json', 'dist/.setup/monitor-DZZ6jtcL.mjs', 'dist/agent-tools-api.js']) {
      copyFileSync(join('node_modules/@openclaw/whatsapp', file), join(root, file));
    }
    patchWhatsApp(root);
    for (const file of ['dist/.setup/monitor-DZZ6jtcL.mjs', 'dist/agent-tools-api.js']) {
      execFileSync(process.execPath, ['--check', join(root, file)]);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('live contact stays silent until verified owner takes over; can revoke', async () => {
  const root = mkdtempSync(join(tmpdir(), 'wa-state-'));
  const peer = '+12025550123';
  const owner = '+12025550124';
  const now = Date.now();
  try {
    process.env.OPENCLAW_STATE_DIR = root;
    process.env.WHATSAPP_HANDOFF_ENABLED = '1';
    process.env.WHATSAPP_HANDOFF_OWNER = owner;
    const event = { id: 'ABCD0123456789EF', timestampMs: now, connectedAtMs: now - 1000 };
    assert.equal(isLiveOwnerSend({ ...event, id: '3EB00123456789EF' }), false);
    assert.equal(isLiveOwnerSend({ ...event, timestampMs: now - 90_000 }), false);
    rememberIntroducedPeer({ ...event, account: 'default', peer });
    assert.ok(createHandoffStore(join(root, 'whatsapp-handoff')).get('default', peer));
    assert.equal(hasActiveHandoff('default', peer), false);
    let factory;
    const hooks = {};
    const Type = new Proxy({}, { get: () => () => ({}) });
    registerHandoffTool({ registerTool: fn => { factory = fn; }, on: (name, fn) => { hooks[name] = fn; } }, Type);
    const ctx = { senderIsOwner: true, messageChannel: 'whatsapp', requesterSenderId: owner, config: { session: { dmScope: 'per-channel-peer' } } };
    assert.equal(factory({ ...ctx, requesterSenderId: peer }), null);
    const tool = factory(ctx);
    await assert.rejects(tool.execute('test', { number: '+12025550125', action: 'start', goal: 'Ask for a table' }), /No recent/);
    await tool.execute('test', { number: peer, action: 'start', goal: 'Ask for a table' });
    assert.equal(hasActiveHandoff('default', peer), true);
    assert.equal(hasActiveHandoff('other', peer), false);
    assert.equal(hooks.before_tool_call({}, { requester: { channel: 'whatsapp', senderId: peer } }).block, true);
    assert.match(hooks.before_prompt_build({}, { channel: 'whatsapp', senderId: peer }).prependSystemContext, /Ask for a table/);
    await tool.execute('test', { number: peer, action: 'stop' });
    assert.equal(hasActiveHandoff('default', peer), false);
  } finally {
    for (const key of ['OPENCLAW_STATE_DIR', 'WHATSAPP_HANDOFF_ENABLED', 'WHATSAPP_HANDOFF_OWNER']) delete process.env[key];
    rmSync(root, { recursive: true, force: true });
  }
});
