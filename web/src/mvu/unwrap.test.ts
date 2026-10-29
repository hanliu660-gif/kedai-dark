// stat_data 叶子「[值, 原因] 存储对」的整树解包/反解包(相变点)。
// 背景:整页前端卡(露出日记-0615 等)在酒馆里 stat_data 叶子是**裸值**,
// 作者脚本用 `typeof v === 'string'` 过滤衣物名;Kedai 内部按 MagVarUpdate 约定
// 存成 [值, 原因] 对,若原样下发给帧内脚本,过滤后全空(实测 8 个衣柜类别 0 项)。
import { describe, expect, it } from 'vitest';
import { unwrapStatTree, wrapStatTree } from './unwrap';

describe('unwrapStatTree / wrapStatTree', () => {
  it('整树解包:叶子对取 [0],真实数组/对象递归保留', () => {
    const stat = {
      主角: {
        衣柜: {
          上装: { 白色宽大T恤: ['纯棉,厚0.8mm', '初始'], $meta: { extensible: [true, '初始'] } },
        },
      },
      背包: { 物品: [['药', '初始'], ['钥匙', '初始']] },
      编号: [1, 2, 3],
    };
    const bare = unwrapStatTree(stat) as Record<string, unknown>;
    expect(bare.主角).toEqual({
      衣柜: { 上装: { 白色宽大T恤: '纯棉,厚0.8mm', $meta: { extensible: true } } },
    });
    // 由叶子对组成的真实数组:逐元素解包
    expect(bare.背包).toEqual({ 物品: ['药', '钥匙'] });
    // 长度≠2 或 [1] 非字符串的数组按真实数组值处理,不拆
    expect(bare.编号).toEqual([1, 2, 3]);
  });

  it('反解包:裸值重新包成对,原因沿用旧树同路径(新键记「界面写入」)', () => {
    const prev = {
      主角: { 衣柜: { 上装: { 白色宽大T恤: ['纯棉', '初始'], 数量: [1, '购买'] } } },
      新键: ['x', '初始'],
    };
    const bare = {
      主角: { 衣柜: { 上装: { 白色宽大T恤: '纯棉,厚0.8mm', 数量: 2, 新增: '米色风衣' } } },
      新世界: { 年分: 2026 },
    };
    const wrapped = wrapStatTree(bare, prev) as Record<string, unknown>;
    // 保留旧原因
    const 主角 = wrapped.主角 as Record<string, unknown>;
    const 衣柜 = 主角['衣柜'] as Record<string, unknown>;
    const 上装 = 衣柜['上装'] as Record<string, unknown>;
    expect(上装['白色宽大T恤']).toEqual(['纯棉,厚0.8mm', '初始']);
    expect(上装['数量']).toEqual([2, '购买']);
    // 旧树没有的键:原因记「界面写入」
    expect(上装['新增']).toEqual(['米色风衣', '界面写入']);
    // 旧树整段缺失
    expect((wrapped.新世界 as Record<string, unknown>)['年分']).toEqual([2026, '界面写入']);
    // 解包 → 反解包 往返,值不丢
    expect(unwrapStatTree(wrapped)).toEqual(bare);
  });
});
