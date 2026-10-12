const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

export function getMcpServersConfig() {
  const githubToken = process.env.GITHUB_TOKEN!;
  if (!githubToken) {
    throw new Error(
      'GITHUB_TOKEN is not set. Add GITHUB_TOKEN=ghp_your-token-here to your .env file.'
    );
  }

  return {
    github: {
      type: 'stdio' as const,
      command: npxCommand,
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: {
        GITHUB_PERSONAL_ACCESS_TOKEN: githubToken
      }
    },
    eslint: {
      type: 'stdio' as const,
      command: npxCommand,
      args: ['-y', '@eslint/mcp@latest'],
      env: {}
    }
  };
}
