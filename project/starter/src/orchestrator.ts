import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { ReviewReportSchema, ReviewReportJSONSchema } from './types/index.js';
import type { ReviewReport } from './types/index.js';
import { mcpServersConfig } from './config/mcp.config.js';
import {
  codeQualityAnalyzer,
  testCoverageAnalyzer,
  refactoringSuggester
} from './agents/index.js';
import { buildOrchestratorPrompt } from './prompts/index.js';
import {
  RateLimiter,
  withRateLimit,
  withRetry,
  withTimeout,
  ReviewError,
  ErrorCodes,
  formatError
} from './utils/index.js';
import type { RateLimiterConfig } from './utils/rate-limiter.js';
import {
  logger,
  logReviewStart,
  logReviewComplete,
  logReviewError
} from './utils/logger.js';

export interface OrchestratorOptions {
  /** Model to use. Defaults to process.env.ANTHROPIC_MODEL */
  model?: string;
  /** Maximum agent turns for the whole review (default: 150) */
  maxTurns?: number;
  /** Timeout for one review attempt in milliseconds (default: 15 minutes) */
  timeoutMs?: number;
  /** Number of attempts before giving up (default: 3) */
  maxRetries?: number;
  /** Base delay between attempts in milliseconds (default: 2000) */
  retryDelayMs?: number;
  /** Custom rate limits */
  rateLimits?: Partial<RateLimiterConfig>;
  /** Estimated tokens for one review, used by the rate limiter */
  estimatedTokens?: number;
  /** Directory containing .claude/skills. Defaults to process.env.PROJECT_ROOT */
  projectRoot?: string;
}

/** Shape of the final message the SDK emits (kept loose to work across SDK versions) */
interface ResultMessage {
  type: 'result';
  subtype: string;
  structured_output?: unknown;
  result?: string;
  num_turns?: number;
  errors?: unknown;
}

/** Shape of an assistant message, used only to log which tools the agents call */
interface AssistantMessage {
  type: 'assistant';
  message?: {
    content?: Array<{
      type: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
  };
}

/** Shape of the system init message, used only to log MCP server status */
interface InitMessage {
  type: 'system';
  subtype: string;
  mcp_servers?: unknown;
  tools?: unknown;
}

const DEFAULT_MAX_TURNS = 150;
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;
const DEFAULT_ESTIMATED_TOKENS = 20000;

/**
 * Main Code Review Orchestrator
 * Coordinates subagents to analyze pull requests and generate comprehensive reports
 */
export class CodeReviewOrchestrator {
  private readonly model?: string;
  private readonly maxTurns: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly estimatedTokens: number;
  private readonly projectRoot: string;
  private readonly rateLimiter: RateLimiter;

  constructor(options: OrchestratorOptions = {}) {
    this.model = options.model;
    this.maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.estimatedTokens = options.estimatedTokens ?? DEFAULT_ESTIMATED_TOKENS;
    this.projectRoot = options.projectRoot ?? process.env.PROJECT_ROOT ?? process.cwd();
    this.rateLimiter = new RateLimiter(options.rateLimits);
  }

  /**
   * Review a pull request using parallel subagent analysis
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - Pull request number
   * @returns Complete review report
   */
  async reviewPullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport> {
    const startedAt = Date.now();
    logReviewStart(owner, repo, prNumber);

    try {
      const report = await withRetry(
        () =>
          withRateLimit(
            this.rateLimiter,
            () =>
              withTimeout(
                () => this.runReview(owner, repo, prNumber),
                this.timeoutMs,
                `Review of ${owner}/${repo}#${prNumber} timed out after ${this.timeoutMs} ms`
              ),
            this.estimatedTokens
          ),
        this.maxRetries,
        this.retryDelayMs
      );

      const duration = Date.now() - startedAt;
      const finalReport = this.finalizeReport(report, owner, repo, prNumber, duration);

      logReviewComplete(owner, repo, prNumber, finalReport.summary.overallScore, duration);
      return finalReport;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(formatError(error));
      logReviewError(owner, repo, prNumber, err);
      throw error;
    }
  }

