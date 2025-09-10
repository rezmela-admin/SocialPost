import fs from 'fs';
import path from 'path';

// Simple validator for narrative framework JSON files.
// Usage: node scripts/validate_frameworks.js

function walk(dir, out = []) {
  const dirents = fs.readdirSync(dir, { withFileTypes: true });
  for (const d of dirents) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) walk(p, out);
    else if (d.isFile() && p.endsWith('.json')) out.push(p);
  }
  return out;
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function validateFile(filePath) {
  const issues = [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const json = JSON.parse(raw);
    const required = ['name', 'description', 'template', 'example'];
    for (const key of required) {
      if (!isNonEmptyString(json[key])) {
        issues.push(`missing or empty "${key}"`);
      }
    }
  } catch (e) {
    issues.push(`invalid JSON (${e?.message || e})`);
  }
  return issues;
}

function main() {
  const root = path.join(process.cwd(), 'narrative_frameworks');
  if (!fs.existsSync(root)) {
    console.error(`[ERROR] Folder not found: ${root}`);
    process.exit(2);
  }

  const files = walk(root);
  let problemCount = 0;
  for (const f of files) {
    const issues = validateFile(f);
    if (issues.length) {
      problemCount += 1;
      console.error(`- ${f}: ${issues.join('; ')}`);
    }
  }

  if (problemCount > 0) {
    console.error(`\n[FAIL] ${problemCount} file(s) have issues.`);
    process.exit(1);
  } else {
    console.log(`[OK] ${files.length} framework file(s) validated successfully.`);
  }
}

main();

