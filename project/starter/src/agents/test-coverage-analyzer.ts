import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { testCoveragePrompt } from '../prompts/test-coverage-analyzer.prompt.js';

export const testCoverageAnalyzer: AgentDefinition = {
  description:
    'Evaluates test coverage of changed code by comparing source files with their tests, ' +
    'finds untested functions, branches and edge cases, and suggests specific tests.',
  prompt: testCoveragePrompt,
  tools: ['Read', 'Grep', 'Glob', 'Skill', 'mcp__github__get_file_contents'],
  model: 'inherit',
};
