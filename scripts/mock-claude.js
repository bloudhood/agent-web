#!/usr/bin/env node

const crypto = require('crypto');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
  });
}

(async function main() {
  const args = process.argv.slice(2);
  if (args.join(' ') === '--help') {
    process.stdout.write(`Usage: claude [options] [command] [prompt]

Commands:
  agents [options]          Manage background and configured agents
  auth                      Manage authentication
  doctor                    Check the health of your Claude Code auto-updater
  mcp                       Configure and manage MCP servers
  plugin|plugins            Manage Claude Code plugins
  setup-token               Set up a long-lived authentication token
  update|upgrade            Check for updates and install if available

Options:
  -h, --help                Display help for command
`);
    return;
  }
  if (args.join(' ') === 'mcp --help') {
    process.stdout.write(`Usage: claude mcp [options] [command]

Commands:
  add [options] <name> <commandOrUrl> [args...]  Add an MCP server to Claude Code.
  get <name>                                     Get details about an MCP server.
  list                                           List configured MCP servers.
  remove [options] <name>                        Remove an MCP server

Options:
  -h, --help                                     Display help for command
`);
    return;
  }
  if (args.join(' ') === 'mcp add --help') {
    process.stdout.write(`Usage: claude mcp add [options] <name> <commandOrUrl> [args...]

Options:
  --transport <transport>  Transport type
  -e, --env <env...>       Environment variables
  -h, --help               Display help for command
`);
    return;
  }
  if (args[0] !== '-p') {
    process.stdout.write(`Claude native start ${args.join(' ')}\n`);
    await sleep(120);
    process.stdout.write(`Claude native end ${args.join(' ')}\n`);
    return;
  }
  const resumeIndex = args.indexOf('--resume');
  const inputFormatIndex = args.indexOf('--input-format');
  const sessionId = resumeIndex >= 0 && args[resumeIndex + 1]
    ? args[resumeIndex + 1]
    : crypto.randomUUID();

  const input = (await readStdin()).trim();
  const usesStreamJson = inputFormatIndex >= 0 && args[inputFormatIndex + 1] === 'stream-json';

  process.stdout.write(`${JSON.stringify({ type: 'system', session_id: sessionId })}\n`);

  let text = '';
  if (usesStreamJson) {
    let payload = null;
    try { payload = JSON.parse(input.split('\n').find(Boolean) || '{}'); } catch {}
    const blocks = payload?.message?.content || [];
    const imageCount = blocks.filter((block) => block.type === 'image').length;
    const promptText = blocks.filter((block) => block.type === 'text').map((block) => block.text || '').join(' ').trim();
    text = `Claude mock handled stream-json (${imageCount} image): ${promptText || '[no text]'}`;
  } else if (input === '/compact') {
    text = 'Claude compact finished.';
  } else {
    text = `Claude mock handled: ${input}`;
  }

  process.stdout.write(`${JSON.stringify({
    type: 'assistant',
    session_id: sessionId,
    message: { content: [{ type: 'text', text }] },
  })}\n`);

  process.stdout.write(`${JSON.stringify({
    type: 'result',
    session_id: sessionId,
    total_cost_usd: 0,
  })}\n`);
})();
