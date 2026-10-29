// 测试专用最小类型声明(2026-10-02 UIP-10)。本仓不安装 @types/node(功能源码不需要),
// 而样式契约类测试必须读取 .css 源码(vitest `css:false` 下 `?raw` 对 .css 返回空串)。
// 这里只给用到的 node:fs API 最小声明:新增此类测试直接 `import { readFileSync } from 'node:fs'`,
// 不必再写显式压错注释(该计数已因此下调,见 tools/check-frontend-lint.mjs)。
declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: 'utf8'): string;
  /** NIGHT-1:theme.test.ts 要在「web 包根 / 仓库根」两种 cwd 下探测文件是否存在。 */
  export function existsSync(path: string | URL): boolean;
}

/** NIGHT-1:同上,探测候选路径用;本仓测试只需 resolve。 */
declare module 'node:path' {
  export function resolve(...parts: string[]): string;
}

/** 只声明测试里用到的字段(cwd);功能源码不用 process,故仍不装 @types/node。 */
declare const process: { cwd(): string };

declare module 'node:crypto' {
  export interface Hash {
    update(data: string, encoding?: string): Hash;
    digest(encoding?: string): string;
  }
  export function createHash(algorithm: string): Hash;
}
