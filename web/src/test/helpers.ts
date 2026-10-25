/**
 * 测试公共辅助（仅测试代码 import，不进生产包）。
 *
 * 为什么需要这份文件：2026-10-25 的代码体检里，`web/src` 下 14 个测试文件
 * 各自手写 `new Response(JSON.stringify({ token: 't' }), { status: 200 })`
 * 共 33 次 —— 同一段「伪造 bootstrap 响应」的样板复制了 33 遍，改一次口径
 * 要动 14 个文件。全部收敛到这里。
 *
 * 纪律：
 *   - 只放**纯函数**，不改全局、不留状态；需要 mock 全局的地方仍由测试自己 `vi.spyOn`。
 *   - 构造出的 `Response` 与原先手写的**字节级等价**（不额外加 Content-Type），
 *     避免顺带改变被测代码的分支。
 */

/** 造一个 JSON 响应体（默认 200）。 */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** 造一个「bootstrap 成功」响应：`{ token }`。默认 token 为 `t`。 */
export function tokenResponse(token = 't'): Response {
  return jsonResponse({ token }, 200);
}

/** 造一个纯文本响应体（如 SSE / 错误页）。 */
export function textResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}
