/** 云函数发布产物 manifest 一致性门禁。 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  MANIFEST_NAME, SCHEMA_VERSION, rewriteLibRequires, verifyArtifact,
} = require('../scripts/cloudfunction-artifact');

let fail = 0;
function check(condition, message) {
  if (condition) {
    console.log('ok  ', message);
    return;
  }
  fail += 1;
  console.log('FAIL', message);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeManifest(root, files) {
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    functionName: 'payment',
    sourceRoot: 'cloudfunctions/payment',
    commitSha: 'abc123',
    commitDate: '2026-11-20T20:00:00+08:00',
    branch: 'main',
    files: files.map(relative => {
      const full = path.join(root, relative);
      return { path: relative, bytes: fs.statSync(full).size, sha256: sha256(full) };
    }).sort((a, b) => a.path.localeCompare(b.path)),
  };
  fs.writeFileSync(path.join(root, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function expectFailure(fn, contains, message) {
  try {
    fn();
  } catch (err) {
    check(String(err.message || err).includes(contains), message);
    return;
  }
  check(false, message);
}

function run() {
  check(
    rewriteLibRequires("const a = require('./lib/after-sales');")
      === "const a = require('./after-sales');",
    '拍平 require 路径'
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'payment-artifact-test-'));
  fs.writeFileSync(path.join(root, 'index.js'), "require('./dep');\n");
  fs.writeFileSync(path.join(root, 'dep.js'), 'module.exports = 1;\n');
  fs.mkdirSync(path.join(root, 'data', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'rules.json'), '{"rules":[]}\n');
  fs.writeFileSync(path.join(root, 'data', 'nested', 'fixture.json'), '{"ok":true}\n');
  writeManifest(root, ['index.js', 'dep.js', 'data/rules.json', 'data/nested/fixture.json']);

  const manifest = verifyArtifact(root, { expectedCommit: 'abc123' });
  check(manifest.functionName === 'payment', '完整产物校验通过');
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'node_modules', 'installed.js'), 'module.exports = true;\n');
  fs.symlinkSync(
    path.join(root, 'node_modules', 'installed.js'),
    path.join(root, 'node_modules', 'installed-link.js')
  );
  verifyArtifact(root, { expectedCommit: 'abc123' });
  check(true, '忽略云端安装的 node_modules');
  fs.rmSync(path.join(root, 'node_modules'), { recursive: true, force: true });
  expectFailure(
    () => verifyArtifact(root, { expectedCommit: 'different' }),
    '产物提交不一致',
    '拒绝不同提交的产物'
  );

  fs.writeFileSync(path.join(root, 'extra.js'), 'module.exports = 2;\n');
  expectFailure(() => verifyArtifact(root), 'manifest 未登记', '拒绝 manifest 外新增文件');
  fs.unlinkSync(path.join(root, 'extra.js'));

  fs.writeFileSync(path.join(root, 'dep.js'), 'module.exports = 3;\n');
  expectFailure(() => verifyArtifact(root), 'SHA-256 不一致', '拒绝被篡改文件');

  fs.writeFileSync(path.join(root, 'index.js'), "require('./missing');\n");
  writeManifest(root, ['index.js', 'dep.js', 'data/rules.json', 'data/nested/fixture.json']);
  expectFailure(() => verifyArtifact(root), '无法解析相对依赖', '拒绝缺失相对依赖');

  fs.rmSync(root, { recursive: true, force: true });
  if (fail) process.exit(1);
  console.log('\nAll cloudfunction artifact tests passed.');
}

run();
