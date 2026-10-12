import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { codeQualityPrompt } from '../prompts/code-quality-analyzer.prompt.js';

export const codeQualityAnalyzer: AgentDefinition = {
  description:
    'Analyzes changed code for security vulnerabilities, performance problems, ' +
    'maintainability issues and bug risks. Use it for every changed source file in a pull request.',
  prompt: codeQualityPrompt,
  tools: ['Read', 'Grep', 'Glob', 'Skill', 'mcp__github__get_file_contents'],
  model: 'inherit',
};
