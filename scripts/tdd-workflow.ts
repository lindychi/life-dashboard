#!/usr/bin/env tsx
/**
 * TDD Workflow Helper
 *
 * Interactive CLI for following TDD best practices:
 * 1. Create test file structure
 * 2. Run tests in watch mode
 * 3. Verify test coverage
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname, basename, relative } from "path";
import { spawn } from "child_process";
import * as readline from "readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

function bold(text: string): string {
  return `\x1b[1m${text}\x1b[0m`;
}

function green(text: string): string {
  return `\x1b[32m${text}\x1b[0m`;
}

function blue(text: string): string {
  return `\x1b[34m${text}\x1b[0m`;
}

function yellow(text: string): string {
  return `\x1b[33m${text}\x1b[0m`;
}

function runCommand(command: string, args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false });
    child.on("close", (code) => resolve(code ?? 0));
  });
}

async function main() {
  console.log(bold(blue("\n🧪 TDD Workflow Helper\n")));

  const action = await ask(
    "What would you like to do?\n" +
      "1. Create new test file (Red phase)\n" +
      "2. Run tests in watch mode (Green phase)\n" +
      "3. Check coverage (Refactor phase)\n" +
      "4. Full TDD cycle (all phases)\n" +
      "Enter number (1-4): "
  );

  switch (action.trim()) {
    case "1":
      await createTestFile();
      break;
    case "2":
      await runWatchMode();
      break;
    case "3":
      await checkCoverage();
      break;
    case "4":
      await fullCycle();
      break;
    default:
      console.log("Invalid option");
  }

  rl.close();
}

async function createTestFile() {
  console.log(bold("\n📝 Creating Test File (Red Phase)\n"));

  const filePath = await ask("Enter the source file path (e.g., src/lib/foo.ts): ");
  const trimmedPath = filePath.trim();

  if (!trimmedPath) {
    console.log("File path is required");
    return;
  }

  // Determine test file location
  const testPath = getTestFilePath(trimmedPath);
  const testDir = dirname(testPath);

  // Create __tests__ directory if it doesn't exist
  if (!existsSync(testDir)) {
    mkdirSync(testDir, { recursive: true });
    console.log(green(`✓ Created directory: ${testDir}`));
  }

  // Check if test file already exists
  if (existsSync(testPath)) {
    console.log(yellow(`⚠ Test file already exists: ${testPath}`));
    const overwrite = await ask("Overwrite? (y/N): ");
    if (!overwrite.match(/^[Yy]$/)) {
      return;
    }
  }

  // Generate test template
  const template = generateTestTemplate(trimmedPath, testPath);
  writeFileSync(testPath, template);

  console.log(green(`\n✓ Created test file: ${testPath}`));
  console.log("\nNext steps:");
  console.log("1. Write failing tests in " + basename(testPath));
  console.log("2. Run: " + bold("pnpm test:watch") + " to watch for changes");
  console.log("3. Verify tests fail (Red phase)");
  console.log("4. Implement the feature to make tests pass (Green phase)\n");
}

function getTestFilePath(sourcePath: string): string {
  // Remove leading ./ if present
  const normalizedPath = sourcePath.replace(/^\.\//, "");

  if (normalizedPath.startsWith("src/lib/")) {
    // src/lib/foo.ts → src/lib/__tests__/foo.test.ts
    const dir = dirname(normalizedPath);
    const base = basename(normalizedPath, ".ts");
    return join(dir, "__tests__", `${base}.test.ts`);
  }

  if (normalizedPath.startsWith("src/components/")) {
    // src/components/Foo.tsx → src/components/__tests__/Foo.test.tsx
    const dir = dirname(normalizedPath);
    const base = basename(normalizedPath, ".tsx");
    return join(dir, "__tests__", `${base}.test.tsx`);
  }

  if (normalizedPath.startsWith("src/app/api/")) {
    // src/app/api/foo/route.ts → src/app/api/__tests__/foo.test.ts
    const dir = dirname(normalizedPath);
    const base = basename(normalizedPath, ".ts");
    return join(dir, "__tests__", `${base}.test.ts`);
  }

  // Default: same directory + __tests__
  const dir = dirname(normalizedPath);
  const base = basename(normalizedPath).replace(/\.(ts|tsx)$/, "");
  const ext = normalizedPath.endsWith(".tsx") ? ".tsx" : ".ts";
  return join(dir, "__tests__", `${base}.test${ext}`);
}

function generateTestTemplate(sourcePath: string, testPath: string): string {
  const moduleName = basename(sourcePath, ".ts").replace(/\.tsx?$/, "");
  const isComponent = sourcePath.endsWith(".tsx");
  const importPath = relative(dirname(testPath), sourcePath).replace(/\.(ts|tsx)$/, "");

  if (isComponent) {
    return `import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ${moduleName} from "${importPath}";

describe("${moduleName}", () => {
  it("should render without crashing", () => {
    render(<${moduleName} />);
    // Add your assertions here
    expect(true).toBe(false); // Replace with actual test
  });

  // TODO: Add more test cases following TDD principles
  // 1. Write tests that describe the expected behavior
  // 2. Run tests and verify they fail (Red)
  // 3. Implement the component to make tests pass (Green)
  // 4. Refactor while keeping tests green
});
`;
  }

  return `import { describe, it, expect } from "vitest";
import { ${moduleName} } from "${importPath}";

describe("${moduleName}", () => {
  it("should [describe expected behavior]", () => {
    // Arrange
    const input = /* setup test data */;

    // Act
    const result = ${moduleName}(input);

    // Assert
    expect(result).toBe(/* expected value */);
    expect(true).toBe(false); // Replace with actual test
  });

  // TODO: Add more test cases following TDD principles
  // 1. Write tests that describe the expected behavior
  // 2. Run tests and verify they fail (Red)
  // 3. Implement the function to make tests pass (Green)
  // 4. Refactor while keeping tests green
});
`;
}

async function runWatchMode() {
  console.log(bold("\n👀 Running Tests in Watch Mode (Green Phase)\n"));
  console.log("This will run tests automatically when files change.");
  console.log("Press Ctrl+C to stop.\n");

  await runCommand("pnpm", ["test:watch"]);
}

async function checkCoverage() {
  console.log(bold("\n📊 Checking Test Coverage (Refactor Phase)\n"));

  const exitCode = await runCommand("pnpm", ["test:coverage"]);

  if (exitCode === 0) {
    console.log(green("\n✓ Coverage report generated"));
    console.log("View detailed report: " + bold("open coverage/index.html"));
  } else {
    console.log(yellow("\n⚠ Coverage thresholds not met"));
    console.log("Add more tests to meet the required coverage:");
    console.log("  - Lines: 80%");
    console.log("  - Functions: 80%");
    console.log("  - Branches: 75%");
    console.log("  - Statements: 80%");
  }
}

async function fullCycle() {
  console.log(bold(blue("\n🔄 Full TDD Cycle\n")));

  console.log(bold("Phase 1: Red (Write Failing Test)"));
  await createTestFile();

  const continueToGreen = await ask("\nReady to run tests? (Y/n): ");
  if (continueToGreen.match(/^[Nn]$/)) {
    return;
  }

  console.log(bold("\nPhase 2: Green (Make Tests Pass)"));
  await runWatchMode();

  const continueToRefactor = await ask("\nReady to check coverage? (Y/n): ");
  if (continueToRefactor.match(/^[Nn]$/)) {
    return;
  }

  console.log(bold("\nPhase 3: Refactor (Check Coverage)"));
  await checkCoverage();
}

main().catch(console.error);
