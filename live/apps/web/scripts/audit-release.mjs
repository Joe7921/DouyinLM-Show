import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const distDir = path.join(root, "dist");
const indexPath = path.join(distDir, "index.html");

const sensitivePatterns = [
  { label: "Ark key marker", pattern: /ARK_API_KEY/iu },
  { label: "Volc ASR marker", pattern: /VOLC_ASR/iu },
  { label: "Bearer credential", pattern: /Authorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]+/iu },
  { label: "Windows absolute path", pattern: /[A-Za-z]:[\\/](?:Users|Antigravity projects)[\\/]/iu },
  { label: "metadata apply confirmation", pattern: /APPLY-DEMO-METADATA/iu },
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function referencedAssets(html) {
  return [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/giu)]
    .map((match) => match[1]);
}

async function main() {
  const index = await readFile(indexPath, "utf8");
  const assetRefs = referencedAssets(index);
  if (assetRefs.length === 0) throw new Error("dist/index.html 未引用任何构建资源");

  for (const assetRef of assetRefs) {
    const assetPath = path.join(distDir, assetRef.replace(/^\//u, ""));
    const assetStat = await stat(assetPath);
    if (!assetStat.isFile() || assetStat.size === 0) {
      throw new Error(`构建资源无效：${assetRef}`);
    }
  }

  const files = await walk(distDir);
  const sourceMaps = files.filter((file) => file.endsWith(".map"));
  const sensitiveHits = [];

  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const { label, pattern } of sensitivePatterns) {
      if (pattern.test(content)) {
        sensitiveHits.push({ file: path.relative(distDir, file), marker: label });
      }
    }
  }

  if (sourceMaps.length > 0) {
    throw new Error(`发布目录包含 ${sourceMaps.length} 个 source map`);
  }
  if (sensitiveHits.length > 0) {
    throw new Error(`发布目录命中敏感标记：${JSON.stringify(sensitiveHits)}`);
  }

  process.stdout.write(`${JSON.stringify({
    index_ok: true,
    referenced_assets: assetRefs,
    scanned_files: files.length,
    sensitive_hit_count: 0,
    source_maps: 0,
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
