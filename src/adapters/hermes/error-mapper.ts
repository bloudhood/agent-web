/**
 * Map Hermes / OpenAI-compatible error codes to user-actionable messages.
 *
 * The CLI / chat surface should not expose raw provider strings — they
 * confuse non-English users and leak implementation details. This module
 * provides Chinese-localized, concrete next-step suggestions.
 */

import type { HermesError } from './gateway-client';

export interface UserFacingError {
  title: string;
  body: string;
  actionable: boolean;
  /** When set, UI may display a countdown until next retry. */
  retryAfterMs?: number;
}

export function mapHermesError(err: HermesError): UserFacingError {
  const status = err.status;
  const code = err.code;

  if (status === 401 || code === 'invalid_api_key') {
    return {
      title: 'Hermes 鉴权失败',
      body: '请到设置 → Hermes 配置 中检查 API Key 是否正确，或重新登录。',
      actionable: true,
    };
  }
  if (status === 403 || code === 'permission_denied') {
    return {
      title: '权限不足',
      body: '当前 API Key 不允许访问该模型或工具。请确认账号权限。',
      actionable: true,
    };
  }
  if (status === 404) {
    return {
      title: '资源未找到',
      body: '请求的会话或响应可能已被服务器清理。请重新发起对话。',
      actionable: true,
    };
  }
  if (status === 429 || code === 'rate_limit_exceeded') {
    const retryAfterMs = err.retryAfterMs;
    return {
      title: '请求过多',
      body: retryAfterMs
        ? `已触发 Hermes Gateway 的速率限制，约 ${Math.ceil(retryAfterMs / 1000)} 秒后可重试。`
        : '已触发 Hermes Gateway 的速率限制，请稍后再试。',
      actionable: true,
      retryAfterMs,
    };
  }
  if (status === 408 || code === 'timeout') {
    return {
      title: '请求超时',
      body: 'Hermes Gateway 没有在预期时间内响应。请检查网络或重试。',
      actionable: true,
    };
  }
  if (status && status >= 500 && status < 600) {
    return {
      title: 'Hermes Gateway 内部错误',
      body: '上游服务暂时不可用，agent-web 已停止当前请求。稍后可重试。',
      actionable: false,
    };
  }
  if (code === 'context_length_exceeded') {
    return {
      title: '上下文超限',
      body: '当前会话长度超过模型上下文窗口。请使用 /compact 压缩上下文，或新建会话。',
      actionable: true,
    };
  }
  return {
    title: 'Hermes 任务失败',
    body: err.message || '未知错误。请查看日志了解详情。',
    actionable: false,
  };
}
