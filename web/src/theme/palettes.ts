// palettes.ts —— 柔和护眼配色:元数据 + 令牌值(单一事实源;2026-11-03 立,2026-11-07 收为 SSOT)
//
// 职责:本文件是配色令牌的**唯一事实源**。`web/src/styles/palettes.css` 由
// `tools/generate-tokens.mjs` 从这里生成(门禁 `web: tokens-sync` 用 --check 防漂移),
// **不要手改 palettes.css**:手改会在下一次生成时被覆盖,且 --check 会判红。
//
// 两条正交的轴:data-theme 管明暗、data-palette 管色相。因此每套配色都要给 light 与 dark
// 两组值(darkOnly 除外),令牌集合固定为 `PALETTE_TOKEN_KEYS` 的 17 个 —— 少一个就会在某个
// 明暗档里露出基底粉色,这是"配色只改一半"最常见的翻车方式。`darkExtras` 只给"深色档还要
// 额外压暗"的少量功能/装饰色(目前仅纯黑 OLED 用)。
//
// 为什么不做成 registry 的 ThemeDefinition:registry 的主题是一维的(id 即完整外观),而这里
// 需要「配色 × 明暗」二维组合——若展开成 10 个独立主题,每套都要复制 46 个令牌,且切换明暗
// 会丢掉配色选择。

/** 配色令牌:与 tokens.css 基底同名、随配色整体替换的 17 个。 */
export const PALETTE_TOKEN_KEYS = [
  '--sv-paper',
  '--sv-surface',
  '--sv-surface-elevated',
  '--sv-white',
  '--sv-ink',
  '--sv-ink-soft',
  '--sv-ink-dim',
  '--sv-ink-faint',
  '--sv-line',
  '--sv-line-strong',
  '--sv-pink',
  '--sv-pink-light',
  '--sv-pink-medium',
  '--sv-pink-deep',
  '--sv-pink-dark',
  '--sv-block-bg',
  '--sv-block-fg',
] as const;

export type PaletteTokenKey = (typeof PALETTE_TOKEN_KEYS)[number];

/** 深色档额外覆盖的令牌(功能色/装饰色),只有 darkOnly 配色需要。 */
export const PALETTE_EXTRA_TOKEN_KEYS = [
  '--sv-ink-supreme',
  '--sv-red',
  '--sv-red-deep',
  '--sv-yellow',
  '--sv-yellow-deep',
  '--sv-green',
  '--sv-green-deep',
  '--sv-orange',
  '--sv-purple',
] as const;

export type PaletteExtraTokenKey = (typeof PALETTE_EXTRA_TOKEN_KEYS)[number];

/** 一套配色的令牌:light 缺省即"无浅色档";dark 必填。 */
export interface PaletteTokenSet {
  light?: Record<PaletteTokenKey, string>;
  dark: Record<PaletteTokenKey, string>;
  /** 深色档额外覆盖(仅 darkOnly 配色用;键必须属于 PALETTE_EXTRA_TOKEN_KEYS) */
  darkExtras?: Partial<Record<PaletteExtraTokenKey, string>>;
}

/** 一套配色。id 用于 data-palette 属性,必须匹配 /^[a-z][a-z0-9-]*$/。 */
export interface PaletteDefinition {
  id: string;
  /** 中文名(设置页展示) */
  name: string;
  /** 一句话说明适用场景(设置页副标题) */
  hint: string;
  /** 预览色卡:画布 / 表面 / 强调色,取浅色档的值(darkOnly 取深色档) */
  swatch: readonly [string, string, string];
  /** 生成 CSS 时打印在该配色块上方的设计说明 */
  note: string;
  /**
   * 只提供深色档。设为 true 时:
   * - palettes.css 只需(也应当只)定义 `:root[data-theme='dark'][data-palette='<id>']`;
   * - 设置页点选会先把明暗档切到「深色」,否则选了个在浅色下不存在的配色;
   * - 切回浅色时自动回落默认配色(见 UiSection 的 onThemeMode)。
   */
  darkOnly?: boolean;
  /** 令牌值;默认配色不填(它走 tokens.css 的构成主义基底,不挂 data-palette)。 */
  tokens?: PaletteTokenSet;
}

