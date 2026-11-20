#!/usr/bin/env node
/**
 * 云函数可复现发布产物工具。
 *
 * 用途：
 *   node scripts/cloudfunction-artifact.js build --function payment --out /tmp/payment-artifact
 *   node scripts/cloudfunction-artifact.js verify --artifact /tmp/payment-artifact --expected-commit <sha>
 *
 * build 只接受干净工作区，并把提交 SHA、分支和逐文件 SHA-256 写入
 * release-manifest.json。verify 会拒绝多文件、少文件、哈希不一致和无法解析的
 * 相对 require，供上传前及下载线上代码后各执行一次。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SCHEMA_VERSION = 'cloudfunction-artifact/v1';
const MANIFEST_NAME = 'release-manifest.json';
const ROOT = path.resolve(__dirname, '..');

function usage() {
  console.error('Usage: node scripts/cloudfunction-artifact.js build --function <name> --out <dir>');
  console.error('       node scripts/cloudfunction-artifact.js verify --artifact <dir> [--expected-commit <sha>]');
}

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || '') : '';
}

function git(args) {
  return execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' }).trim();
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function ensureInside(baseDir, target) {
  const relative = path.relative(baseDir, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`路径越界: ${target}`);
  }
  return relative.split(path.sep).join('/');
}

function walkFiles(baseDir, options = {}) {
  const skipNames = new Set(options.skipNames || []);
  const files = [];
  function visit(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (skipNames.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`发布目录不允许符号链接: ${full}`);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  visit(baseDir);
  return files;
}

function rewriteLibRequires(source) {
  return source.replace(/require\((['"])\.\/lib\/([^'"]+)\1\)/g, 'require($1./$2$1)');
}

function assertCleanWorktree() {
  const dirty = git(['status', '--porcelain', '--untracked-files=normal']);
  if (dirty) {
    throw new Error(`发布构建必须使用干净工作区，当前存在未提交改动:\n${dirty}`);
  }
}

function buildArtifact(functionName, outDir) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(functionName)) throw new Error('云函数名不合法');
  if (!outDir) throw new Error('必须指定 --out');
  assertCleanWorktree();

  const sourceDir = path.join(ROOT, 'cloudfunctions', functionName);
  if (!fs.existsSync(path.join(sourceDir, 'index.js'))) {
    throw new Error(`找不到云函数入口: ${sourceDir}/index.js`);
  }
  const output = path.resolve(outDir);
  if (fs.existsSync(output)) throw new Error(`输出目录已存在，请换一个空路径: ${output}`);
  fs.mkdirSync(output, { recursive: true });

  const topEntries = fs.readdirSync(sourceDir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of topEntries) {
    if (entry.isSymbolicLink()) throw new Error(`云函数目录不允许符号链接: ${entry.name}`);
    if (entry.isDirectory() && !['lib', 'node_modules'].includes(entry.name)) {
      throw new Error(`存在未支持拍平的顶层目录: ${entry.name}`);
    }
  }
  const topFiles = topEntries.filter(entry => entry.isFile()).map(entry => entry.name);
  for (const name of topFiles) {
    let content = fs.readFileSync(path.join(sourceDir, name));
    if (name.endsWith('.js')) content = Buffer.from(rewriteLibRequires(content.toString('utf8')));
    fs.writeFileSync(path.join(output, name), content);
  }

  const libDir = path.join(sourceDir, 'lib');
  if (!fs.existsSync(libDir) || !fs.statSync(libDir).isDirectory()) {
    throw new Error(`云函数缺少 lib 目录: ${libDir}`);
  }
  const libFiles = walkFiles(libDir);
  for (const sourceFile of libFiles) {
    const relative = path.relative(libDir, sourceFile);
    if (relative.includes(path.sep)) {
      throw new Error(`暂不支持 lib 子目录拍平: ${relative}`);
    }
    const target = path.join(output, relative);
    if (fs.existsSync(target)) throw new Error(`拍平后文件重名: ${relative}`);
    let content = fs.readFileSync(sourceFile);
    if (relative.endsWith('.js')) content = Buffer.from(rewriteLibRequires(content.toString('utf8')));
    fs.writeFileSync(target, content);
  }

  const artifactFiles = walkFiles(output)
    .map(file => {
      const relative = ensureInside(output, file);
      return {
        path: relative,
        bytes: fs.statSync(file).size,
        sha256: sha256File(file),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    functionName,
    sourceRoot: 'cloudfunctions/' + functionName,
    commitSha: git(['rev-parse', 'HEAD']),
    commitDate: git(['show', '-s', '--format=%cI', 'HEAD']),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    files: artifactFiles,
  };
  fs.writeFileSync(path.join(output, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
  return { output, manifest };
}

function resolveRelativeRequire(baseDir, request) {
  const target = path.resolve(baseDir, request);
  const candidates = [target, `${target}.js`, `${target}.json`, path.join(target, 'index.js')];
  return candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || '';
}

function verifyRelativeRequires(artifactDir) {
  const failures = [];
  const jsFiles = walkFiles(artifactDir).filter(file => file.endsWith('.js'));
  for (const file of jsFiles) {
    const source = fs.readFileSync(file, 'utf8');
    const relative = ensureInside(artifactDir, file);
    if (/require\((['"])\.\/lib\//.test(source)) {
      failures.push(`${relative}: 仍包含未拍平的 require('./lib/...')`);
    }
    for (const match of source.matchAll(/require\((['"])(\.[^'"]+)\1\)/g)) {
      if (!resolveRelativeRequire(path.dirname(file), match[2])) {
        failures.push(`${relative}: 无法解析相对依赖 ${match[2]}`);
      }
    }
  }
  return failures;
}

function verifyArtifact(artifactDir, options = {}) {
  const root = path.resolve(artifactDir);
  const manifestPath = path.join(root, MANIFEST_NAME);
  if (!fs.existsSync(manifestPath)) throw new Error(`缺少 ${MANIFEST_NAME}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`manifest schema 不匹配: ${manifest.schemaVersion}`);
  }
  if (options.expectedCommit && manifest.commitSha !== options.expectedCommit) {
    throw new Error(`产物提交不一致: artifact=${manifest.commitSha} expected=${options.expectedCommit}`);
  }

  const manifestFiles = Array.isArray(manifest.files) ? manifest.files : [];
  const expected = new Map(manifestFiles.map(item => [String(item.path), item]));
  const actualFiles = walkFiles(root, { skipNames: ['node_modules', '.DS_Store', '__MACOSX'] })
    .map(file => ensureInside(root, file))
    .filter(relative => relative !== MANIFEST_NAME)
    .sort();
  const failures = [];
  for (const relative of actualFiles) {
    const item = expected.get(relative);
    if (!item) {
      failures.push(`${relative}: manifest 未登记`);
      continue;
    }
    const full = path.join(root, relative);
    const bytes = fs.statSync(full).size;
    const digest = sha256File(full);
    if (bytes !== Number(item.bytes)) failures.push(`${relative}: 字节数不一致`);
    if (digest !== item.sha256) failures.push(`${relative}: SHA-256 不一致`);
  }
  for (const relative of expected.keys()) {
    if (!actualFiles.includes(relative)) failures.push(`${relative}: 产物缺失`);
  }
  failures.push(...verifyRelativeRequires(root));
  if (failures.length) throw new Error(`产物校验失败:\n${failures.join('\n')}`);
  return manifest;
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === 'build') {
      const result = buildArtifact(argValue(args, '--function'), argValue(args, '--out'));
      console.log(`artifact: ${result.output}`);
      console.log(`commit: ${result.manifest.commitSha}`);
      console.log(`files: ${result.manifest.files.length}`);
      return;
    }
    if (command === 'verify') {
      const manifest = verifyArtifact(argValue(args, '--artifact'), {
        expectedCommit: argValue(args, '--expected-commit'),
      });
      console.log(`verified: ${manifest.functionName}@${manifest.commitSha}`);
      console.log(`files: ${manifest.files.length}`);
      return;
    }
    usage();
    process.exitCode = 2;
  } catch (err) {
    console.error(err.message || err);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  MANIFEST_NAME,
  SCHEMA_VERSION,
  buildArtifact,
  verifyArtifact,
  rewriteLibRequires,
};
