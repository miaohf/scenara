import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.md', '.css', '.scss', '.html', '.yml', '.yaml',
  '.txt', '.env', '.gitattributes', '.editorconfig'
]);

const IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  '.next',
  '.venv',
  'data',
]);

const IGNORE_FILES = new Set([
]);

const BOM_ALLOWLIST = new Set([
  'front-end/src/components/StageAssets.tsx',
]);

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const PRIVATE_USE_REGEX = /[\uE000-\uF8FF]/u;

const shouldCheckFile = (filepath) => {
  const base = path.basename(filepath);
  if (base === '.editorconfig' || base === '.gitattributes') return true;
  const ext = path.extname(filepath).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
};

const walkFiles = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      files.push(...(await walkFiles(fullPath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
};

const decodeUtf8Strict = (buffer) => {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  return decoder.decode(buffer);
};

const toRelative = (filepath) => path.relative(ROOT, filepath).replace(/\\/g, '/');

const main = async () => {
  const allFiles = await walkFiles(ROOT);
  const textFiles = allFiles.filter(shouldCheckFile);
  const errors = [];

  for (const filepath of textFiles) {
    const buffer = await readFile(filepath);
    const rel = toRelative(filepath);
    if (IGNORE_FILES.has(rel)) continue;

    if (buffer.length >= 3 && buffer.subarray(0, 3).equals(UTF8_BOM)) {
      if (!BOM_ALLOWLIST.has(rel)) {
        errors.push(`${rel}: UTF-8 BOM detected`);
      }
      continue;
    }

    let text = '';
    try {
      text = decodeUtf8Strict(buffer);
    } catch {
      errors.push(`${rel}: not valid UTF-8`);
      continue;
    }

    if (text.includes('\uFFFD')) {
      errors.push(`${rel}: replacement character (U+FFFD) detected`);
    }

    if (PRIVATE_USE_REGEX.test(text)) {
      errors.push(`${rel}: private-use Unicode character detected (possible encoding corruption)`);
    }
  }

  if (errors.length > 0) {
    console.error('UTF-8 guardrail check failed:');
    for (const err of errors) {
      console.error(`- ${err}`);
    }
    process.exit(1);
  }

  console.log(`UTF-8 guardrail passed (${textFiles.length} files checked).`);
};

main().catch((error) => {
  console.error('UTF-8 guardrail execution failed:', error);
  process.exit(1);
});
