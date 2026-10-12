import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import { refactoringPrompt } from '../prompts/refactoring-suggester.prompt.js';

export const refactoringSuggester: AgentDefinition = {
  description:
    'Identifies refactoring opportunities in changed code: extract-function candidates, ' +
    'modernization, simplification and design-pattern improvements, with before/after examples.',
  prompt: refactoringPrompt,
  tools: ['Read', 'Grep', 'Glob', 'Skill', 'mcp__github__get_file_contents'],
  model: 'inherit',
};
