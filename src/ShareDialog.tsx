import { useEffect, useRef, useState } from 'react';
import { Check, Download, Link2, Share2, X } from 'lucide-react';
import type { Report } from '../shared/schema';
import { renderShareCard, reportLink } from './share-card';

export function ShareDialog({
  report,
  publicLink,
  onClose,
}: {
  report: Report;
  publicLink: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const [card, setCard] = useState<{ blob: Blob; url: string } | null>(null);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const url = publicLink ? reportLink(report, location.origin) : null;
  const filename = `no-taste-${report.type}-${report.date}.png`;
  useEffect(() => {
    dialog.current?.showModal();
    let cancelled = false;
    let objectUrl: string | undefined;
    void renderShareCard(report, url)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setCard({ blob, url: objectUrl });
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          setMessage('图片生成失败，仍可复制链接分享。');
        }
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [report, url]);
  async function copyLink() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setMessage('链接已复制');
    } catch {
      linkInput.current?.focus();
      linkInput.current?.select();
      setMessage('请长按或复制下方已选中的链接。');
    }
  }
  async function share() {
    if (!card) return;
    const file = new File([card.blob], filename, { type: 'image/png' });
    const files = navigator.canShare?.({ files: [file] }) ? [file] : undefined;
    if (!files && !url) {
      setMessage('此浏览器不支持分享图片，请保存图片后发送。');
      return;
    }
    setSharing(true);
    try {
      await navigator.share({
        title: report.taste_comment.title,
        ...(url ? { url } : {}),
        ...(files ? { files } : {}),
      });
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError'))
        setMessage('未能打开系统分享，请复制链接或保存图片。');
    } finally {
      setSharing(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="share-dialog"
      aria-labelledby="share-title"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="share-content">
        <div className="modal-heading">
          <h2 id="share-title">分享这一期</h2>
          <button className="icon-button" onClick={onClose} aria-label="关闭分享" autoFocus>
            <X size={20} />
          </button>
        </div>
        <div className="share-preview" aria-busy={!card && !failed}>
          {card ? (
            <img src={card.url} alt={`${report.date} ${report.taste_comment.title} 分享卡片`} />
          ) : (
            <p role="status">{failed ? '暂时无法生成图片' : '正在准备封面…'}</p>
          )}
        </div>
        <div className="share-actions">
          {url && (
            <button className="secondary-button" onClick={() => void copyLink()}>
              {copied ? <Check size={17} /> : <Link2 size={17} />}
              {copied ? '已复制' : '复制链接'}
            </button>
          )}
          {card ? (
            <a className="primary-button" href={card.url} download={filename}>
              <Download size={17} />
              保存图片
            </a>
          ) : (
            <button className="primary-button" disabled>
              <Download size={17} />
              保存图片
            </button>
          )}
          {typeof navigator.share === 'function' && (
            <button
              className="secondary-button"
              disabled={!card || sharing}
              onClick={() => void share()}
            >
              <Share2 size={17} />
              更多分享
            </button>
          )}
        </div>
        {url ? (
          <input
            ref={linkInput}
            className="share-link"
            aria-label="本期分享链接"
            value={url}
            readOnly
            onFocus={(event) => event.target.select()}
          />
        ) : (
          <p className="share-hint">
            {report.demo ? '示例刊仅支持分享图片。' : '这份手记尚未公开，可保存图片分享。'}
          </p>
        )}
        <p className="share-message" role="status">
          {message}
        </p>
      </div>
    </dialog>
  );
}
