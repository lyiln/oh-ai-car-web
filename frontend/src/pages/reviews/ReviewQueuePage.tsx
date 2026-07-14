import { useEffect, useState } from 'react';
import { EvidenceImage } from '../../components/EvidenceImage.js';
import type { PlateMatchInfo, Review } from '../../services/api.js';
import * as opsClient from '../../services/opsClient.js';
import { useAuth } from '../../contexts/AuthContext.js';

function plateMatchLabel(match: PlateMatchInfo): string {
  if (match.mode === 'exact') {
    return `精确匹配白名单：${match.matchedPlate}`;
  }
  const direction =
    match.direction === 'whitelist_in_scan'
      ? '白名单包含在扫描结果中'
      : '扫描片段命中白名单';
  const fragment = match.fragment ? `（片段 ${match.fragment}）` : '';
  return `模糊匹配到 ${match.matchedPlate}${fragment} · ${direction}`;
}

function reviewReasonLabel(reason: string): string {
  if (reason === 'console_scan_test') return '控制台识别测试';
  if (reason === 'low_confidence') return '低置信度';
  return reason;
}

export function ReviewQueuePage() {
  const { user } = useAuth();
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
          <p>对照小车上传的车牌截图，确认 OCR 结果或误报</p>
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
                <span className="tag tag-warning">{reviewReasonLabel(review.reason)}</span>
              </div>
              <p className="muted">{new Date(review.occurredAt).toLocaleString()} · {review.waypoint ?? '未知航点'} · {review.deviceName ?? '设备'}</p>
              {typeof review.confidence === 'number' && (
                <p className="muted">识别置信度 {(review.confidence * 100).toFixed(0)}%</p>
              )}
              {review.plateMatch ? (
                <p className="plate-match-hint">
                  <span className="tag tag-success">匹配依据</span>
                  {' '}
                  OCR：{review.plate || '—'} → {plateMatchLabel(review.plateMatch)}
                </p>
              ) : (
                <p className="muted">未命中白名单模糊/精确匹配，请对照证据图人工判断</p>
              )}
              {review.suggestion && <p>AI 建议：{review.suggestion}</p>}
              <EvidenceImage url={review.evidenceUrl} alt={`证据 ${review.plate || '未识别'}`} />
              <div className="button-row">
                <button type="button" className="primary" disabled={busyId === review.eventId} onClick={() => void resolve(review, 'confirm')}>确认违规</button>
                <button type="button" className="secondary" disabled={busyId === review.eventId} onClick={() => void resolve(review, 'false_positive')}>误报</button>
                {user?.role === 'admin' && (
                  <button type="button" className="secondary" disabled={busyId === review.eventId} onClick={() => void resolve(review, 'whitelist')}>加入白名单</button>
                )}
                <button type="button" className="secondary" disabled={busyId === review.eventId} onClick={() => void resolve(review, 'visitor')}>标记外来车</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
