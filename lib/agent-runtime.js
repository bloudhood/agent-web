function createAgentRuntime(deps) {
  const {
    processEnv,
    CLAUDE_PATH,
    CODEX_PATH,
    GEMINI_PATH,
    MODEL_MAP,
    loadModelConfig,
    applyCustomTemplateToSettings,
    backupClaudeSettings,
    loadCodexConfig,
    prepareCodexCustomRuntime,
    wsSend,
    truncateObj,
    sanitizeToolInput,
    loadSession,
    saveSession: rawSaveSession,
    setRuntimeSessionId,
    getRuntimeSessionId,
  } = deps;

  function saveSession(session) {
    try { rawSaveSession(session); }
    catch (e) { console.error('[saveSession]', session?.id, e.message); }
  }

  const MAX_FULL_TEXT_CHARS = 2 * 1024 * 1024; // 2M UTF-16 code units
  const MAX_TOOL_CALLS = 200;

  function appendFullText(entry, text) {
    if (!text) return;
    const remaining = MAX_FULL_TEXT_CHARS - entry.fullText.length;
    if (remaining <= 0) {
      entry.fullTextTruncated = true;
      return;
    }
    if (text.length <= remaining) {
      entry.fullText += text;
    } else {
      // Avoid splitting a surrogate pair at the boundary
      let end = remaining;
      if (text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) {
        end -= 1;
      }
      entry.fullText += text.slice(0, end);
      entry.fullTextTruncated = true;
    }
  }

  function buildClaudeSpawnSpec(session, options = {}) {
    const hasAttachments = Array.isArray(options.attachments) && options.attachments.length > 0;
    const args = ['-p', '--output-format', 'stream-json', '--verbose'];
    if (hasAttachments) args.push('--input-format', 'stream-json');
    const permMode = session.permissionMode || 'yolo';
    switch (permMode) {
      case 'yolo':
        args.push('--dangerously-skip-permissions');
        break;
      case 'plan':
        args.push('--permission-mode', 'plan');
        break;
      case 'default':
        args.push('--permission-mode', 'default');
        break;
    }
    if (session.claudeSessionId) {
      args.push('--resume', session.claudeSessionId);
    }
    if (session.model) {
      args.push('--model', session.model);
    }

    const env = { ...processEnv };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE;
    delete env.CC_WEB_PASSWORD;
    for (const k of Object.keys(env)) {
      if (k.startsWith('ANTHROPIC_')) delete env[k];
    }

    const modelCfg = loadModelConfig();
    if (modelCfg.mode === 'custom' && modelCfg.activeTemplate) {
      const tpl = (modelCfg.templates || []).find((t) => t.name === modelCfg.activeTemplate);
      if (tpl) { if (backupClaudeSettings) backupClaudeSettings(); applyCustomTemplateToSettings(tpl); }
    }

    return {
      command: CLAUDE_PATH,
      args,
      env,
      cwd: session.cwd || processEnv.HOME || processEnv.USERPROFILE || process.cwd(),
      parser: 'claude',
      mode: permMode,
      resume: !!session.claudeSessionId,
    };
  }

  function buildCodexSpawnSpec(session, options = {}) {
    const codexConfig = loadCodexConfig();
    const runtimeConfig = prepareCodexCustomRuntime(codexConfig, session);
    if (runtimeConfig?.error) {
      return { error: runtimeConfig.error };
	    }
	    const runtimeId = getRuntimeSessionId(session);
	    const args = ['exec'];
	    args.push('--json', '--skip-git-repo-check');

	    const permMode = session.permissionMode || 'yolo';
	    // `-s/--sandbox` is an option for `codex exec`, but not for `codex exec resume`.
	    // When resuming, it must appear before the `resume` subcommand, otherwise Codex CLI errors
	    // with: "unexpected argument '-s' found".
	    if (runtimeId && permMode === 'plan') {
	      args.push('-s', 'read-only');
	    }
	    if (runtimeId) args.push('resume');
	    switch (permMode) {
	      case 'yolo':
	        args.push('--dangerously-bypass-approvals-and-sandbox');
	        break;
	      case 'plan':
	        if (!runtimeId) args.push('-s', 'read-only');
	        break;
	      case 'default':
	      default:
	        args.push('--full-auto');
        break;
    }

    const effectiveModel = session.model;
    if (effectiveModel) {
      const raw = String(effectiveModel).trim();
      // cc-web UI supports "gpt-5.4(high)" style selection, but Codex CLI expects:
      // - model: "gpt-5.4"
      // - reasoning effort: config key `model_reasoning_effort = "high"`
      const m = raw.match(/^(.*)\((medium|high|xhigh)\)\s*$/i);
      if (m) {
        const base = String(m[1] || '').trim();
        const lvl = String(m[2] || '').trim().toLowerCase();
        if (base) args.push('--model', base);
        // Use TOML string literal to avoid parsing ambiguity.
        args.push('-c', `model_reasoning_effort="${lvl}"`);
      } else {
        args.push('--model', raw);
      }
    }
    if (Array.isArray(options.attachments)) {
      for (const attachment of options.attachments) {
        if (attachment?.path) args.push('--image', attachment.path);
      }
    }
    if (runtimeId) {
      args.push(runtimeId, '-');
    } else {
      if (session.cwd) args.push('-C', session.cwd);
      args.push('-');
    }

    const env = { ...processEnv };
    delete env.CC_WEB_PASSWORD;
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE;
    if (runtimeConfig?.homeDir) {
      env.CODEX_HOME = runtimeConfig.homeDir;
    }
    if (runtimeConfig?.mode === 'custom') {
      env.OPENAI_API_KEY = runtimeConfig.apiKey;
      delete env.OPENAI_BASE_URL;
    }

    return {
      command: CODEX_PATH,
      args,
      env,
      cwd: session.cwd || processEnv.HOME || processEnv.USERPROFILE || process.cwd(),
      parser: 'codex',
      mode: permMode,
      resume: !!runtimeId,
      codexRuntimeKey: runtimeConfig?.runtimeKey || '',
      codexHomeDir: runtimeConfig?.homeDir || '',
    };
  }

  function codexToolName(item) {
    switch (item?.type) {
      case 'command_execution':
        return 'CommandExecution';
      case 'mcp_tool_call':
        return 'McpToolCall';
      case 'file_change':
        return 'FileChange';
      case 'reasoning':
        return 'Reasoning';
      default:
        return item?.type || 'CodexItem';
    }
  }

  function codexToolInput(item) {
    if (!item) return null;
    if (item.type === 'command_execution') return { command: item.command || '' };
    return truncateObj(item, 500);
  }

  function codexToolMeta(item) {
    if (!item) return null;
    switch (item.type) {
      case 'command_execution':
        return {
          kind: 'command_execution',
          title: 'Shell Command',
          subtitle: item.command || '',
          exitCode: typeof item.exit_code === 'number' ? item.exit_code : null,
          status: item.status || null,
        };
      case 'mcp_tool_call':
        return {
          kind: 'mcp_tool_call',
          title: 'MCP Tool',
          subtitle: item.tool_name || item.name || item.server_name || '',
          status: item.status || null,
        };
      case 'file_change':
        return {
          kind: 'file_change',
          title: 'File Change',
          subtitle: item.path || item.file_path || '',
          status: item.status || null,
        };
      case 'reasoning':
        return {
          kind: 'reasoning',
          title: 'Reasoning',
          subtitle: typeof item.text === 'string' ? item.text.slice(0, 120) : '',
          status: item.status || null,
        };
      default:
        return {
          kind: item.type || 'codex_item',
          title: codexToolName(item),
          subtitle: '',
          status: item.status || null,
        };
    }
  }

  function codexToolResult(item) {
    if (!item) return '';
    if (typeof item.aggregated_output === 'string' && item.aggregated_output) return item.aggregated_output;
    if (typeof item.text === 'string' && item.text) return item.text;
    return JSON.stringify(truncateObj(item, 1200));
  }

  function ensureCodexToolCall(entry, item) {
    let tc = entry.toolCalls.find((t) => t.id === item.id);
    if (tc) {
      tc.name = codexToolName(item);
      tc.kind = item.type || tc.kind || null;
      tc.meta = codexToolMeta(item) || tc.meta || null;
      if (tc.input == null) tc.input = codexToolInput(item);
      return tc;
    }
    tc = {
      name: codexToolName(item),
      id: item.id,
      kind: item.type || null,
      meta: codexToolMeta(item),
      input: codexToolInput(item),
      done: false,
    };
    if (entry.toolCalls.length < MAX_TOOL_CALLS) entry.toolCalls.push(tc);
    else entry.toolCallsTruncated = true;
    wsSend(entry.ws, {
      type: 'tool_start',
      name: tc.name,
      toolUseId: item.id,
      input: tc.input,
      kind: tc.kind,
      meta: tc.meta,
    });
    return tc;
  }

  function processClaudeEvent(entry, event, sessionId) {
    if (!event || !event.type) return;

    switch (event.type) {
      case 'system':
        if (event.session_id) {
          const session = loadSession(sessionId);
          if (session) {
            session.claudeSessionId = event.session_id;
            saveSession(session);
          }
        }
        break;

      case 'assistant': {
        const content = event.message?.content;
        if (!Array.isArray(content)) break;

        for (const block of content) {
          if (block.type === 'text' && block.text) {
            appendFullText(entry, block.text);
            wsSend(entry.ws, { type: 'text_delta', text: block.text }, true);
          } else if (block.type === 'tool_use') {
            const toolInput = sanitizeToolInput(block.name, block.input);
            const tc = { name: block.name, id: block.id, input: toolInput, done: false };
            if (entry.toolCalls.length < MAX_TOOL_CALLS) entry.toolCalls.push(tc);
            else entry.toolCallsTruncated = true;
            wsSend(entry.ws, { type: 'tool_start', name: block.name, toolUseId: block.id, input: tc.input });
          } else if (block.type === 'tool_result') {
            const resultText = typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content.map((c) => c.text || '').join('\n')
                : JSON.stringify(block.content);
            const tc = entry.toolCalls.find((t) => t.id === block.tool_use_id);
            if (tc) {
              tc.done = true;
              tc.result = resultText.slice(0, 2000);
            }
            wsSend(entry.ws, { type: 'tool_end', toolUseId: block.tool_use_id, result: resultText.slice(0, 2000) });
          }
        }

        if (event.session_id) {
          const session = loadSession(sessionId);
          if (session && !session.claudeSessionId) {
            session.claudeSessionId = event.session_id;
            saveSession(session);
          }
        }
        break;
      }

      case 'result': {
        const session = loadSession(sessionId);
        if (session) {
          if (event.session_id) session.claudeSessionId = event.session_id;
          if (event.total_cost_usd) session.totalCost = (session.totalCost || 0) + event.total_cost_usd;
          saveSession(session);
        }
        entry.lastCost = event.total_cost_usd || null;
        if (entry.ws && event.total_cost_usd !== undefined) {
          wsSend(entry.ws, { type: 'cost', costUsd: session?.totalCost || 0 }, true);
        }
        break;
      }
    }
  }

  function processCodexEvent(entry, event, sessionId) {
    if (!event || !event.type) return;

    switch (event.type) {
      case 'thread.started': {
        if (!event.thread_id) break;
        const session = loadSession(sessionId);
        if (session) {
          setRuntimeSessionId(session, event.thread_id);
          if (entry.codexHomeDir) session.codexHomeDir = entry.codexHomeDir;
          if (entry.codexRuntimeKey) session.codexRuntimeKey = entry.codexRuntimeKey;
          saveSession(session);
        }
        break;
      }

      case 'item.started': {
        const item = event.item;
        if (!item || !item.id || item.type === 'agent_message') break;
        ensureCodexToolCall(entry, item);
        break;
      }

      case 'item.completed': {
        const item = event.item;
        if (!item || !item.id) break;
        if (item.type === 'agent_message') {
          if (item.text) {
            appendFullText(entry, item.text);
            wsSend(entry.ws, { type: 'text_delta', text: item.text }, true);
          }
          break;
        }
        const tc = ensureCodexToolCall(entry, item);
        const resultText = codexToolResult(item).slice(0, 2000);
        tc.done = true;
        tc.result = resultText;
        wsSend(entry.ws, {
          type: 'tool_end',
          toolUseId: item.id,
          result: resultText,
          kind: tc.kind,
          meta: tc.meta,
        });
        break;
      }

      case 'turn.completed': {
        const usage = event.usage || null;
        entry.lastUsage = usage;
        const session = loadSession(sessionId);
        if (session && usage) {
          session.totalUsage = {
            inputTokens: (session.totalUsage?.inputTokens || 0) + (usage.input_tokens || 0),
            cachedInputTokens: (session.totalUsage?.cachedInputTokens || 0) + (usage.cached_input_tokens || 0),
            outputTokens: (session.totalUsage?.outputTokens || 0) + (usage.output_tokens || 0),
          };
          saveSession(session);
          wsSend(entry.ws, { type: 'usage', totalUsage: session.totalUsage }, true);
        }
        break;
      }

      case 'turn.failed': {
        const message = event.error?.message || 'Codex 任务失败';
        entry.lastError = message;
        break;
      }

      case 'error':
        if (event.message) {
          if (/^Reconnecting\.\.\./.test(event.message)) {
            // Codex CLI exec-runtime retry — track count so handleProcessComplete can reset thread ID
            console.error('[codex]', event.message);
            entry.reconnectRetryCount = (entry.reconnectRetryCount || 0) + 1;
          } else {
            entry.lastError = event.message;
          }
        }
        break;
    }
  }

  function buildGeminiSpawnSpec(session, options = {}) {
    if (Array.isArray(options.attachments) && options.attachments.length > 0) {
      return { error: 'Gemini CLI 会话暂不支持通过 agent-web 发送图片附件。' };
    }

    const runtimeId = getRuntimeSessionId(session);
    const permMode = session.permissionMode === 'default' ? 'plan' : (session.permissionMode || 'yolo');
    const args = ['--prompt', ' ', '--output-format', 'stream-json', '--skip-trust'];

    switch (permMode) {
      case 'yolo':
        args.push('--approval-mode', 'yolo');
        break;
      case 'plan':
        args.push('--approval-mode', 'plan');
        break;
      case 'default':
      default:
        args.push('--approval-mode', 'default');
        break;
    }

    if (runtimeId) {
      args.push('--resume', runtimeId);
    }
    if (session.model) {
      args.push('--model', session.model);
    }

    const env = { ...processEnv };
    delete env.CC_WEB_PASSWORD;
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE;
    env.GEMINI_CLI_NO_RELAUNCH = 'true';
    env.GEMINI_CLI_TRUST_WORKSPACE = 'true';

    return {
      command: GEMINI_PATH,
      args,
      env,
      cwd: session.cwd || processEnv.HOME || processEnv.USERPROFILE || process.cwd(),
      parser: 'gemini',
      mode: permMode,
      resume: !!runtimeId,
    };
  }

  function parseMaybeJson(value) {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    if (!trimmed) return value;
    if (!((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']')))) {
      return value;
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }

  function hermesOutputText(output) {
    if (typeof output === 'string') return output;
    if (Array.isArray(output)) {
      return output.map((part) => {
        if (typeof part === 'string') return part;
        if (part?.text) return part.text;
        if (part?.content) return hermesOutputText(part.content);
        return JSON.stringify(part);
      }).filter(Boolean).join('\n');
    }
    if (output && typeof output === 'object') {
      if (output.text) return String(output.text);
      if (output.content) return hermesOutputText(output.content);
    }
    return output === null || output === undefined ? '' : String(output);
  }

  function hermesFinalTextFromResponse(response) {
    const output = Array.isArray(response?.output) ? response.output : [];
    for (let i = output.length - 1; i >= 0; i -= 1) {
      const item = output[i];
      if (item?.type !== 'message') continue;
      const content = Array.isArray(item.content) ? item.content : [];
      const text = content
        .map((part) => part?.text || part?.output_text || '')
        .filter(Boolean)
        .join('');
      if (text) return text;
    }
    return '';
  }

  function ensureHermesToolCall(entry, item) {
    const id = item?.call_id || item?.id;
    if (!id) return null;
    let tc = entry.toolCalls.find((tool) => tool.id === id);
    const args = parseMaybeJson(item.arguments || item.input || {});
    const name = item.name || 'HermesTool';
    const meta = {
      kind: 'mcp_tool_call',
      title: name,
      subtitle: 'Hermes tool',
      status: item.status || null,
    };
    if (tc) {
      tc.name = name;
      tc.input = tc.input === undefined ? args : tc.input;
      tc.kind = 'mcp_tool_call';
      tc.meta = { ...(tc.meta || {}), ...meta };
      return tc;
    }
    tc = {
      name,
      id,
      kind: 'mcp_tool_call',
      meta,
      input: args,
      done: false,
    };
    if (entry.toolCalls.length < MAX_TOOL_CALLS) entry.toolCalls.push(tc);
    else entry.toolCallsTruncated = true;
    wsSend(entry.ws, {
      type: 'tool_start',
      name: tc.name,
      toolUseId: tc.id,
      input: tc.input,
      kind: tc.kind,
      meta: tc.meta,
    });
    return tc;
  }

  function processHermesEvent(entry, event, sessionId) {
    if (!event) return;
    const eventType = event.event || event.type;
    const data = event.data && typeof event.data === 'object' ? event.data : event;

    switch (eventType) {
      case 'response.created': {
        const id = data.response?.id || data.id;
        if (id) {
          const session = loadSession(sessionId);
          if (session) {
            setRuntimeSessionId(session, id);
            saveSession(session);
          }
        }
        break;
      }

      case 'response.output_text.delta': {
        const delta = data.delta || '';
        if (delta) {
          appendFullText(entry, delta);
          wsSend(entry.ws, { type: 'text_delta', text: delta }, true);
        }
        break;
      }

      case 'response.output_item.added': {
        const item = data.item || {};
        if (item.type === 'function_call') ensureHermesToolCall(entry, item);
        break;
      }

      case 'response.output_item.done': {
        const item = data.item || {};
        if (item.type === 'function_call') {
          const tc = ensureHermesToolCall(entry, item);
          if (tc) {
            tc.meta = { ...(tc.meta || {}), status: item.status || 'completed' };
          }
        } else if (item.type === 'function_call_output') {
          const callId = item.call_id || item.id;
          const tc = entry.toolCalls.find((tool) => tool.id === callId);
          const resultText = hermesOutputText(item.output).slice(0, 4000);
          if (tc) {
            tc.done = true;
            tc.result = resultText;
            tc.meta = { ...(tc.meta || {}), status: item.status || 'completed' };
          }
          wsSend(entry.ws, {
            type: 'tool_end',
            toolUseId: callId,
            result: resultText,
            kind: tc?.kind || 'mcp_tool_call',
            meta: tc?.meta || { kind: 'mcp_tool_call', status: item.status || 'completed' },
          });
        }
        break;
      }

      case 'response.completed': {
        const response = data.response || data;
        const session = loadSession(sessionId);
        if (session) {
          if (response.id) setRuntimeSessionId(session, response.id);
          const usage = response.usage || data.usage || null;
          if (usage) {
            session.totalUsage = {
              inputTokens: (session.totalUsage?.inputTokens || 0) + (usage.input_tokens || 0),
              cachedInputTokens: (session.totalUsage?.cachedInputTokens || 0) + (usage.cached_input_tokens || 0),
              outputTokens: (session.totalUsage?.outputTokens || 0) + (usage.output_tokens || 0),
            };
            entry.lastUsage = usage;
            wsSend(entry.ws, { type: 'usage', totalUsage: session.totalUsage }, true);
          }
          saveSession(session);
        }
        if (!entry.fullText) {
          const finalText = hermesFinalTextFromResponse(response);
          if (finalText) {
            appendFullText(entry, finalText);
            wsSend(entry.ws, { type: 'text_delta', text: finalText }, true);
          }
        }
        break;
      }

      case 'response.failed':
        entry.lastError = data.error?.message || data.response?.error?.message || 'Hermes 任务失败';
        break;

      case 'error':
        entry.lastError = data.error?.message || data.message || 'Hermes 任务失败';
        break;
    }
  }

  function geminiToolMeta(event) {
    const rawName = String(event?.tool_name || event?.name || 'GeminiTool');
    const params = event?.parameters || event?.input || {};
    const command = params?.command || params?.cmd || params?.commandLine || params?.shell_command || '';
    const lowerName = rawName.toLowerCase();
    if (command || /shell|command|terminal|exec/.test(lowerName)) {
      return {
        kind: 'command_execution',
        title: 'Shell Command',
        subtitle: command || rawName,
        status: event?.status || null,
      };
    }
    if (/write|edit|replace|patch|file/.test(lowerName) && (params?.path || params?.file_path || params?.filename)) {
      return {
        kind: 'file_change',
        title: rawName,
        subtitle: params.path || params.file_path || params.filename || '',
        status: event?.status || null,
      };
    }
    return {
      kind: 'mcp_tool_call',
      title: rawName,
      subtitle: rawName,
      status: event?.status || null,
    };
  }

  function ensureGeminiToolCall(entry, event) {
    const id = event?.tool_id || event?.id || event?.callId;
    if (!id) return null;
    const name = event.tool_name || event.name || 'GeminiTool';
    const meta = geminiToolMeta(event);
    let tc = entry.toolCalls.find((tool) => tool.id === id);
    if (tc) {
      tc.name = name;
      tc.kind = meta.kind;
      tc.meta = { ...(tc.meta || {}), ...meta };
      if (tc.input == null) tc.input = event.parameters || event.input || null;
      return tc;
    }
    tc = {
      name,
      id,
      kind: meta.kind,
      meta,
      input: event.parameters || event.input || null,
      done: false,
    };
    if (entry.toolCalls.length < MAX_TOOL_CALLS) entry.toolCalls.push(tc);
    else entry.toolCallsTruncated = true;
    wsSend(entry.ws, {
      type: 'tool_start',
      name: tc.name,
      toolUseId: tc.id,
      input: tc.input,
      kind: tc.kind,
      meta: tc.meta,
    });
    return tc;
  }

  function processGeminiEvent(entry, event, sessionId) {
    if (!event || !event.type) return;

    switch (event.type) {
      case 'init': {
        if (event.session_id) {
          const session = loadSession(sessionId);
          if (session) {
            setRuntimeSessionId(session, event.session_id);
            if (event.model && !session.model) session.model = event.model;
            saveSession(session);
          }
        }
        break;
      }

      case 'message': {
        if (event.role !== 'assistant') break;
        const text = typeof event.content === 'string' ? event.content : '';
        if (text) {
          appendFullText(entry, text);
          wsSend(entry.ws, { type: 'text_delta', text }, true);
        }
        break;
      }

      case 'tool_use':
        ensureGeminiToolCall(entry, event);
        break;

      case 'tool_result': {
        const id = event.tool_id || event.id || event.callId;
        const tc = entry.toolCalls.find((tool) => tool.id === id);
        const resultText = event.error?.message || event.output || '';
        if (tc) {
          tc.done = true;
          tc.result = resultText;
          tc.meta = {
            ...(tc.meta || {}),
            status: event.status || (event.error ? 'error' : 'success'),
          };
        }
        wsSend(entry.ws, {
          type: 'tool_end',
          toolUseId: id,
          result: resultText,
          kind: tc?.kind || 'mcp_tool_call',
          meta: tc?.meta || { kind: 'mcp_tool_call', status: event.status || null },
        });
        break;
      }

      case 'error':
        if (event.severity === 'error' || !event.severity) {
          entry.lastError = event.message || event.error?.message || 'Gemini CLI 任务失败';
        }
        break;

      case 'result': {
        if (event.status === 'error') {
          entry.lastError = event.error?.message || 'Gemini CLI 任务失败';
        }
        const stats = event.stats || null;
        if (stats) {
          const session = loadSession(sessionId);
          if (session) {
            session.totalUsage = {
              inputTokens: (session.totalUsage?.inputTokens || 0) + (stats.input_tokens || 0),
              cachedInputTokens: (session.totalUsage?.cachedInputTokens || 0) + (stats.cached || 0),
              outputTokens: (session.totalUsage?.outputTokens || 0) + (stats.output_tokens || 0),
            };
            entry.lastUsage = {
              input_tokens: stats.input_tokens || 0,
              cached_input_tokens: stats.cached || 0,
              output_tokens: stats.output_tokens || 0,
            };
            wsSend(entry.ws, { type: 'usage', totalUsage: session.totalUsage }, true);
            saveSession(session);
          }
        }
        break;
      }
    }
  }

  function processRuntimeEvent(entry, event, sessionId) {
    if (entry.agent === 'codex') processCodexEvent(entry, event, sessionId);
    else if (entry.agent === 'hermes') processHermesEvent(entry, event, sessionId);
    else if (entry.agent === 'gemini') processGeminiEvent(entry, event, sessionId);
    else processClaudeEvent(entry, event, sessionId);
  }

  return {
    buildClaudeSpawnSpec,
    buildCodexSpawnSpec,
    buildGeminiSpawnSpec,
    processClaudeEvent,
    processCodexEvent,
    processHermesEvent,
    processGeminiEvent,
    processRuntimeEvent,
  };
}

module.exports = { createAgentRuntime };
