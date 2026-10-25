// 聊天流式服务单例(SSE 连接与停止)。
import * as api from '../../api';
import { createChatStreamService } from '../../chatStreamService';

export const chatStream = createChatStreamService({
  streamChat: api.streamChat,
  stopChat: api.stopChat,
});
