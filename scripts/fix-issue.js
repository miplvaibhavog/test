const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");

const client = new Anthropic({ apiKey: process.env.CLAUDE_API_KEY });

const issueNumber = process.env.ISSUE_NUMBER;
const issueTitle = process.env.ISSUE_TITLE || "";
const issueBody = process.env.ISSUE_BODY || "";

// Recursively collect project files for context (skip node_modules, dist, .git)
function collectFiles(dir, base = dir) {
  const SKIP = new Set(["node_modules", "dist", ".git", ".angular", "public"]);
  const EXTENSIONS = new Set([".ts", ".html", ".scss", ".css", ".json", ".js"]);
  const MAX_SIZE = 30000; // skip files larger than 30KB
  let files = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(collectFiles(fullPath, base));
    } else if (EXTENSIONS.has(path.extname(entry.name))) {
      const stat = fs.statSync(fullPath);
      if (stat.size > MAX_SIZE) continue;

      const relativePath = path.relative(base, fullPath).replace(/\\/g, "/");
      const content = fs.readFileSync(fullPath, "utf-8");
      files.push({ path: relativePath, content });
    }
  }
  return files;
}

// Build a string representation of the codebase
function buildCodebaseContext(files) {
  return files
    .map((f) => `--- FILE: ${f.path} ---\n${f.content}\n--- END FILE ---`)
    .join("\n\n");
}

// Parse Claude's response into file changes
function parseFileChanges(response) {
  const changes = [];
  // Match ```filepath or ```<filepath> blocks
  const regex = /```([^\n`]+)\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(response)) !== null) {
    let filePath = match[1].trim();
    const content = match[2];

    // Remove language hints if present (e.g., "typescript" before actual path)
    // We detect paths by checking for / or file extensions
    if (!filePath.includes("/") && !filePath.includes(".")) {
      continue; // skip generic code blocks like ```typescript
    }

    // Clean up the path
    filePath = filePath.replace(/^(typescript|ts|html|scss|css|json|js)\s+/, "");

    changes.push({ path: filePath.trim(), content });
  }

  return changes;
}

async function main() {
  console.log(`\n🔍 Issue #${issueNumber}: ${issueTitle}\n`);

  // Collect project files
  const projectRoot = process.cwd();
  const files = collectFiles(projectRoot);
  console.log(`📁 Collected ${files.length} files for context\n`);

  const codebaseContext = buildCodebaseContext(files);

  // Build the prompt
  const prompt = `You are an expert Angular developer. A tester has reported a bug/issue in the project. Your job is to fix it.

## Issue #${issueNumber}
**Title:** ${issueTitle}
**Description:**
${issueBody}

## Current Codebase
${codebaseContext}

## Instructions
1. Analyze the issue carefully and understand what needs to change.
2. Identify the exact file(s) that need modification.
3. Return ONLY the complete updated file contents for each file that needs to change.
4. Use this exact format for each file — the file path must match the project structure:

\`\`\`<relative-file-path>
<complete file content>
\`\`\`

For example:
\`\`\`nexus-login/src/app/login/login.component.ts
// full updated file content here
\`\`\`

IMPORTANT:
- Return the COMPLETE file content, not just the changed parts.
- Only include files that actually need changes.
- Do NOT add explanations outside of code blocks.
- File paths must be relative to the project root.
- Preserve existing code style and conventions.`;

  console.log("🤖 Asking Claude to fix the issue...\n");

  const message = await client.messages.create({
    model: "claude-opus-4-6-20250414",
    max_tokens: 16000,
    messages: [{ role: "user", content: prompt }],
  });

  const responseText = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  console.log("📝 Claude response received. Parsing changes...\n");

  // Parse and apply changes
  const changes = parseFileChanges(responseText);

  if (changes.length === 0) {
    console.error("❌ No file changes detected in Claude's response.");
    console.log("\nRaw response:\n", responseText);
    process.exit(1);
  }

  for (const change of changes) {
    const fullPath = path.join(projectRoot, change.path);
    const dir = path.dirname(fullPath);

    // Create directory if it doesn't exist
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, change.content, "utf-8");
    console.log(`✅ Updated: ${change.path}`);
  }

  console.log(`\n🎉 Applied ${changes.length} file change(s) for issue #${issueNumber}`);
}

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
