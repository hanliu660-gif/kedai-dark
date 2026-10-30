import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sandboxScript } from './boot-script';
import { MESSAGE_BUS_SCRIPT } from './boot/message-bus';
import { getRuntimeCompatScript } from './boot/runtime-compat';
import { getJqueryCoreScript } from './boot/jquery-core';
import { JQUERY_WINDOW_SCRIPT } from './boot/jquery-window';
import { JQUERY_METHODS_SCRIPT } from './boot/jquery-methods';
import { MVU_TAVERN_SCRIPT } from './boot/mvu-tavern';
import { getSharedBridgeScript } from './boot/shared-bridge';
import type { MvuVariables } from '../mvu/variables';

describe('沙箱 boot 模块化组件与组装测试', () => {
  it('message-bus 导出基础通信与事件总线代码', () => {
    expect(MESSAGE_BUS_SCRIPT).toContain('__kdSendTarget');
    expect(MESSAGE_BUS_SCRIPT).toContain('addEventListener(\'message\'');
    expect(MESSAGE_BUS_SCRIPT).toContain('rpc-result');
  });

  it('runtime-compat 导出变量路径工具与宿主几何/存储桥', () => {
    const script = getRuntimeCompatScript(JSON.stringify({ height: 800, width: 1200 }));
    expect(script).toContain('__kdGeo');
    expect(script).toContain('__kdSetGeo');
    expect(script).toContain('__kdMakeStorage');
  });

  it('jquery-core 导出状态镜像与选择器队列', () => {
    const script = getJqueryCoreScript(JSON.stringify({}), JSON.stringify([]));
    expect(script).toContain('__kdMirror');
    expect(script).toContain('getElementById');
    expect(script).toContain('__kdElemFacade');
  });

  it('jquery-window 与 jquery-methods 导出 window 门面与集合链式方法', () => {
    expect(JQUERY_WINDOW_SCRIPT).toContain('__kdHostWinEvents');
    expect(JQUERY_METHODS_SCRIPT).toContain('nodeFacade');
    expect(JQUERY_METHODS_SCRIPT).toContain('const $=jq;');
  });

  it('mvu-tavern 导出 MVU 解包视图与酒馆 API 并维持 unwrap 哈希契约', () => {
    expect(MVU_TAVERN_SCRIPT).toContain('6ccd4bda787e');
    expect(MVU_TAVERN_SCRIPT).toContain('__kdUnwrap');
    expect(MVU_TAVERN_SCRIPT).toContain('TavernHelper');
  });

  it('shared-bridge 导出跨 realm 共享全局桥', () => {
    const script = getSharedBridgeScript(JSON.stringify({ testKey: 'val' }));
    expect(script).toContain('__kdSharedInitial');
    expect(script).toContain('__kdSharedStart');
  });

  it('sandboxScript 完整组装且生成可执行代码(锁定长度与 SHA-256 摘要锚点)', () => {
    // 1. 单段基准:验证包含性
    const code = sandboxScript('const a = 123;', 'nonce-test', {
      stat_data: {},
      display_data: {},
    });
    expect(code).toContain('use strict');
    expect(code).toContain('const a = 123;');
    expect(code).toContain('nonce-test');

    // 2. 长度与 SHA-256 前 16 位锚点(防段落搬家、静默删改或换行漂移)
    const codeX = sandboxScript('/*x*/', 'nonce-test', {
      stat_data: {},
      display_data: {},
    });
    const hashX = crypto.createHash('sha256').update(codeX, 'utf8').digest('hex').slice(0, 16);
    expect(codeX.length).toBe(88635);
    expect(hashX).toBe('bf4454f39522b5dd');

    // 3. 多段基准长度与 SHA-256 前 16 位锚点
    const multiCode = sandboxScript(
      [
        { name: 'seg1', code: 'var a=1;' },
        { name: 'seg2', code: 'var b=2;' },
      ],
      'nonce-4',
      { stat_data: {} } as MvuVariables,
    );
    const multiHash = crypto.createHash('sha256').update(multiCode, 'utf8').digest('hex').slice(0, 16);
    expect(multiCode.length).toBe(89890);
    expect(multiHash).toBe('d6dd888d6b83210e');
  });
});
