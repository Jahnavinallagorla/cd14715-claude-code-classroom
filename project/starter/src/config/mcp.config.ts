/**
 * MCP server configuration for the code review system.
 *
 * - github: pull request and repository data (needs GITHUB_TOKEN for private
 *   repos or higher rate limits; mapped to the variable the server expects)
 * - eslint: linting and style analysis (no authentication required)
 *
 * On Windows, npm's launcher is called npx.cmd, so the command is chosen by
 * platform. On macOS and Linux it is plain npx.
 */
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

export const mcpServersConfig = {
  github: {
    type: 'stdio' as const,
    command: npxCommand,
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: {
      GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN || ''
    }
  },
  eslint: {
    type: 'stdio' as const,
    command: npxCommand,
    args: ['-y', '@eslint/mcp@latest'],
    env: {}
  }
};