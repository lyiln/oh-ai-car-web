import { Bot, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useFloatingPosition } from '../../hooks/useFloatingPosition.js';
import * as aiClient from '../../services/aiClient.js';
import type { AdvisorChatMessage } from '../../services/aiClient.js';
import { AdvisorMarkdown } from './AdvisorMarkdown.js';

type UiMessage = {
  role: 'user' | 'assistant';
  content: string;
};

const SUGGESTIONS = [
  '项目的完整工作流程是什么？',
  '当前白名单的车辆有哪些？',
  '小车为什么无法连接？',
  '查看今日巡检报告摘要',
];

const PANEL_SIZE = { width: 420, height: 560 };
const FAB_SIZE = { width: 64, height: 64 };

export function AdvisorPanel() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [messages, setMessages] = useState<UiMessage[]>([
    {
      role: 'assistant',
      content: '你好，我是巡牌通运维顾问。可以问我工作流程、白名单、连接故障或某日巡检报告。',
    },
  ]);
  const listRef = useRef<HTMLDivElement>(null);
  const size = open ? PANEL_SIZE : FAB_SIZE;
  const floating = useFloatingPosition({ size });

  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open, busy]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const nextMessages: UiMessage[] = [...messages, { role: 'user', content }];
    setMessages(nextMessages);
    setInput('');
    setBusy(true);
    setError('');
    try {
      const payload: AdvisorChatMessage[] = nextMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const result = await aiClient.advisorChat(payload);
      setMessages([...nextMessages, { role: 'assistant', content: result.reply }]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '顾问请求失败');
    } finally {
      setBusy(false);
    }
  };

  const toggleOpen = () => {
    if (floating.didDrag()) return;
    setOpen((value) => !value);
  };

  return (
    <div
      className={`advisor-float ${open ? 'is-open' : 'is-closed'}${busy ? ' is-busy' : ''}`}
      style={floating.style}
      role="complementary"
      aria-label="运维顾问"
    >
      {open ? (
        <div className="advisor-panel">
          <div className="advisor-panel-header">
            <div
              className="advisor-panel-title advisor-drag-handle"
              onPointerDown={floating.onPointerDown}
              onPointerMove={floating.onPointerMove}
              onPointerUp={floating.onPointerUp}
              onPointerCancel={floating.onPointerUp}
            >
              <span className={`advisor-status-dot${busy ? ' thinking' : ''}`} aria-hidden="true" />
              <div>
                <strong>运维顾问</strong>
                <span className="muted">人工顾问助手 · DeepSeek</span>
              </div>
            </div>
            <button
              type="button"
              className="advisor-icon-btn"
              aria-label="关闭顾问"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
              }}
            >
              <X size={16} />
            </button>
          </div>
          <div className="advisor-suggestions">
            {SUGGESTIONS.map((item) => (
              <button
                key={item}
                type="button"
                className="advisor-chip"
                disabled={busy}
                onClick={() => void send(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="advisor-messages" ref={listRef}>
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`advisor-bubble ${message.role === 'user' ? 'user' : 'assistant'}`}
              >
                {message.role === 'assistant'
                  ? <AdvisorMarkdown content={message.content} />
                  : message.content}
              </div>
            ))}
            {busy && (
              <div className="advisor-bubble assistant muted advisor-typing" aria-live="polite">
                <span /><span /><span />
              </div>
            )}
          </div>
          {error && <p className="error advisor-error">{error}</p>}
          <form
            className="advisor-input-row"
            onSubmit={(event) => {
              event.preventDefault();
              void send(input);
            }}
          >
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="例如：当前白名单有哪些车？"
              disabled={busy}
              aria-label="顾问问题"
            />
            <button type="submit" className="primary" disabled={busy || !input.trim()}>发送</button>
          </form>
        </div>
      ) : (
        <button
          type="button"
          className="advisor-fab"
          aria-expanded={false}
          aria-label="打开运维顾问"
          onPointerDown={floating.onPointerDown}
          onPointerMove={floating.onPointerMove}
          onPointerUp={(event) => {
            floating.onPointerUp(event);
            toggleOpen();
          }}
          onPointerCancel={floating.onPointerUp}
        >
          <Bot size={26} strokeWidth={2.2} aria-hidden="true" />
          <span className="advisor-fab-label">顾问</span>
        </button>
      )}
    </div>
  );
}
