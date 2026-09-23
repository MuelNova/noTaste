import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const path = '.dev.vars';
let text = readFileSync(existsSync(path) ? path : '.dev.vars.example', 'utf8');
text = text.replace(
  /TOKEN_ENCRYPTION_KEY="(?:|generate-with-npm-run-setup)"/,
  `TOKEN_ENCRYPTION_KEY="${randomBytes(32).toString('base64')}"`,
);
writeFileSync(path, text, { mode: 0o600 });
console.log('本地配置已准备好；密钥不会打印到终端。');