/** 默认配色 = 构成主义纸面(不挂 data-palette,走 tokens.css 基底)。 */
export const DEFAULT_PALETTE_ID = 'default';

export const PALETTES: readonly PaletteDefinition[] = [
  {
    id: DEFAULT_PALETTE_ID,
    name: '纸面',
    hint: '原始构成主义:淡粉纸面 + 黑方块 + 红斜线',
    swatch: ['#fbeef1', '#f4dbe2', '#e06890'],
    note: '纸面:原始构成主义基底(不挂 data-palette,走 tokens.css)',
  },
  {
    id: 'mist',
    name: '雾蓝',
    hint: '低饱和冷灰蓝,长时间办公与读长文不刺眼',
    swatch: ['#eef1f4', '#e2e7ee', '#56708f'],
    note: '雾蓝:低饱和冷灰蓝,偏办公/长文',
    tokens: {
      light: {
        '--sv-paper': '#eef1f4',
        '--sv-surface': '#e2e7ee',
        '--sv-surface-elevated': '#f7f9fb',
        '--sv-white': '#fbfcfe',
        '--sv-ink': '#26303a',
        '--sv-ink-soft': '#3d4a57',
        '--sv-ink-dim': '#58667a',
        '--sv-ink-faint': '#5e6b7a',
        '--sv-line': '#d3dbe5',
        '--sv-line-strong': '#bfcad8',
        '--sv-pink': '#cdd9e6',
        '--sv-pink-light': '#e5ecf3',
        '--sv-pink-medium': '#a8b9cd',
        '--sv-pink-deep': '#56708f',
        '--sv-pink-dark': '#42586f',
        '--sv-block-bg': '#2c3540',
        '--sv-block-fg': '#f2f6fa',
      },
      dark: {
        '--sv-paper': '#14171c',
        '--sv-surface': '#1b1f26',
        '--sv-surface-elevated': '#232831',
        '--sv-white': '#272d36',
        '--sv-ink': '#e6eaf0',
        '--sv-ink-soft': '#c9d1da',
        '--sv-ink-dim': '#9aa5b3',
        '--sv-ink-faint': '#7f8b99',
        '--sv-line': '#2a313a',
        '--sv-line-strong': '#39424e',
        '--sv-pink': '#262d36',
        '--sv-pink-light': '#1e242c',
        '--sv-pink-medium': '#38424f',
        '--sv-pink-deep': '#9db1c8',
        '--sv-pink-dark': '#b3c5d8',
        '--sv-block-bg': '#2b333d',
        '--sv-block-fg': '#eef3f9',
      },
    },
  },
  {
    id: 'sage',
    name: '苔绿',
    hint: '低饱和植物绿,写作与沉浸阅读更松弛',
    swatch: ['#eef1ea', '#e2e7db', '#5d7a52'],
    note: '苔绿:低饱和植物绿,偏阅读/写作',
    tokens: {
      light: {
        '--sv-paper': '#eef1ea',
        '--sv-surface': '#e2e7db',
        '--sv-surface-elevated': '#f7f9f3',
        '--sv-white': '#fbfcf8',
        '--sv-ink': '#2a3026',
        '--sv-ink-soft': '#3f4939',
        '--sv-ink-dim': '#5c6a53',
        '--sv-ink-faint': '#617056',
        '--sv-line': '#d6ddcd',
        '--sv-line-strong': '#c2ccb6',
        '--sv-pink': '#d2dcc7',
        '--sv-pink-light': '#e8eee2',
        '--sv-pink-medium': '#adbf9e',
        '--sv-pink-deep': '#5d7a52',
        '--sv-pink-dark': '#47603e',
        '--sv-block-bg': '#2f3630',
        '--sv-block-fg': '#f2f7ef',
      },
      dark: {
        '--sv-paper': '#151813',
        '--sv-surface': '#1c201a',
        '--sv-surface-elevated': '#242a21',
        '--sv-white': '#283023',
        '--sv-ink': '#e8ece3',
        '--sv-ink-soft': '#cbd3c4',
        '--sv-ink-dim': '#a0ab98',
        '--sv-ink-faint': '#869080',
        '--sv-line': '#2b322a',
        '--sv-line-strong': '#3b4437',
        '--sv-pink': '#252b23',
        '--sv-pink-light': '#1d231b',
        '--sv-pink-medium': '#37402f',
        '--sv-pink-deep': '#a3b795',
        '--sv-pink-dark': '#b9cba9',
        '--sv-block-bg': '#2b332a',
        '--sv-block-fg': '#eef4ea',
      },
    },
  },
  {
    id: 'oat',
    name: '燕麦',
    hint: '暖中性米色,最接近纸张,夜间开灯也不发白',
    swatch: ['#f4f1ea', '#eae5da', '#87704f'],
    note: '燕麦:暖中性米色,最接近"纸"的护眼档',
    tokens: {
      light: {
        '--sv-paper': '#f4f1ea',
        '--sv-surface': '#eae5da',
        '--sv-surface-elevated': '#faf8f2',
        '--sv-white': '#fdfbf6',
        '--sv-ink': '#2e2a24',
        '--sv-ink-soft': '#453f36',
        '--sv-ink-dim': '#635c50',
        '--sv-ink-faint': '#6d665a',
        '--sv-line': '#ded7c8',
        '--sv-line-strong': '#cbc3b1',
        '--sv-pink': '#ddd4c1',
        '--sv-pink-light': '#efeade',
        '--sv-pink-medium': '#c0b39b',
        '--sv-pink-deep': '#87704f',
        '--sv-pink-dark': '#6b573c',
        '--sv-block-bg': '#34302a',
        '--sv-block-fg': '#faf7f1',
      },
      dark: {
        '--sv-paper': '#17140f',
        '--sv-surface': '#1f1b15',
        '--sv-surface-elevated': '#27231c',
        '--sv-white': '#2b2720',
        '--sv-ink': '#ece7de',
        '--sv-ink-soft': '#d0c9bc',
        '--sv-ink-dim': '#a89f90',
        '--sv-ink-faint': '#8d8577',
        '--sv-line': '#302b23',
        '--sv-line-strong': '#413a2f',
        '--sv-pink': '#29241d',
        '--sv-pink-light': '#211d17',
        '--sv-pink-medium': '#3c352b',
        '--sv-pink-deep': '#b8a78c',
        '--sv-pink-dark': '#cdbc9f',
        '--sv-block-bg': '#2e2a23',
        '--sv-block-fg': '#f5f0e7',
      },
    },
  },
  {
    id: 'mauve',
    name: '藕紫',
    hint: '低饱和紫灰，适合夜间与创意写作',
    swatch: ['#f2eef2', '#e8e2e8', '#7c6080'],
    note: '藕紫:低饱和紫灰,偏夜间与创意写作',
    tokens: {
      light: {
        '--sv-paper': '#f2eef2',
        '--sv-surface': '#e8e2e8',
        '--sv-surface-elevated': '#f9f6f9',
        '--sv-white': '#fcfafc',
        '--sv-ink': '#2e2830',
        '--sv-ink-soft': '#463d49',
        '--sv-ink-dim': '#645a68',
        '--sv-ink-faint': '#6d6373',
        '--sv-line': '#dcd4dc',
        '--sv-line-strong': '#c9bec9',
        '--sv-pink': '#dbcfdb',
        '--sv-pink-light': '#efe7ef',
        '--sv-pink-medium': '#bfa9bf',
        '--sv-pink-deep': '#7c6080',
        '--sv-pink-dark': '#624b66',
        '--sv-block-bg': '#332d35',
        '--sv-block-fg': '#f8f4f8',
      },
      dark: {
        '--sv-paper': '#161317',
        '--sv-surface': '#1e1a1f',
        '--sv-surface-elevated': '#262129',
        '--sv-white': '#2a252d',
        '--sv-ink': '#eae5ec',
        '--sv-ink-soft': '#cfc7d1',
        '--sv-ink-dim': '#a69ca8',
        '--sv-ink-faint': '#8b8090',
        '--sv-line': '#2d2730',
        '--sv-line-strong': '#3d3541',
        '--sv-pink': '#28232a',
        '--sv-pink-light': '#201c23',
        '--sv-pink-medium': '#3a3340',
        '--sv-pink-deep': '#b9a4bf',
        '--sv-pink-dark': '#ceb9d3',
        '--sv-block-bg': '#2d2830',
        '--sv-block-fg': '#f3eef4',
      },
    },
  },
  {
    id: 'oled',
    name: '纯黑',
    hint: 'OLED 纯黑画布；红/黄/绿/白块全部压暗，全界面无亮块（仅深色）',
    swatch: ['#000000', '#141519', '#8b929b'],
    note: [
      '纯黑 OLED:画布 #000,且**全界面无亮块**',
      '与其它配色不同,本档只定义深色(浅色模式下选它无意义):',
      '点选时由设置页强制切到深色,theme.ts 的 applyPaletteAttr 也会拒绝在浅色下挂载。',
      '除常规 17 个令牌外,额外压暗 6 个"暗色下仍保持原亮度"的令牌——ink-supreme',
      '原为 #ffffff(至上主义方块/装配线色块)、red/yellow/green/orange/purple 是功能与装饰色。',
      '纯黑上它们是唯一会炸眼的元素,这里统一降到"暗色可辨但不发光"。',
      'ink 同步从 #f2f3f5 降到 #c9ced6:它同时是正文色与 1px 描边色,',
      '调低后正文仍有 12.7:1,而满屏发丝线不再刺眼。',
    ].join('\n'),
    darkOnly: true,
    tokens: {
      dark: {
        '--sv-paper': '#000000',
        '--sv-surface': '#0a0a0c',
        '--sv-surface-elevated': '#101013',
        '--sv-white': '#141417',
        '--sv-ink': '#c9ced6',
        '--sv-ink-soft': '#aeb4bd',
        '--sv-ink-dim': '#8b929b',
        '--sv-ink-faint': '#767d86',
        '--sv-line': '#1a1b1f',
        '--sv-line-strong': '#26282d',
        '--sv-pink': '#17181c',
        '--sv-pink-light': '#101114',
        '--sv-pink-medium': '#24262b',
        '--sv-pink-deep': '#8b929b',
        '--sv-pink-dark': '#a3aab3',
        '--sv-block-bg': '#141519',
        '--sv-block-fg': '#dfe3e8',
      },
      darkExtras: {
        '--sv-ink-supreme': '#b9bfc7',
        '--sv-red': '#a8342f',
        '--sv-red-deep': '#c25a54',
        '--sv-yellow': '#7a5a06',
        '--sv-yellow-deep': '#9c7a12',
        '--sv-green': '#2f6b45',
        '--sv-green-deep': '#4a8a62',
        '--sv-orange': '#9c5a20',
        '--sv-purple': '#5f3172',
      },
    },
  },
];

const PALETTE_IDS = new Set(PALETTES.map((p) => p.id));

/** 是否为合法配色 id(未知值一律回退默认,避免 localStorage 脏数据挂出空样式)。 */
export function isPaletteId(value: string | null | undefined): value is string {
  return typeof value === 'string' && PALETTE_IDS.has(value);
}

/** 取配色元数据;未知 id 返回默认配色。 */
export function paletteById(id: string): PaletteDefinition {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}
