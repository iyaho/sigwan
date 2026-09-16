// pnpm 모노레포용 Metro 설정. Expo SDK 52+는 워크스페이스를 스스로 찾지만
// 루트 node_modules와 packages/core를 확실히 지켜보게 못 박는다.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// core는 .ts 소스를 그대로 내보낸다(빌드 산출물 없음) — Metro가 TS를 직접 변환한다
config.resolver.sourceExts = [...config.resolver.sourceExts, 'ts', 'tsx'];

module.exports = config;
