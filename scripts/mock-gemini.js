#!/usr/bin/env node

const crypto = require('crypto');

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
  const resumeIndex = args.indexOf('--resume');
  const modelIndex = args.indexOf('--model');
  const sessionId = resumeIndex >= 0 && args[resumeIndex + 1]
    ? args[resumeIndex + 1]
    : `gemini-${crypto.randomUUID()}`;
  const model = modelIndex >= 0 && args[modelIndex + 1] ? args[modelIndex + 1] : 'gemini-default';
  const input = (await readStdin()).trim();

  process.stderr.write('Warning: 256-color support not detected. Using a terminal with at least 256-color support is recommended for a better visual experience.\n');
  if (args.includes('--approval-mode') && args[args.indexOf('--approval-mode') + 1] === 'yolo') {
    process.stderr.write('YOLO mode is enabled. All tool calls will be automatically approved.\n');
  }

  process.stdout.write(`${JSON.stringify({ type: 'init', session_id: sessionId, model })}\n`);

  if (input === 'gemini fail filtered stderr') {
    process.exit(2);
  }

  if (/tool/i.test(input)) {
    process.stdout.write(`${JSON.stringify({
      type: 'tool_use',
      id: 'gemini_tool_regression',
      name: 'run_shell_command',
      input: { command: 'echo gemini' },
    })}\n`);
    process.stdout.write(`${JSON.stringify({
      type: 'tool_result',
      tool_id: 'gemini_tool_regression',
      output: 'gemini tool output',
      status: 'success',
    })}\n`);
  }

  process.stdout.write(`${JSON.stringify({
    type: 'message',
    role: 'assistant',
    content: `Gemini mock handled: ${input}`,
  })}\n`);
  process.stdout.write(`${JSON.stringify({
    type: 'result',
    status: 'success',
    stats: { input_tokens: 12, cached: 3, output_tokens: 6 },
  })}\n`);
})();
