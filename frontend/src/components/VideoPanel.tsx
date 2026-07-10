import { ExternalLink } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export function VideoPanel({ host, port }: { host: string; port: number }) {
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const url = `http://${host}:${port}/index2`;
  useEffect(() => { setError(false); setLoaded(false); }, [url]);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const showError = () => setError(true);
    element.addEventListener('error', showError);
    return () => element.removeEventListener('error', showError);
  }, [url]);
  return <section className="panel video-panel"><div className="panel-heading"><h2>视频预览</h2><a href={url} target="_blank" rel="noreferrer" title="在新窗口打开视频"><ExternalLink size={16} /></a></div>
    {error ? <p className="error">浏览器无法加载视频服务。请确认小车地址、端口和浏览器嵌入限制。</p> : <><iframe ref={frame} title="小车视频预览" src={url} onLoad={() => setLoaded(true)} /><span className="sr-only" aria-live="polite">{loaded ? '视频页面已加载，视频流状态仍需人工确认' : '正在加载视频页面'}</span></>}
  </section>;
}
