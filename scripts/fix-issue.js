const fs = require("fs");
const path = require("path");

const GROQ_KEY = process.env.GROQ_API_KEY;
const issueNumber = process.env.ISSUE_NUMBER;
const issueTitle = process.env.ISSUE_TITLE || "";
const issueBody = process.env.ISSUE_BODY || "";

function collectFiles(dir, base = dir) {
  const SKIP = new Set(["node_modules", "dist", ".git", ".angular", "public"]);
  const EXTENSIONS = new Set([".ts", ".html", ".scss", ".css", ".json", ".js"]);
  const MAX_SIZE = 30000;
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

function buildCodebaseContext(files) {
  return files
    .map((f) => `--- FILE: ${f.path} ---\n${f.content}\n--- END FILE ---`)
    .join("\n\n");
}

function parseFileChanges(response) {
  const changes = [];
  const regex = /```([^\n`]+)\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(response)) !== null) {
    let filePath = match[1].trim();
    const content = match[2];

    if (!filePath.includes("/") && !filePath.includes(".")) {
      continue;
    }

    filePath = filePath.replace(/^(typescript|ts|html|scss|css|json|js)\s+/, "");
    changes.push({ path: filePath.trim(), content });
  }

  return changes;
}

async function callGroq(prompt) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_KEY}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: "You are an expert Angular developer. Return ONLY code blocks with file paths. No explanations.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: 16000,
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq API ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

async function main() {
  console.log(`\n🔍 Issue #${issueNumber}: ${issueTitle}\n`);

  const projectRoot = process.cwd();
  const files = collectFiles(projectRoot);
  console.log(`📁 Collected ${files.length} files for context\n`);

  const codebaseContext = buildCodebaseContext(files);

  const prompt = `A tester has reported a bug/issue in the project. Your job is to fix it.

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

  console.log("🤖 Asking Groq (Llama 3.3 70B) to fix the issue...\n");

  const responseText = await callGroq(prompt);

  console.log("📝 Response received. Parsing changes...\n");

  const changes = parseFileChanges(responseText);

  if (changes.length === 0) {
    console.error("❌ No file changes detected in response.");
    console.log("\nRaw response:\n", responseText);
    process.exit(1);
  }

  for (const change of changes) {
    const fullPath = path.join(projectRoot, change.path);
    const dir = path.dirname(fullPath);

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
