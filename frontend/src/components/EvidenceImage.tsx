import { useState } from 'react';

type Props = {
  url?: string | null;
  alt?: string;
  className?: string;
};

/** Plate evidence image with click-to-expand lightbox for admin review. */
export function EvidenceImage({ url, alt = '车牌证据截图', className }: Props) {
  const [open, setOpen] = useState(false);
  if (!url) {
    return <p className="muted">暂无证据图片</p>;
  }

  return (
    <>
      <button
        type="button"
        className={`evidence-image-trigger ${className ?? ''}`.trim()}
        onClick={() => setOpen(true)}
        title="点击放大查看"
      >
        <img className="review-thumb evidence-image" src={url} alt={alt} />
        <span className="evidence-image-hint">点击放大</span>
      </button>
      {open && (
        <div
          className="evidence-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onClick={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
        >
          <img src={url} alt={alt} onClick={(event) => event.stopPropagation()} />
          <button type="button" className="secondary" onClick={() => setOpen(false)}>关闭</button>
        </div>
      )}
    </>
  );
}
