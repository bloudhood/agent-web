#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoDir = path.resolve(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(repoDir, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(repoDir, relativePath));
}

function main() {
  const packageJson = JSON.parse(readText('package.json'));
  const commands = JSON.parse(readText('shared/commands.json'));
  const readmeZh = readText('README.md');
  const readmeEn = readText('README.en.md');
  const envExample = readText('.env.example');
  const gitignore = readText('.gitignore');
  const architecture = readText('docs/ARCHITECTURE.md');

  assert(packageJson.private === false, 'package.json should be publishable/open-source friendly');
  assert(packageJson.license === 'MIT', 'package.json license should match LICENSE');
  assert(fileExists('LICENSE'), 'LICENSE should exist');
  assert(fileExists('SECURITY.md'), 'SECURITY.md should exist');
  assert(fileExists('CONTRIBUTING.md'), 'CONTRIBUTING.md should exist');
  assert(fileExists('.github/workflows/ci.yml'), 'CI workflow should exist');

  assert(/HOST=0\.0\.0\.0/.test(envExample), '.env.example should document the bind host');
  assert(/\/api\/health/.test(readmeZh) && /\/api\/health/.test(readmeEn), 'README files should document /api/health');
  assert(/Runtime Contracts/.test(architecture), 'architecture doc should describe runtime contracts');
  assert(/Slash Commands/.test(architecture), 'architecture doc should describe slash command ownership');

  for (const ignored of ['node_modules/', 'sessions/', 'logs/', 'attachments/', 'config/', '.claude/', '.codex/', '.env']) {
    assert(gitignore.includes(ignored), `.gitignore should ignore ${ignored}`);
  }

  const seen = new Set();
  for (const command of commands) {
    assert(typeof command.cmd === 'string' && command.cmd.startsWith('/'), `invalid command cmd: ${JSON.stringify(command)}`);
    assert(typeof command.desc === 'string' && command.desc.trim(), `missing command desc for ${command.cmd}`);
    assert(command.kind === 'web' || command.kind === 'native', `invalid command kind for ${command.cmd}`);
    assert(Array.isArray(command.agents) && command.agents.length > 0, `missing agents for ${command.cmd}`);
    assert(!seen.has(command.cmd), `duplicate command ${command.cmd}`);
    seen.add(command.cmd);
  }

  for (const required of ['/help', '/status', '/usage', '/mcp', '/login']) {
    assert(seen.has(required), `command manifest should include ${required}`);
  }

  console.log('Project audit passed.');
}

main();
