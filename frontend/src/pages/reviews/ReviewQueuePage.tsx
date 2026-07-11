import { useEffect, useState } from 'react';
import type { Review } from '../../services/api.js';
import * as opsClient from '../../services/opsClient.js';

export function ReviewQueuePage() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = async () => {
    setReviews(await opsClient.pendingReviews());
  };

  useEffect(() => {
    void refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '加载失败'));
  }, []);

  const resolve = async (review: Review, action: string) => {
    setBusyId(review.eventId);
    setError('');
    try {
      await opsClient.resolveReview(review.eventId, {
        action,
        plate: review.plate ?? undefined,
      });
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '处理失败');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>待人工审核</h1>
          <p>OCR 失败 / 低置信度事件队列</p>
        </div>
      </header>
      <section className="kpi-grid">
        <article className="kpi-card"><span>待审核</span><strong>{reviews.length}</strong></article>
        <article className="kpi-card"><span>今日新增</span><strong>{reviews.filter((item) => new Date(item.occurredAt).toDateString() === new Date().toDateString()).length}</strong></article>
        <article className="kpi-card"><span>超时未处理</span><strong>0</strong></article>
      </section>
      {error && <p className="error">{error}</p>}
      {reviews.length === 0 ? (
        <div className="empty-state">暂无待审核项</div>
      ) : (
        <div className="review-grid">
          {reviews.map((review) => (
            <article key={review.id} className="panel review-card">
              <div className="panel-heading">
                <h2>{review.plate || '未识别'}</h2>
                <span className="tag tag-warning">{review.reason}</span>
              </div>
              <p className="muted">{new Date(review.occurredAt).toLocaleString()} · {review.waypoint ?? '未知航点'} · {review.deviceName ?? '设备'}</p>
              {review.suggestion && <p>AI 建议：{review.suggestion}</p>}
              {review.evidenceUrl && (
                <img className="review-thumb" src={review.evidenceUrl} alt="证据截图" />
              )}
              <div className="button-row">
                <button type="button" className="primary" disabled={busyId === review.eventId} onClick={() => void resolve(review, 'confirm')}>确认</button>
                <button type="button" className="secondary" disabled={busyId === review.eventId} onClick={() => void resolve(review, 'false_positive')}>误报</button>
                <button type="button" className="secondary" disabled={busyId === review.eventId} onClick={() => void resolve(review, 'whitelist')}>加入白名单</button>
                <button type="button" className="secondary" disabled={busyId === review.eventId} onClick={() => void resolve(review, 'visitor')}>标记外来车</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
