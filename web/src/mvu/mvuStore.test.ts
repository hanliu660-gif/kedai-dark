// mvuStore 回放与命令应用:开场白 <initvar> 播种语义
// 背景:wuwa 卡 14 个备用开场尾部携带 <UpdateVariable><initvar>YAML</initvar></UpdateVariable>,
// 开场白是种子消息(不经 applyMvuUpdate、无 extra.mvu 快照),不支持 initvar 时变量树恒空,
// 状态栏 24 处取值全部显示 "--"。
import { describe, expect, it } from 'vitest';
import { applyMvuCommands, replayMvuVariables, withInitVarSeed } from './mvuStore';
import { pathGet, statValue } from './variables';
import { emptyVariables } from './variables';

const GREETING = [
  '守岸人抬眸望向你:「你醒了。」',
  '<UpdateVariable>',
  '<initvar>',
  '当前时间: "第1年 10月13日 周日 14:00"',
  '所在地点: "黑海岸-泰缇斯枢纽-花房"',
  '主角信息:',
  '  是否是漂泊者: true',
  '女性角色:',
  '  守岸人:',
  '    好感度: 80',
  '</initvar>',
  '</UpdateVariable>',
  '<StatusPlaceHolderImpl/>',
].join('\n');

describe('replayMvuVariables + <initvar>', () => {
  it('无快照的开场白携带 initvar 时播种初始变量', () => {
    const vars = replayMvuVariables([{ role: 'assistant', content: GREETING, extra: {} }]);
    expect(statValue(pathGet(vars.stat_data, '当前时间'))).toBe('第1年 10月13日 周日 14:00');
    expect(statValue(pathGet(vars.stat_data, '女性角色.守岸人.好感度'))).toBe(80);
    expect(statValue(pathGet(vars.stat_data, '主角信息.是否是漂泊者'))).toBe(true);
    // display_data 镜像 "v->v(初始)"
    expect(pathGet(vars.display_data, '女性角色.守岸人.好感度')).toBe('80->80(初始)');
  });

  it('无 initvar 的普通消息不播种', () => {
    const vars = replayMvuVariables([{ role: 'assistant', content: '普通回复', extra: {} }]);
    expect(Object.keys(vars.stat_data)).toHaveLength(0);
  });

  it('快照出现后不再播种(快照是真相,避免复活已删除键)', () => {
    const vars = replayMvuVariables([
      { role: 'assistant', content: GREETING, extra: {} },
      {
        role: 'assistant',
        content: 'x',
        extra: { mvu: { stat_data: { 女性角色: { 守岸人: { 好感度: [85, '约会'] } } } } },
      },
      // 第二条无快照但带 initvar 的消息(理论不出现):不应再播种
      { role: 'assistant', content: GREETING, extra: {} },
    ]);
    expect(statValue(pathGet(vars.stat_data, '女性角色.守岸人.好感度'))).toBe(85);
    // 第二条 GREETING 未播种:好感度保持快照的 85 而非初始 80
  });

  it('快照合并覆盖播种底(推进顺序:播种 → 快照)', () => {
    const vars = replayMvuVariables([
      { role: 'assistant', content: GREETING, extra: {} },
      {
        role: 'assistant',
        content: 'x',
        extra: { mvu: { stat_data: { 当前时间: ['第1年 10月14日 周一 08:00', '推进'] } } },
      },
    ]);
    expect(statValue(pathGet(vars.stat_data, '当前时间'))).toBe('第1年 10月14日 周一 08:00');
    // 快照未覆盖的键保留播种值
    expect(statValue(pathGet(vars.stat_data, '所在地点'))).toBe('黑海岸-泰缇斯枢纽-花房');
  });
});

describe('applyMvuCommands + <initvar>', () => {
  it('变量树为空时先播种再应用命令', () => {
    const vars = applyMvuCommands(
      emptyVariables(),
      [{ path: '女性角色.守岸人.好感度', oldValue: 80, newValue: 85, reason: '约会' }],
      '女性角色:\n  守岸人:\n    好感度: 80\n当前时间: "14:00"',
    );
    // 命令覆盖播种值;未触及的播种键保留
    expect(statValue(pathGet(vars.stat_data, '女性角色.守岸人.好感度'))).toBe(85);
    expect(statValue(pathGet(vars.stat_data, '当前时间'))).toBe('14:00');
  });

  it('变量树非空时 initvar 不覆盖进行中进度', () => {
    const cur = emptyVariables();
    cur.stat_data['当前时间'] = ['第2年 01月01日', '推进'];
    const vars = applyMvuCommands(cur, [], '当前时间: "第1年 10月13日"');
    expect(statValue(pathGet(vars.stat_data, '当前时间'))).toBe('第2年 01月01日');
  });

  it('无 initvar 时行为与原先一致', () => {
    const vars = applyMvuCommands(emptyVariables(), [
      { path: 'a.b', oldValue: null, newValue: 1, reason: 'r' },
    ]);
    expect(statValue(pathGet(vars.stat_data, 'a.b'))).toBe(1);
  });
});

