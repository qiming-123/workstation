import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const hashPattern = /^[a-f0-9]{32}:[a-f0-9]{128}$/;
const cipherKey = /^[a-f0-9]{64}$/;

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + (await derive(password, salt, 64)).toString('hex');
}

export async function matchesPassword(password, hash) {
  const [salt, digest] = hash.split(':');
  const actual = await derive(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(digest, 'hex'));
}

function invalid(field) {
  throw new Error('配置无效：' + field);
}

function parseOrigin(value, field) {
  let url;
  try {
    url = new URL(value);
  } catch {
    invalid(field);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.href !== url.origin + '/') invalid(field);
  return url;
}

export async function loadConfig(path) {
  let source;
  try {
    source = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error('无法读取配置 JSON');
  }
  if (!source || Array.isArray(source) || typeof source !== 'object') invalid('根对象');
  const { username, passwordHash, cookieSecret, port, fileBackend, vscodePath } = source;
  if (typeof username !== 'string' || !username.trim() || username.length > 128) invalid('username');
  if (typeof passwordHash !== 'string' || !hashPattern.test(passwordHash)) invalid('passwordHash');
  if (typeof cookieSecret !== 'string' || !cipherKey.test(cookieSecret)) invalid('cookieSecret');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) invalid('port');
  const publicOrigin = parseOrigin(source.publicOrigin, 'publicOrigin').origin;
  const backend = parseOrigin(fileBackend?.origin, 'fileBackend.origin');
  if (backend.protocol !== 'http:' || backend.hostname !== '127.0.0.1' || !backend.port
      || Number(backend.port) === port) invalid('fileBackend.origin');
  if (typeof fileBackend.password !== 'string' || !cipherKey.test(fileBackend.password)) invalid('fileBackend.password');
  if (vscodePath !== null && (typeof vscodePath !== 'string' || !isAbsolute(vscodePath))) invalid('vscodePath');
  return {
    username, passwordHash, cookieSecret, port, publicOrigin, vscodePath,
    fileBackend: { origin: backend.origin, password: fileBackend.password },
    actionsPath: resolve(dirname(path), 'actions.json'),
  };
}
