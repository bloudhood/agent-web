#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoDir = path.resolve(__dirname, '..');
const SOURCE_DIRS = ['server.js', 'lib', 'src', path.join('web', 'src')];
const SOURCE_EXTENSIONS = new Set(['.js', '.ts', '.svelte']);
const DEFAULT_AGENT_BRANCH_ALLOWED_PATHS = [
  'server.js',
  'lib/agent-manager.js',
  'lib/agent-runtime.js',
  'lib/config-manager.js',
  'lib/notify.js',
  'lib/routes.js',
  'lib/session-store.js',
  'src/adapters/',
  'src/application/chat-orchestrator.ts',
  'src/core/session/session.ts',
  'web/src/lib/ws-bridge.ts',
];
const FILE_SIZE_BUDGETS = {
  'server.js': 500,
  'lib/config-manager.js': 1680,
  'lib/routes.js': 1400,
  'lib/agent-manager.js': 1240,
  'lib/session-store.js': 1110,
  'lib/agent-runtime.js': 880,
  'lib/notify.js': 430,
  'web/src/lib/ws-bridge.ts': 370,
  'web/src/app/MainLayout.svelte': 230,
  'web/src/features/settings/CcSwitchPanel.svelte': 240,
  'web/src/features/sidebar/ImportSessionsDialog.svelte': 240,
  'web/src/features/sidebar/Sidebar.svelte': 220,
};
const AGENT_BRANCH_PATTERN = /\b(?:agent|session\.agent|entry\.agent|m\.agent)\s*={2,3}\s*['"`](?:claude|codex|gemini|hermes)['"`]|\bis(?:Claude|Codex|Gemini|Hermes)Session\s*\(/;

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

function normalizeRelativePath(relativePath) {
  return String(relativePath || '').replace(/\\/g, '/');
}

function lineCount(text) {
  const normalized = String(text || '');
  if (!normalized) return 0;
  const withoutTrailingNewline = normalized.replace(/\r?\n$/, '');
  return withoutTrailingNewline ? withoutTrailingNewline.split(/\r?\n/).length : 0;
}

function pathAllowed(relativePath, allowedPaths) {
  const normalizedPath = normalizeRelativePath(relativePath);
  return allowedPaths.some((allowedPath) => {
    const normalizedAllowed = normalizeRelativePath(allowedPath);
    if (normalizedAllowed.endsWith('/')) return normalizedPath.startsWith(normalizedAllowed);
    return normalizedPath === normalizedAllowed;
  });
}

function listSourceFiles(entries = SOURCE_DIRS) {
  const results = [];

  function walk(relativePath) {
    const absolutePath = path.join(repoDir, relativePath);
    if (!fs.existsSync(absolutePath)) return;
    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(absolutePath)) {
        walk(path.join(relativePath, child));
      }
      return;
    }
    if (SOURCE_EXTENSIONS.has(path.extname(absolutePath))) {
      results.push({
        relativePath: normalizeRelativePath(relativePath),
        text: fs.readFileSync(absolutePath, 'utf8'),
      });
    }
  }

  for (const entry of entries) walk(entry);
  return results;
}

function findForbiddenAgentBranches(files, allowedPaths = DEFAULT_AGENT_BRANCH_ALLOWED_PATHS) {
  const violations = [];
  for (const file of files) {
    if (pathAllowed(file.relativePath, allowedPaths)) continue;
    const lines = String(file.text || '').split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!AGENT_BRANCH_PATTERN.test(line)) return;
      violations.push({
        relativePath: normalizeRelativePath(file.relativePath),
        line: index + 1,
        text: line.trim(),
      });
    });
  }
  return violations;
}

function findFileBudgetViolations(files, budgets = FILE_SIZE_BUDGETS) {
  const violations = [];
  const normalizedBudgets = Object.fromEntries(
    Object.entries(budgets).map(([relativePath, maxLines]) => [normalizeRelativePath(relativePath), maxLines]),
  );
  for (const file of files) {
    const relativePath = normalizeRelativePath(file.relativePath);
    const maxLines = normalizedBudgets[relativePath];
    if (!maxLines) continue;
    const lines = lineCount(file.text);
    if (lines > maxLines) {
      violations.push({ relativePath, lines, maxLines });
    }
  }
  return violations;
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

  const sourceFiles = listSourceFiles();
  const agentBranchViolations = findForbiddenAgentBranches(sourceFiles);
  assert(
    agentBranchViolations.length === 0,
    `agent-specific branches must stay inside approved boundaries:\n${agentBranchViolations.map((violation) => `  ${violation.relativePath}:${violation.line} ${violation.text}`).join('\n')}`,
  );
  const fileBudgetViolations = findFileBudgetViolations(sourceFiles);
  assert(
    fileBudgetViolations.length === 0,
    `core files exceeded maintainability budget:\n${fileBudgetViolations.map((violation) => `  ${violation.relativePath}: ${violation.lines}/${violation.maxLines} lines`).join('\n')}`,
  );

  console.log('Project audit passed.');
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_AGENT_BRANCH_ALLOWED_PATHS,
  FILE_SIZE_BUDGETS,
  findFileBudgetViolations,
  findForbiddenAgentBranches,
  lineCount,
  listSourceFiles,
};
