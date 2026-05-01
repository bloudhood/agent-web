import { describe, expect, it } from 'vitest';

const audit = require('../../../scripts/audit-project.js');

describe('project audit maintainability guardrails', () => {
  it('flags hard-coded agent branches outside approved boundaries', () => {
    const violations = audit.findForbiddenAgentBranches([
      {
        relativePath: 'web/src/features/new-panel.ts',
        text: "if (agent === 'codex') return 'x';\n",
      },
    ], ['src/adapters/']);

    expect(violations).toEqual([
      expect.objectContaining({
        relativePath: 'web/src/features/new-panel.ts',
        line: 1,
      }),
    ]);
  });

  it('allows agent branches inside approved adapter boundaries', () => {
    const violations = audit.findForbiddenAgentBranches([
      {
        relativePath: 'src/adapters/codex/index.ts',
        text: "if (agent === 'codex') return 'x';\n",
      },
    ], ['src/adapters/']);

    expect(violations).toEqual([]);
  });

  it('flags core files that grow past their line budget', () => {
    const violations = audit.findFileBudgetViolations([
      {
        relativePath: 'lib/routes.js',
        text: ['a', 'b', 'c', 'd'].join('\n'),
      },
    ], { 'lib/routes.js': 3 });

    expect(violations).toEqual([
      expect.objectContaining({
        relativePath: 'lib/routes.js',
        maxLines: 3,
        lines: 4,
      }),
    ]);
  });
});
