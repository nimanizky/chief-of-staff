import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function patchWhatsApp(root) {
  const packageFile = join(root, 'package.json');
  if (JSON.parse(readFileSync(packageFile, 'utf8')).version !== '2026.11.6') {
    throw new Error('WhatsApp handoff patch requires @openclaw/whatsapp 2026.11.6.');
  }
  const monitor = join(root, 'dist/.setup/monitor-DZZ6jtcL.mjs');
  const tools = join(root, 'dist/agent-tools-api.js');
  const manifests = ['openclaw.plugin.json', 'dist/openclaw.plugin.json'].map(relative => {
    const file = join(root, relative);
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    if (manifest.id !== 'whatsapp' || !Array.isArray(manifest.contracts?.tools)) {
      throw new Error('Unexpected WhatsApp plugin manifest.');
    }
    manifest.contracts.tools = [...new Set([...manifest.contracts.tools, 'whatsapp_handoff'])];
    return { file, manifest };
  });
  function replaceExactly(source, oldText, newText) {
    if (source.split(oldText).length !== 2) throw new Error('WhatsApp handoff patch anchor mismatch.');
    return source.replace(oldText, () => newText);
  }
  let monitorSource = readFileSync(monitor, 'utf8');
  monitorSource = replaceExactly(monitorSource, 'const ingressAccess = await resolveChannelIngress();', `if (!group && isFromMe && !policy.isSamePhone(from) && policy.dmPolicy === "allowlist" &&
          typeof remoteJid === "string" && /@(s\\.whatsapp\\.net|lid)$/.test(remoteJid)) {
        rememberIntroducedPeer({ account: options.accountId, peer: from, id, timestampMs: messageTimestampMs, connectedAtMs });
      }
      const ingressAccess = await resolveChannelIngress();`);
  monitorSource = replaceExactly(monitorSource, ' : params.policy.dmAllowFrom,\n\t\tgroupAllowFrom:', ` : (
        !params.includeCommand && !params.isGroup && params.policy.dmPolicy === "allowlist" &&
        ["per-channel-peer", "per-account-channel-peer"].includes(params.cfg.session?.dmScope) &&
        hasActiveHandoff(params.policy.account.accountId, params.senderId) ?
        [...params.policy.dmAllowFrom, params.senderId] : params.policy.dmAllowFrom),
        groupAllowFrom:`);
  const toolsSource = replaceExactly(readFileSync(tools, 'utf8'), 'registerWhatsAppCallTool(api);\n\tregisterWhatsAppLoginTool(api);', 'registerWhatsAppCallTool(api);\n\tregisterWhatsAppLoginTool(api);\n\tregisterHandoffTool(api, Type, sendMessageWhatsApp);');
  writeFileSync(monitor, 'import { rememberIntroducedPeer, hasActiveHandoff } from "/app/whatsapp-handoff.mjs";\n' + monitorSource);
  writeFileSync(tools, 'import { registerHandoffTool } from "/app/whatsapp-handoff.mjs";\nimport { sendMessageWhatsApp } from "./runtime-api.js";\n' + toolsSource);
  for (const { file, manifest } of manifests) writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  patchWhatsApp('node_modules/@openclaw/whatsapp');
}