  /**
   * One review attempt: start the orchestrator agent, let it spawn the
   * three subagents, and return the validated structured output.
   */
  private async runReview(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport> {
    const model = this.model ?? process.env.ANTHROPIC_MODEL;
    if (!model) {
      throw new ReviewError(
        'ANTHROPIC_MODEL is not set. Add it to your .env file.',
        ErrorCodes.INVALID_CONFIG
      );
    }

    const options: Options = {
      model,
      cwd: this.projectRoot,
      // Load .claude/skills from the project directory
      settingSources: ['project'],
      mcpServers: mcpServersConfig,
      // Subagent names must match the names used in the orchestrator prompt
      agents: {
        'code-quality-analyzer': codeQualityAnalyzer,
        'test-coverage-analyzer': testCoverageAnalyzer,
        'refactoring-suggester': refactoringSuggester
      },
      // Task spawns subagents; Skill lets agents use .claude/skills
      allowedTools: [
        'Task',
        'Skill',
        'Read',
        'Grep',
        'Glob',
        'mcp__github__*',
        'mcp__eslint__*'
      ],
      maxTurns: this.maxTurns,
      // No human is present, so do not wait for tool approvals
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      outputFormat: {
        type: 'json_schema',
        schema: ReviewReportJSONSchema
      }
    };

    logger.info('Starting orchestrator agent', { owner, repo, prNumber, model });

    let structuredOutput: unknown;
    let finalSubtype = 'none';

    for await (const message of query({
      prompt: buildOrchestratorPrompt(owner, repo, prNumber),
      options
    })) {
      const raw = message as unknown as Record<string, unknown>;
      logger.info('Agent message', { type: raw.type, subtype: raw.subtype });

      if (raw.type === 'system' && raw.subtype === 'init') {
        this.logInit(message as unknown as InitMessage);
        continue;
      }

      if (message.type === 'assistant') {
        this.logToolCalls(message as unknown as AssistantMessage);
        continue;
      }

      if (message.type !== 'result') {
        continue;
      }

      const result = message as unknown as ResultMessage;
      finalSubtype = result.subtype;
      logger.info('Agent result', {
        subtype: result.subtype,
        numTurns: result.num_turns,
        errors: result.errors
      });

      if (result.subtype === 'success') {
        structuredOutput = result.structured_output;
      }
    }

    if (finalSubtype !== 'success') {
      throw new ReviewError(
        `The review agent ended without a successful result (${finalSubtype}).`,
        ErrorCodes.AGENT_FAILED,
        { subtype: finalSubtype }
      );
    }

    const parsed = ReviewReportSchema.safeParse(structuredOutput);
    if (!parsed.success) {
      throw new ReviewError(
        'The review output did not match the ReviewReport schema.',
        ErrorCodes.STRUCTURED_OUTPUT_FAILED,
        { issues: parsed.error.issues }
      );
    }

    return parsed.data;
  }

  /**
   * Log which MCP servers connected and which tools the agent has, so a
   * failed GitHub or ESLint server shows up in logs/combined.log.
   */
  private logInit(message: InitMessage): void {
    logger.info('Agent init', {
      mcpServers: message.mcp_servers,
      tools: message.tools
    });
  }

  /**
   * Log every tool the agents call, so a failed run can be diagnosed from
   * logs/combined.log. For the Task tool this also shows which subagent ran.
   */
  private logToolCalls(message: AssistantMessage): void {
    const blocks = message.message?.content ?? [];

    for (const block of blocks) {
      if (block.type !== 'tool_use' || !block.name) {
        continue;
      }

      const subagent =
        block.name === 'Task' && typeof block.input?.subagent_type === 'string'
          ? block.input.subagent_type
          : undefined;

      logger.info('Agent tool call', { tool: block.name, subagent });
    }
  }

  /**
   * Replace values that code can compute reliably (summary, timing, PR info)
   * so they do not depend on the model's arithmetic.
   */
  private finalizeReport(
    report: ReviewReport,
    owner: string,
    repo: string,
    prNumber: number,
    duration: number
  ): ReviewReport {
    return {
      ...report,
      pullRequest: { owner, repo, number: prNumber },
      summary: this.buildSummary(report.fileReviews),
      metadata: {
        ...report.metadata,
        analyzedAt: new Date().toISOString(),
        duration
      }
    };
  }

  /**
   * Aggregate the per-file results into the report summary.
   */
  private buildSummary(fileReviews: ReviewReport['fileReviews']): ReviewReport['summary'] {
    const totalFiles = fileReviews.length;

    const scoreTotal = fileReviews.reduce(
      (sum, review) => sum + review.codeQuality.overallScore,
      0
    );
    const overallScore = totalFiles === 0 ? 0 : Math.round(scoreTotal / totalFiles);

    const criticalIssues = fileReviews.reduce(
      (sum, review) =>
        sum + review.codeQuality.issues.filter((issue) => issue.severity === 'critical').length,
      0
    );

    const highPriorityTests = fileReviews.reduce(
      (sum, review) =>
        sum +
        review.testCoverage.untestedPaths.filter(
          (path) => path.priority === 'critical' || path.priority === 'high'
        ).length,
      0
    );

    const refactoringOpportunities = fileReviews.reduce(
      (sum, review) => sum + review.refactorings.suggestions.length,
      0
    );

    return {
      totalFiles,
      overallScore,
      criticalIssues,
      highPriorityTests,
      refactoringOpportunities
    };
  }
}

export { CodeReviewOrchestrator as Orchestrator };