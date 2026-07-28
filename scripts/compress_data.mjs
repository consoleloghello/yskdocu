/**
 * compress_data.mjs
 *
 * Compress data/*.json files using gzip (level 9) for maximum browser
 * compatibility. Uses DecompressionStream('gzip') on the browser side,
 * which is universally supported in all browsers that support the API.
 *
 * Output: data/*.json.gz (gzip-compressed files, ~22% of original size)
 *
 * Usage:  node scripts/compress_data.mjs
 *         npm run compress
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');

// Files to compress (match pattern: 外操版.json, 内操版.json)
const jsonFiles = fs.readdirSync(dataDir)
  .filter(f => f.endsWith('.json') && f !== 'changelog.json'); // skip tiny changelog

if (jsonFiles.length === 0) {
  console.error('No JSON data files found in', dataDir);
  process.exit(1);
}

let totalOriginal = 0;
let totalCompressed = 0;

for (const file of jsonFiles) {
  const inputPath = path.join(dataDir, file);
  // Remove old .json.br if it exists
  const oldBrPath = path.join(dataDir, file + '.br');
  if (fs.existsSync(oldBrPath)) {
    fs.unlinkSync(oldBrPath);
  }

  const outputPath = path.join(dataDir, file + '.gz');

  const original = fs.readFileSync(inputPath);
  const compressed = zlib.gzipSync(original, { level: 9 });

  fs.writeFileSync(outputPath, compressed);

  const ratio = ((compressed.length / original.length) * 100).toFixed(1);
  totalOriginal += original.length;
  totalCompressed += compressed.length;

  console.log(
    `  ✓ ${file.padEnd(20)} ${(original.length / 1024).toFixed(1)} KB → ` +
    `${(compressed.length / 1024).toFixed(1)} KB  (${ratio}%)`
  );
}

const totalRatio = ((totalCompressed / totalOriginal) * 100).toFixed(1);
console.log(`\n  Total: ${(totalOriginal / 1024).toFixed(1)} KB → ${(totalCompressed / 1024).toFixed(1)} KB (${totalRatio}%)`);
