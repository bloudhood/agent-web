#!/usr/bin/env node

const appLabels = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
};

const providers = {
  claude: [
    ['✓', 'claude-local', 'Claude Local', 'https://anthropic.example/v1'],
    ['', 'claude-alt', 'Claude Alt', 'https://alt-anthropic.example/v1'],
  ],
  codex: [
    ['✓', 'codex-local', 'Codex Local', 'https://openai.example/v1'],
    ['', 'codex-alt', 'Codex Alt', 'https://alt-openai.example/v1'],
  ],
  gemini: [
    ['✓', 'gemini-official', 'Google Official', 'https://generativelanguage.googleapis.com'],
    ['', 'gemini-alt', 'Gemini Alt', 'https://gemini-alt.example/v1'],
  ],
};

function argValue(args, name, fallback = '') {
  const idx = args.indexOf(name);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}

function selectedApp(args) {
  return argValue(args, '--app', argValue(args, '-a', 'claude'));
}

function printProviderList(app) {
  const rows = providers[app] || [];
  console.log('┌───┬─────────────────┬─────────────────┬───────────────────────────────────────────┐');
  console.log('│   ┆ ID              ┆ Name            ┆ API URL                                   │');
  console.log('╞═══╪═════════════════╪═════════════════╪═══════════════════════════════════════════╡');
  for (const [mark, id, name, apiUrl] of rows) {
    console.log(`│ ${mark.padEnd(1)} ┆ ${id.padEnd(15)} ┆ ${name.padEnd(15)} ┆ ${apiUrl.padEnd(41)} │`);
  }
  console.log('└───┴─────────────────┴─────────────────┴───────────────────────────────────────────┘');
  console.log(`ℹ Application: ${app}`);
  console.log(`→ Current: ${rows.find((row) => row[0] === '✓')?.[1] || ''}`);
}

function printEnvCheck(app) {
  console.log(`Checking Environment Variables for ${app}`);
  console.log('════════════════════════════════════════════════════════════');
  console.log('');
  console.log('✓ No environment variable conflicts detected');
  console.log(`Your ${app} configuration should work correctly.`);
}

function printTools() {
  console.log('Local CLI Tools');
  console.log('════════════════════════════════════════════════════════════');
  console.log('┌──────────┬───────────────────────────┐');
  console.log('│ Tool     ┆ Status                    │');
  console.log('╞══════════╪═══════════════════════════╡');
  console.log('│ Claude   ┆ ok (mock-claude)          │');
  console.log('├╌╌╌╌╌╌╌╌╌╌┼╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┤');
  console.log('│ Codex    ┆ ok (mock-codex)           │');
  console.log('├╌╌╌╌╌╌╌╌╌╌┼╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┤');
  console.log('│ Gemini   ┆ ok (mock-gemini)          │');
  console.log('└──────────┴───────────────────────────┘');
}

const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('cc-switch 5.3.4');
  process.exit(0);
}

const app = selectedApp(args);
if (!providers[app]) {
  console.error(`unsupported app: ${app}`);
  process.exit(2);
}

if (args.includes('provider') && args.includes('list')) {
  printProviderList(app);
  process.exit(0);
}

if (args.includes('provider') && args.includes('switch')) {
  const providerId = args[args.length - 1];
  const exists = providers[app].some((row) => row[1] === providerId);
  if (!exists) {
    console.error(`provider not found: ${providerId}`);
    process.exit(2);
  }
  console.log(`${appLabels[app]} switched to ${providerId}`);
  process.exit(0);
}

if (args.includes('env') && args.includes('check')) {
  printEnvCheck(app);
  process.exit(0);
}

if (args.includes('env') && args.includes('tools')) {
  printTools();
  process.exit(0);
}

console.error(`unsupported cc-switch mock args: ${args.join(' ')}`);
process.exit(2);