describe('withInitVarSeed(世界书 [InitVar] 播种)', () => {
  // 背景:露出日记-0615 的初始变量只存在世界书条目 [InitVar](enabled:false),
  // 开场白没有 <initvar>、也没有 extra.mvu 快照 ⇒ 变量树恒空,整页卡的「着装」
  // 展开后无条目。世界书条目必须在整页卡 boot 前补进 mvuVariables。
  const ENTRIES = {
    '墨墨露出变量描述[InitVar]':
      '主角:\n  衣柜:\n    上装:\n      白色宽大T恤: >-\n        纯棉,厚0.8mm,低弹.(暴露值:5)\n',
  };

  it('空树时用 [InitVar] 条目播种(stat_data 叶子成对,display_data 镜像)', () => {
    const seeded = withInitVarSeed(emptyVariables(), ENTRIES);
    expect(statValue(pathGet(seeded.stat_data, '主角.衣柜.上装.白色宽大T恤'))).toBe(
      '纯棉,厚0.8mm,低弹.(暴露值:5)',
    );
    expect(pathGet(seeded.display_data, '主角.衣柜.上装.白色宽大T恤')).toBe(
      '纯棉,厚0.8mm,低弹.(暴露值:5)->纯棉,厚0.8mm,低弹.(暴露值:5)(初始)',
    );
  });

  it('已有变量时不覆盖进度,但补齐缺失路径(老会话自动修好)', () => {
    // 模拟引入本修复前落库的旧快照:主角下只有自己写过的进度,整棵 衣柜 缺失
    // (实测老会话 主角 仅有 名字/外观数据/身体色情记录,JSON 251 字符)。
    const legacy = applyMvuCommands(emptyVariables(), [
      { path: '主角.名字', oldValue: null, newValue: '墨墨', reason: '剧情' },
      { path: '主角.衣柜.下装.牛仔裤', oldValue: null, newValue: '已换上', reason: '剧情' },
    ]);
    const out = withInitVarSeed(legacy, ENTRIES);
    expect(out).not.toBe(legacy);
    // 已有进度一律保留
    expect(statValue(pathGet(out.stat_data, '主角.名字'))).toBe('墨墨');
    expect(statValue(pathGet(out.stat_data, '主角.衣柜.下装.牛仔裤'))).toBe('已换上');
    // 缺失路径由 [InitVar] 补上
    expect(statValue(pathGet(out.stat_data, '主角.衣柜.上装.白色宽大T恤'))).toBe(
      '纯棉,厚0.8mm,低弹.(暴露值:5)',
    );
    expect(pathGet(out.display_data, '主角.衣柜.上装.白色宽大T恤')).toBe(
      '纯棉,厚0.8mm,低弹.(暴露值:5)->纯棉,厚0.8mm,低弹.(暴露值:5)(初始)',
    );
  });

  it('同样路径已存在时不覆盖,无缺失则返回同一引用', () => {
    const current = applyMvuCommands(emptyVariables(), [
      { path: '主角.衣柜.上装.白色宽大T恤', oldValue: null, newValue: '已换装', reason: '剧情' },
    ]);
    const seeded = withInitVarSeed(current, ENTRIES);
    expect(statValue(pathGet(seeded.stat_data, '主角.衣柜.上装.白色宽大T恤'))).toBe('已换装');
    // 再播种一次已无缺失 ⇒ 同一引用,避免每次 loadHistory 都重建变量树
    expect(withInitVarSeed(seeded, ENTRIES)).toBe(seeded);
  });

  it('无条目 / 条目内容为空时原样返回', () => {
    const empty = emptyVariables();
    expect(withInitVarSeed(empty, {})).toBe(empty);
    expect(withInitVarSeed(empty, { '[InitVar]': '   ' })).toBe(empty);
  });
});
