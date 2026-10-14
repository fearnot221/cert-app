import { useEffect, useRef } from "react";
import { Cross2Icon, DownloadIcon } from "@radix-ui/react-icons";
import { Button } from "../../ui/Button";

export function PdfPreviewDialog({ preview, onClose }: { preview: { url: string; name: string }; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => URL.revokeObjectURL(preview.url);
  }, [preview]);
  const close = () => {
    dialog.current?.close();
    onClose();
  };
  return (
    <dialog ref={dialog} className="dialog pdf-dialog" onCancel={onClose} onClose={onClose} aria-labelledby="pdf-dialog-title">
      <header className="pdf-dialog-head">
        <div>
          <h2 id="pdf-dialog-title">{preview.name} 的 PDF 樣張</h2>
          <p className="field-help">由伺服器產出。若瀏覽器無法顯示 PDF，請下載樣張查看。</p>
        </div>
        <Button variant="quiet" size="icon" aria-label="關閉預覽" onClick={close}>
          <Cross2Icon />
        </Button>
      </header>
      <iframe title={`${preview.name} 的證書 PDF 預覽`} src={preview.url} />
      <footer className="dialog-actions pdf-dialog-foot">
        <Button asChild variant="quiet">
          <a href={preview.url} download="證書樣張.pdf">
            <DownloadIcon />
            下載樣張
          </a>
        </Button>
        <Button onClick={close}>完成檢查</Button>
      </footer>
    </dialog>
  );
}
