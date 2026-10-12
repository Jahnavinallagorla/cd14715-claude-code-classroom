import * as dotenv from 'dotenv';
import { mkdir, writeFile } from 'node:fs/promises';
import { CodeReviewOrchestrator } from './orchestrator.js';
import { ReportGenerator } from './utils/report-generator.js';
import { formatError } from './utils/error-handler.js';

// Load environment variables
dotenv.config();

const USAGE = [
  'Usage: npm run dev -- <owner> <repo> <pr-number>',
  'Example: npm run dev -- udacity cd14715-simple-todo-app 1'
].join('\n');

/**
 * Print a friendly error message and stop. Never prints a stack trace.
 */
function fail(message: string): never {
  console.error(`\nError: ${message}`);
  process.exit(1);
}

/**
 * Main entry point for the Claude Multi-Agent Code Review System
 *
 * Usage:
 *   npm run dev -- <owner> <repo> <pr-number>
 */
async function main(): Promise<void> {
  const [owner, repo, prStr] = process.argv.slice(2);

  // 1. Command line arguments
  if (!owner || !repo || !prStr) {
    fail(`Missing arguments.\n${USAGE}`);
  }

  const prNumber = Number.parseInt(prStr, 10);
  if (!/^\d+$/.test(prStr) || !Number.isInteger(prNumber) || prNumber <= 0) {
    fail(`The PR number must be a positive integer, but got "${prStr}".\n${USAGE}`);
  }

  // 2. Authentication: Anthropic API key OR AWS Bedrock credentials
  const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasAwsCredentials = Boolean(
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
  );

  if (!hasAnthropicKey && !hasAwsCredentials) {
    fail(
      [
        'No authentication is configured. Use ONE of these options in your .env file:',
        '  1. Anthropic API:  ANTHROPIC_API_KEY=your-key',
        '  2. AWS Bedrock:    AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_REGION'
      ].join('\n')
    );
  }

  if (hasAwsCredentials && !hasAnthropicKey) {
    if (!process.env.AWS_REGION) {
      fail('AWS_REGION is required when using AWS Bedrock authentication.');
    }
    console.log('Using AWS Bedrock authentication');
  } else {
    console.log('Using Anthropic API authentication');
  }

  // 3. Model
  if (!process.env.ANTHROPIC_MODEL) {
    fail(
      [
        'ANTHROPIC_MODEL is not set. Add it to your .env file:',
        '  Anthropic API: ANTHROPIC_MODEL=claude-sonnet-4-5-20250929',
        '  AWS Bedrock:   ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0'
      ].join('\n')
    );
  }

  console.log(`Reviewing ${owner}/${repo} pull request #${prNumber}...`);

  try {
    // 4. Run the review
    const orchestrator = new CodeReviewOrchestrator();
    const report = await orchestrator.reviewPullRequest(owner, repo, prNumber);

    // 5. Generate the three report formats
    const generator = new ReportGenerator();
    const jsonReport = generator.generateJSONReport(report);
    const markdownReport = generator.generateMarkdownReport(report);
    const htmlReport = generator.generateHTMLReport(report);

    await mkdir('reports', { recursive: true });

    const baseName = `${owner}_${repo}_${prNumber}`;
    await writeFile(`reports/${baseName}.json`, jsonReport, 'utf-8');
    await writeFile(`reports/${baseName}.md`, markdownReport, 'utf-8');
    await writeFile(`reports/${baseName}.html`, htmlReport, 'utf-8');

    console.log('\nCode review completed successfully.');
    console.log('Reports saved to:');
    console.log(`  reports/${baseName}.json`);
    console.log(`  reports/${baseName}.md`);
    console.log(`  reports/${baseName}.html`);
    console.log(`\nOverall score: ${report.summary.overallScore}/100`);
    console.log(`Files reviewed: ${report.summary.totalFiles}`);
    console.log(`Critical issues: ${report.summary.criticalIssues}`);
  } catch (error) {
    fail(
      [
        formatError(error),
        '',
        'What to check:',
        '  - Your ANTHROPIC_API_KEY (and ANTHROPIC_BASE_URL if you use the Udacity key)',
        '  - That the pull request exists and the repository is public (or GITHUB_TOKEN is set)',
        '  - The details in logs/combined.log'
      ].join('\n')
    );
  }
}

main().catch((error) => {
  fail(formatError(error));
});