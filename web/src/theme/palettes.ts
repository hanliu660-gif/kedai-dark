// palettes.ts —— 柔和护眼配色的元数据(2026-11-03)
//
// 职责边界:只声明「有哪些配色 + 叫什么 + 用什么色卡预览」,不持有令牌值。
// 令牌值的唯一事实源是 styles/palettes.css(与明暗模式正交的两组 CSS 规则),
// 二者的一致性由 web/src/theme/palettes.test.ts 双向校验:
//   - 每个 id 在 palettes.css 里必须有 light 与 dark 两条规则;
//   - CSS 里出现的每个 data-palette 值都必须在下面的列表里登记(防孤儿配色)。
//
// 为什么不做成 registry 的 ThemeDefinition:
// registry 的主题是一维的(id 即完整外观),而这里需要「配色 × 明暗」二维组合——
// 若展开成 8 个独立主题,每套都要复制 46 个令牌,且切换明暗会丢掉配色选择。

/** 一套配色。id 用于 data-palette 属性,必须匹配 /^[a-z][a-z0-9-]*$/。 */
export interface PaletteDefinition {
  id: string;
  /** 中文名(设置页展示) */
  name: string;
  /** 一句话说明适用场景(设置页副标题) */
  hint: string;
  /** 预览色卡:画布 / 表面 / 强调色,取浅色档的值(darkOnly 取深色档) */
  swatch: readonly [string, string, string];
  /**
   * 只提供深色档。设为 true 时:
   * - palettes.css 只需(也应当只)定义 `:root[data-theme='dark'][data-palette='<id>']`;
   * - 设置页点选会先把明暗档切到「深色」,否则选了个在浅色下不存在的配色;
   * - 切回浅色时自动回落默认配色(见 UiSection 的 onThemeMode)。
   */
  darkOnly?: boolean;
}

/** 默认配色 = 构成主义纸面(不挂 data-palette,走 tokens.css 基底)。 */
export const DEFAULT_PALETTE_ID = 'default';

export const PALETTES: readonly PaletteDefinition[] = [
  {
    id: DEFAULT_PALETTE_ID,
    name: '纸面',
    hint: '原始构成主义:淡粉纸面 + 黑方块 + 红斜线',
    swatch: ['#fbeef1', '#f4dbe2', '#e06890'],
  },
  {
    id: 'mist',
    name: '雾蓝',
    hint: '低饱和冷灰蓝,长时间办公与读长文不刺眼',
    swatch: ['#eef1f4', '#e2e7ee', '#56708f'],
  },
  {
    id: 'sage',
    name: '苔绿',
    hint: '低饱和植物绿,写作与沉浸阅读更松弛',
    swatch: ['#eef1ea', '#e2e7db', '#5d7a52'],
  },
  {
    id: 'oat',
    name: '燕麦',
    hint: '暖中性米色,最接近纸张,夜间开灯也不发白',
    swatch: ['#f4f1ea', '#eae5da', '#87704f'],
  },
  {
    id: 'mauve',
    name: '藕紫',
    hint: '低饱和紫灰，适合夜间与创意写作',
    swatch: ['#f2eef2', '#e8e2e8', '#7c6080'],
  },
  {
    id: 'oled',
    name: '纯黑',
    hint: 'OLED 纯黑画布；红/黄/绿/白块全部压暗，全界面无亮块（仅深色）',
    swatch: ['#000000', '#141519', '#8b929b'],
    darkOnly: true,
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
