
import * as dotenv from 'dotenv';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { mcpServersConfig } from './config/mcp.config.js';

dotenv.config();

async function main(): Promise<void> {
  for await (const message of query({
    prompt:
      'Use the GitHub tools to get pull request #1 of udacity/cd14715-simple-todo-app ' +
      'and reply with its title in one sentence.',
    options: {
      model: process.env.ANTHROPIC_MODEL,
      mcpServers: mcpServersConfig,
      allowedTools: ['mcp__github__*'],
      maxTurns: 10,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true
    }
  })) {
    const raw = message as unknown as Record<string, unknown>;

    if (raw.type === 'system' && raw.subtype === 'init') {
      console.log('INIT mcp_servers:', JSON.stringify(raw.mcp_servers));
      const tools = (raw.tools as string[] | undefined) ?? [];
      console.log('INIT tool count:', tools.length, 'first tools:', tools.slice(0, 12).join(', '));
    } else if (raw.type === 'assistant') {
      const content =
        (raw.message as { content?: Array<{ type: string; name?: string; text?: string }> } | undefined)
          ?.content ?? [];
      for (const block of content) {
        if (block.type === 'tool_use') console.log('TOOL CALL:', block.name);
        if (block.type === 'text') console.log('TEXT:', (block.text ?? '').slice(0, 200));
      }
    } else if (raw.type === 'result') {
      console.log('RESULT:', raw.subtype, '| turns:', raw.num_turns, '|', String(raw.result ?? '').slice(0, 300));
    } else {
      console.log('MESSAGE:', raw.type, raw.subtype ?? '');
    }
  }
}

main().catch((error) => {
  console.error('FAILED:', error instanceof Error ? error.message : error);
});
