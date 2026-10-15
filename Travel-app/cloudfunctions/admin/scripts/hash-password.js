#!/usr/bin/env node
const { hashPassword } = require('../lib/auth');

const password = process.argv[2];
if (!password) {
  console.error('usage: node scripts/hash-password.js "your-password"');
  process.exit(1);
}
const result = hashPassword(password);
console.log(JSON.stringify({
  ADMIN_BOOTSTRAP_PASSWORD_SALT: result.salt,
  ADMIN_BOOTSTRAP_PASSWORD_HASH: result.hash,
}, null, 2));
