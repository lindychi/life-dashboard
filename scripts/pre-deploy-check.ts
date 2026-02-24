#!/usr/bin/env tsx

import { execFileSync } from 'child_process';
import { performance } from 'perf_hooks';

interface CheckResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

interface CheckOptions {
  skipBuild?: boolean;
  skipTests?: boolean;
  continueOnFailure?: boolean;
}

function parseArgs(): CheckOptions {
  const args = process.argv.slice(2);
  return {
    skipBuild: args.includes('--skip-build'),
    skipTests: args.includes('--skip-tests'),
    continueOnFailure: args.includes('--continue'),
  };
}

function printHeader() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║       🚀 Pre-Deploy Validation        ║');
  console.log('╚════════════════════════════════════════╝\n');
}

function printCheckHeader(index: number, total: number, name: string) {
  console.log(`[${index}/${total}] ${name}`);
}

function printCheckResult(passed: boolean, duration: number) {
  const status = passed ? '✅ PASSED' : '❌ FAILED';
  console.log(`      ${status} (${duration.toFixed(1)}s)\n`);
}

function runCommand(command: string, args: string[], description: string): CheckResult {
  const startTime = performance.now();

  try {
    console.log(`      Running: ${command} ${args.join(' ')}`);

    execFileSync(command, args, {
      stdio: 'inherit',
      encoding: 'utf8',
    });

    const duration = (performance.now() - startTime) / 1000;
    return { name: description, passed: true, duration };
  } catch (error) {
    const duration = (performance.now() - startTime) / 1000;
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { name: description, passed: false, duration, error: errorMessage };
  }
}

async function runMcpHealthCheck(): Promise<CheckResult> {
  const startTime = performance.now();

  try {
    // Try to import the health check module
    const { runHealthChecks } = await import('./mcp-healthcheck');

    const report = await runHealthChecks({ offline: true });
    const allPassed = report.failed === 0;
    const totalChecks = report.passed + report.failed;

    const duration = (performance.now() - startTime) / 1000;

    if (allPassed) {
      console.log(`      ✅ PASSED — ${report.passed}/${totalChecks} checks passed`);
    } else {
      console.log(`      ❌ FAILED — ${report.passed}/${totalChecks} checks passed`);
      report.results.filter(r => !r.passed).forEach(r => {
        const detail = r.detail ? ` — ${r.detail}` : '';
        console.log(`         - ${r.name}${detail}`);
      });
    }

    return {
      name: 'MCP Health Check',
      passed: allPassed,
      duration,
      error: allPassed ? undefined : `${report.failed} checks failed`,
    };
  } catch (error) {
    const duration = (performance.now() - startTime) / 1000;

    // Gracefully handle missing health check script
    if (error instanceof Error && error.message.includes('Cannot find module')) {
      console.log('      ⚠️  SKIPPED — mcp-healthcheck.ts not found');
      return { name: 'MCP Health Check', passed: true, duration };
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      name: 'MCP Health Check',
      passed: false,
      duration,
      error: errorMessage,
    };
  }
}

async function main() {
  const options = parseArgs();
  const results: CheckResult[] = [];
  const startTime = performance.now();

  printHeader();

  // Build check list
  const checks = [
    { name: 'TypeScript Check', skip: false },
    { name: 'Lint Check', skip: false },
    { name: 'Test Check', skip: options.skipTests },
    { name: 'MCP Health Check', skip: false },
    { name: 'Build Check', skip: options.skipBuild },
  ];

  const activeChecks = checks.filter(c => !c.skip);
  const totalChecks = activeChecks.length;
  let currentCheck = 0;

  // 1. TypeScript Check
  if (!checks[0].skip) {
    currentCheck++;
    printCheckHeader(currentCheck, totalChecks, 'TypeScript Check');
    const result = runCommand('npx', ['tsc', '--noEmit'], 'TypeScript Check');
    printCheckResult(result.passed, result.duration);
    results.push(result);

    if (!result.passed && !options.continueOnFailure) {
      printFailureSummary(results, startTime);
      process.exit(1);
    }
  }

  // 2. Lint Check
  if (!checks[1].skip) {
    currentCheck++;
    printCheckHeader(currentCheck, totalChecks, 'Lint Check');
    const result = runCommand('pnpm', ['lint'], 'Lint Check');
    printCheckResult(result.passed, result.duration);
    results.push(result);

    if (!result.passed && !options.continueOnFailure) {
      printFailureSummary(results, startTime);
      process.exit(1);
    }
  }

  // 3. Test Check
  if (!checks[2].skip) {
    currentCheck++;
    printCheckHeader(currentCheck, totalChecks, 'Test Check');
    const result = runCommand('pnpm', ['test'], 'Test Check');
    printCheckResult(result.passed, result.duration);
    results.push(result);

    if (!result.passed && !options.continueOnFailure) {
      printFailureSummary(results, startTime);
      process.exit(1);
    }
  }

  // 4. MCP Health Check
  if (!checks[3].skip) {
    currentCheck++;
    printCheckHeader(currentCheck, totalChecks, 'MCP Health Check');
    const result = await runMcpHealthCheck();
    if (result.passed && !result.error?.includes('SKIPPED')) {
      printCheckResult(result.passed, result.duration);
    }
    results.push(result);

    if (!result.passed && !options.continueOnFailure) {
      printFailureSummary(results, startTime);
      process.exit(1);
    }
  }

  // 5. Build Check
  if (!checks[4].skip) {
    currentCheck++;
    printCheckHeader(currentCheck, totalChecks, 'Build Check');
    const result = runCommand('pnpm', ['build'], 'Build Check');
    printCheckResult(result.passed, result.duration);
    results.push(result);

    if (!result.passed && !options.continueOnFailure) {
      printFailureSummary(results, startTime);
      process.exit(1);
    }
  }

  // Print success summary
  printSuccessSummary(results, startTime);
  process.exit(0);
}

function printSuccessSummary(results: CheckResult[], startTime: number) {
  const totalDuration = (performance.now() - startTime) / 1000;
  const passedCount = results.filter(r => r.passed).length;

  console.log('─────────────────────────────');
  console.log(`✅ All ${passedCount} checks passed (${totalDuration.toFixed(1)}s total)`);
  console.log('Ready to deploy! 🎉\n');
}

function printFailureSummary(results: CheckResult[], startTime: number) {
  const totalDuration = (performance.now() - startTime) / 1000;
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;

  console.log('─────────────────────────────');
  console.log(`❌ ${failedCount} check(s) failed, ${passedCount} passed (${totalDuration.toFixed(1)}s total)`);

  const failedChecks = results.filter(r => !r.passed);
  if (failedChecks.length > 0) {
    console.log('\nFailed checks:');
    failedChecks.forEach(check => {
      console.log(`  - ${check.name}`);
      if (check.error) {
        console.log(`    ${check.error}`);
      }
    });
  }

  console.log('\n❌ Not ready to deploy\n');
}

main().catch(error => {
  console.error('\n❌ Unexpected error during pre-deploy check:', error);
  process.exit(1);
});
