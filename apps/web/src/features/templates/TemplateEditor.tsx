import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import {
  ArrowLeftIcon,
  TextIcon,
  ImageIcon,
  CopyIcon,
  TrashIcon,
  UploadIcon,
  CheckIcon,
  MagnifyingGlassIcon,
} from "@radix-ui/react-icons";
import { CertificateView } from "@cert/renderer";
import { api, ApiError, orgPath, post } from "../../lib/api";
import { useAction, useResource } from "../../lib/hooks";
import type {
  Organization,
  Template,
  TemplateDocument,
  TextElement,
} from "../../lib/types";
import { Notice, Status } from "../../ui/feedback";
import { Button } from "../../ui/Button";
import { Select } from "../../ui/Select";
import { previewDataFor } from "./previewData";
import { FieldsPanel } from "./FieldsPanel";
import { withBuiltinFields } from "@cert/contracts";

const MM = 96 / 25.4;
/** The first vertical band of the given height, from the middle down, that no text box occupies. */
function freeBand(document: TemplateDocument, height: number) {
  const max = document.heightMm - height - 4;
  const taken = (y: number) =>
    document.elements.some((element) => y < element.y + element.height && y + height > element.y);
  for (let y = Math.round(document.heightMm / 2 - height / 2); y <= max; y += 6) if (!taken(y)) return y;
  for (let y = Math.round(document.heightMm / 2 - height / 2); y >= 4; y -= 6) if (!taken(y)) return y;
  return Math.round(document.heightMm / 2 - height / 2);
}
/** Layer names read in the designer's words: {{field_1}} shows as 〔課程時數〕. */
const layerName = (text: string, fields: TemplateDocument["fields"]) =>
  text.replace(/{{\s*([a-z][a-z0-9_]*)\s*}}/g, (all, key: string) => {
    const field = fields.find((f) => f.key === key);
    return field ? `〔${field.label}〕` : all;
  }) || "空白文字";
export function TemplateEditor({
  organization,
  permissions,
  template,
  onDirty,
  onClose,
}: {
  organization: Organization;
  permissions: string[];
  template: Template;
  onDirty: (dirty: boolean) => void;
  onClose: () => void;
}) {
  // Older templates predate some built-in fields (such as the serial number); add them on open.
  const [document, setDocument] = useState<TemplateDocument>(() => withBuiltinFields(template.document));
  const serial = useResource<{ nextNumber: string }>(orgPath(organization.id, "/settings/serial"));
  const sampleData = previewDataFor(document, organization.name, serial.data?.nextNumber);
  const [name, setName] = useState(template.name);
  const [revision, setRevision] = useState(template.revision);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState(template.status);
  const [selectedId, setSelectedId] = useState<string | null>(
    template.document.elements[0]?.id ?? null,
  );
  const [scale, setScale] = useState(0.6);
  const [layoutErrors, setLayoutErrors] = useState<string[]>([]);
  const [conflict, setConflict] = useState(false);
  const [qualityWarning, setQualityWarning] = useState("");
  const action = useAction();
  const canvasArea = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    id: string;
  } | null>(null);
  const selected = document.elements.find(
    (element) => element.id === selectedId,
  );
  const canWrite = permissions.includes("templates.write");
  const canPublish = permissions.includes("templates.publish");
  const changed = useCallback(() => {
    setDirty(true);
    onDirty(true);
    action.setSuccess("");
  }, [onDirty]);
  const changeDocument = (
    update:
      TemplateDocument | ((current: TemplateDocument) => TemplateDocument),
  ) => {
    setDocument(update);
    changed();
  };
  const resizePage = (widthMm: number, heightMm: number) =>
    changeDocument((current) => {
      const scale = Math.min(
        widthMm / current.widthMm,
        heightMm / current.heightMm,
      );
      const round = (value: number) => Math.round(value * 100) / 100;
      const offsetX = (widthMm - current.widthMm * scale) / 2;
      const offsetY = (heightMm - current.heightMm * scale) / 2;
      return {
        ...current,
        widthMm,
        heightMm,
        ...(current.verificationQr ? { verificationQr: { ...current.verificationQr, x: Math.min(current.verificationQr.x, widthMm - current.verificationQr.size), y: Math.min(current.verificationQr.y, heightMm - current.verificationQr.size) } } : {}),
        elements: current.elements.map((element) => ({
          ...element,
          x: round(element.x * scale + offsetX),
          y: round(element.y * scale + offsetY),
          width: round(element.width * scale),
          height: round(element.height * scale),
          fontSize: round(Math.max(6, element.fontSize * scale)),
          minFontSize: round(Math.max(6, element.minFontSize * scale)),
        })),
      };
    });
  const updateElement = (id: string, updates: Partial<TextElement>) =>
    changeDocument((current) => ({
      ...current,
      elements: current.elements.map((element) =>
        element.id === id ? { ...element, ...updates } : element,
      ),
    }));
  const fit = useCallback(() => {
    if (canvasArea.current) {
      const width = canvasArea.current.clientWidth - 60;
      const height = Math.max(
        260,
        Math.min(
          680,
          window.innerHeight -
            canvasArea.current.getBoundingClientRect().top -
            100,
        ),
      );
      setScale(
        Math.min(
          0.9,
          Math.max(
            0.15,
            Math.min(
              width / (document.widthMm * MM),
              height / (document.heightMm * MM),
            ),
          ),
        ),
      );
    }
  }, [document.widthMm, document.heightMm]);
  useEffect(() => {
    fit();
    const observer = new ResizeObserver(fit);
    if (canvasArea.current) observer.observe(canvasArea.current);
    return () => observer.disconnect();
  }, [fit]);
  const handleLayoutErrors = useCallback(
    (errors: string[]) =>
      setLayoutErrors((current) =>
        current.join("\n") === errors.join("\n") ? current : errors,
      ),
    [],
  );
  const save = async () => {
    const saved = await api<Template>(
      orgPath(organization.id, `/templates/${template.id}`),
      { method: "PUT", body: JSON.stringify({ name, document, revision }) },
    );
    setRevision(saved.revision);
    setStatus(saved.status);
    setDirty(false);
    onDirty(false);
    setConflict(false);
    action.setSuccess("草稿已儲存。");
  };
  const saveAction = () =>
    void action.run(async () => {
      try {
        await save();
      } catch (error) {
        if (error instanceof ApiError && error.status === 409)
          setConflict(true);
        throw error;
      }
    });
  const publish = () =>
    void action.run(async () => {
      if (dirty) throw new Error("請先儲存目前草稿，再發布新版本。");
      await post(orgPath(organization.id, `/templates/${template.id}/publish`));
      setStatus("published");
      action.setSuccess("已發布不可變的新版本，現在可以用於發證活動。");
    });
  const addText = (field?: string) => {
    const id = crypto.randomUUID();
    const element: TextElement = {
      id,
      type: "text",
      // New text lands centred, on the first free band from the middle of the sheet down.
      x: Math.round((document.widthMm - 120) / 2),
      y: freeBand(document, 20),
      width: 120,
      height: 20,
      rotation: 0,
      fontFamily: "Noto Sans TC",
      fontSize: 24,
      minFontSize: 12,
      fontWeight: 400,
      color: "#363535",
      align: "center",
      text: field ? `{{${field}}}` : "新增文字",
    };
    changeDocument((current) => ({
      ...current,
      elements: [...current.elements, element],
    }));
    setSelectedId(id);
  };
  const startDrag = (
    event: PointerEvent<HTMLButtonElement>,
    element: TextElement,
  ) => {
    setSelectedId(element.id);
    if (!canWrite || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: element.x,
      y: element.y,
      id: element.id,
    };
  };
  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const current = drag.current;
    const element = document.elements.find((item) => item.id === current.id)!;
    updateElement(current.id, {
      x:
        Math.round(
          Math.max(
            0,
            Math.min(
              document.widthMm - element.width,
              current.x + (event.clientX - current.startX) / (MM * scale),
            ),
          ) * 10,
        ) / 10,
      y:
        Math.round(
          Math.max(
            0,
            Math.min(
              document.heightMm - element.height,
              current.y + (event.clientY - current.startY) / (MM * scale),
            ),
          ) * 10,
        ) / 10,
    });
  };
  const upload = async (file: File) => {
    await action.run(async () => {
      const body = new FormData();
      body.set("file", file);
      const asset = await api<{
        id: string;
        mimeType: string;
        width: number;
        height: number;
        source?: "pdf";
        pdfPages?: number;
      }>(orgPath(organization.id, "/assets"), { method: "POST", body });
      changeDocument((current) => ({
        ...current,
        backgroundAssetId: asset.id,
      }));
      const dpi = Math.min(
        asset.width / (document.widthMm / 25.4),
        asset.height / (document.heightMm / 25.4),
      );
      setQualityWarning(
        dpi < 150
          ? `背景約 ${Math.round(dpi)} DPI，列印可能不夠清晰。建議使用 150 DPI 以上圖片。`
          : "",
      );
      action.setSuccess(
        asset.source === "pdf"
          ? `PDF 已轉為背景圖${(asset.pdfPages ?? 1) > 1 ? `（共 ${asset.pdfPages} 頁，使用第 1 頁）` : ""}，請儲存草稿。`
          : "背景已上傳，請儲存草稿。",
      );
    });
  };
  return (
    <div className="editor">
      <header className="editor-toolbar">
        <Button
          variant="ghost"
          size="icon"
          aria-label="返回模板列表"
          onClick={onClose}
        >
          <ArrowLeftIcon />
        </Button>
        <div className="editor-title">
          <label className="sr-only" htmlFor="template-name">
            模板名稱
          </label>
          <input
            id="template-name"
            value={name}
            disabled={!canWrite}
            maxLength={120}
            onChange={(e) => {
              setName(e.target.value);
              changed();
            }}
          />
          <div>
            <Status value={status} />
            <span>
              {dirty ? "有尚未儲存的變更" : `草稿修訂 ${revision} · 已儲存`}
            </span>
          </div>
        </div>
        <div className="editor-actions">
          {canWrite && (
            <Button
              variant="quiet"
              disabled={action.busy || !dirty || !name.trim() || conflict}
              onClick={saveAction}
            >
              {action.busy ? "處理中…" : "儲存草稿"}
            </Button>
          )}
          {canPublish && (
            <Button
              disabled={
                action.busy || dirty || conflict || layoutErrors.length > 0
              }
              onClick={publish}
            >
              <CheckIcon />
              發布版本
            </Button>
          )}
        </div>
      </header>
      <div className="editor-layout">
        <aside className="editor-left">
          <section className="editor-section">
            <h2>新增元素</h2>
            <Button
              variant="quiet"
              className="btn-block editor-add"
              disabled={!canWrite}
              onClick={() => addText()}
            >
              <TextIcon />
              固定文字
            </Button>
          </section>
          <FieldsPanel
            document={document}
            canWrite={canWrite}
            onInsert={(key) => addText(key)}
            onChange={changeDocument}
          />
          <section className="editor-section">
            <h2>背景圖片</h2>
            <label
              className={`upload-control ${!canWrite || action.busy ? "disabled" : ""}`}
            >
              <UploadIcon />
              <span>
                {document.backgroundAssetId ? "更換背景" : "上傳背景圖片"}
              </span>
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                disabled={!canWrite || action.busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                  e.target.value = "";
                }}
              />
            </label>
            <p className="field-help">
              PDF、PNG、JPG、WebP。PDF 使用第一頁；背景會填滿整張紙，建議使用相同長寬比例。
            </p>
            {document.backgroundAssetId && canWrite && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  changeDocument((current) => {
                    const next = { ...current };
                    delete next.backgroundAssetId;
                    return next;
                  })
                }
              >
                移除背景
              </Button>
            )}
          </section>
          <section className="editor-section layer-section">
            <h2>
              圖層 <span>{document.elements.length}</span>
            </h2>
            <div className="layer-list">
              {[...document.elements].reverse().map((element, index) => (
                <button
                  key={element.id}
                  className={`layer-item ${selectedId === element.id ? "selected" : ""}`}
                  onClick={() => setSelectedId(element.id)}
                >
                  <TextIcon />
                  <span>{layerName(element.text, document.fields)}</span>
                  <small>{document.elements.length - index}</small>
                </button>
              ))}
              <div className="layer-item background-layer">
                <ImageIcon />
                <span>背景</span>
                <small>鎖定</small>
              </div>
            </div>
          </section>
        </aside>
        <section
          className="canvas-workspace"
          aria-label="證書畫布"
          ref={canvasArea}
        >
          <div className="editor-feedback">
            <Notice message={action.error} />
            <Notice message={action.success} kind="success" />
            {conflict && (
              <Notice message="另一位編輯者已儲存更新。本次變更沒有覆蓋伺服器版本；請保留所需內容，返回列表重新開啟最新草稿後再編輯。" />
            )}
            <Notice message={qualityWarning} kind="info" />
            {layoutErrors.length > 0 && (
              <Notice message={`版面檢查未通過：${layoutErrors.join("；")}`} />
            )}
          </div>
          <div className="canvas-topline">
            <span>
              {document.widthMm} × {document.heightMm} mm
            </span>
            <span>示範資料預覽</span>
          </div>
          <div className="canvas-scroll">
            <div
              className="canvas-scaled-box"
              style={{
                width: document.widthMm * MM * scale,
                height: document.heightMm * MM * scale,
              }}
            >
              <div
                className="canvas-sheet"
                data-testid="certificate-canvas"
                style={{
                  width: `${document.widthMm}mm`,
                  height: `${document.heightMm}mm`,
                  transform: `scale(${scale})`,
                }}
              >
                <CertificateView
                  document={document}
                  data={sampleData}
                  assetUrls={
                    document.backgroundAssetId
                      ? {
                          [document.backgroundAssetId]: `/api${orgPath(organization.id, `/assets/${document.backgroundAssetId}/file`)}`,
                        }
                      : {}
                  }
                  fontUrl="/api/fonts/noto-sans-tc"
                  onLayoutError={handleLayoutErrors}
                />
                <div className="element-handles">
                  {document.elements.map((element) => (
                    <button
                      key={element.id}
                      type="button"
                      className={`element-handle ${selectedId === element.id ? "selected" : ""}`}
                      aria-label={`選取或移動：${element.text}`}
                      style={{
                        left: `${element.x}mm`,
                        top: `${element.y}mm`,
                        width: `${element.width}mm`,
                        height: `${element.height}mm`,
                        transform: `rotate(${element.rotation}deg)`,
                      }}
                      onPointerDown={(event) => startDrag(event, element)}
                      onPointerMove={moveDrag}
                      onPointerUp={() => {
                        drag.current = null;
                      }}
                      onPointerCancel={() => {
                        drag.current = null;
                      }}
                      onKeyDown={(event) => {
                        if (
                          !canWrite ||
                          ![
                            "ArrowLeft",
                            "ArrowRight",
                            "ArrowUp",
                            "ArrowDown",
                          ].includes(event.key)
                        )
                          return;
                        event.preventDefault();
                        const step = event.shiftKey ? 5 : 1;
                        updateElement(element.id, {
                          x: Math.max(
                            0,
                            Math.min(
                              document.widthMm - element.width,
                              element.x +
                                (event.key === "ArrowLeft"
                                  ? -step
                                  : event.key === "ArrowRight"
                                    ? step
                                    : 0),
                            ),
                          ),
                          y: Math.max(
                            0,
                            Math.min(
                              document.heightMm - element.height,
                              element.y +
                                (event.key === "ArrowUp"
                                  ? -step
                                  : event.key === "ArrowDown"
                                    ? step
                                    : 0),
                            ),
                          ),
                        });
                      }}
                    >
                      <span className="selection-corner top-left" />
                      <span className="selection-corner bottom-right" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="canvas-bottom">
            <span>拖曳文字移動 · 方向鍵微調 1 mm</span>
            <div className="zoom-control">
              <MagnifyingGlassIcon />
              <Select
                variant="bare"
                label="畫布縮放"
                value={String(Math.round(scale * 100))}
                onChange={(value) => setScale(Number(value) / 100)}
                options={[...new Set([25, 40, 50, 60, 75, 100, Math.round(scale * 100)])]
                  .sort((a, b) => a - b)
                  .map((value) => ({ value: String(value), label: `${value}%` }))}
              />
              <Button size="sm" variant="ghost" onClick={fit}>
                適合畫面
              </Button>
            </div>
          </div>
        </section>
        <aside className="editor-right">
          <section className="editor-section">
            <h2>頁面設定</h2>
            <label className="field">
              紙張尺寸
              <Select
                label="紙張尺寸"
                disabled={!canWrite}
                value={
                  document.widthMm === 297 && document.heightMm === 210
                    ? "landscape"
                    : document.widthMm === 210 && document.heightMm === 297
                      ? "portrait"
                      : "custom"
                }
                onChange={(value) => {
                  if (value !== "custom")
                    resizePage(value === "landscape" ? 297 : 210, value === "landscape" ? 210 : 297);
                }}
                options={[
                  { value: "landscape", label: "A4 橫式" },
                  { value: "portrait", label: "A4 直式" },
                  { value: "custom", label: "自訂尺寸" },
                ]}
              />
            </label>
            <div className="property-grid">
              <NumberField
                label="紙寬 mm"
                value={document.widthMm}
                disabled={!canWrite}
                min={50}
                max={500}
                onChange={(value) => resizePage(value, document.heightMm)}
              />
              <NumberField
                label="紙高 mm"
                value={document.heightMm}
                disabled={!canWrite}
                min={50}
                max={500}
                onChange={(value) => resizePage(document.widthMm, value)}
              />
            </div>
          </section>
          <section className="editor-section"><h2>公開驗證 QR Code</h2><label className="check"><input type="checkbox" checked={!!document.verificationQr} disabled={!canWrite} onChange={e => changeDocument(current => { const next = { ...current }; if (e.target.checked) next.verificationQr = { x: current.widthMm - 30, y: current.heightMm - 30, size: 22 }; else delete next.verificationQr; return next; })} />在證書上加入驗證 QR Code</label><p className="field-help">請保留白色邊界，避免文字或背景遮擋。樣張僅供檢查，正式 PDF 使用專屬連結。</p>{document.verificationQr && <div className="property-grid">{(['x','y','size'] as const).map(key => <NumberField key={key} label={key === 'size' ? 'QR 尺寸 mm' : `QR ${key.toUpperCase()} mm`} min={key === 'size' ? 20 : 0} max={key === 'size' ? 80 : 1000} value={document.verificationQr![key]} disabled={!canWrite} onChange={value => changeDocument(current => ({ ...current, verificationQr: { ...current.verificationQr!, [key]: value } }))} />)}</div>}</section>
          {selected ? (
            <section className="editor-section">
              <h2>文字屬性</h2>
              <fieldset disabled={!canWrite}>
                <label className="field">
                  文字內容
                  <textarea
                    rows={3}
                    value={selected.text}
                    onChange={(e) =>
                      updateElement(selected.id, { text: e.target.value })
                    }
                  />
                </label>
                <p className="field-help">
                  動態內容使用 {"{{欄位名稱}}"}，可在左側選擇既有欄位。
                </p>
                <div className="property-grid">
                  <NumberField
                    label="X 位置 mm"
                    value={selected.x}
                    min={0}
                    max={document.widthMm}
                    onChange={(x) => updateElement(selected.id, { x })}
                  />
                  <NumberField
                    label="Y 位置 mm"
                    value={selected.y}
                    min={0}
                    max={document.heightMm}
                    onChange={(y) => updateElement(selected.id, { y })}
                  />
                  <NumberField
                    label="寬度 mm"
                    value={selected.width}
                    min={1}
                    max={document.widthMm}
                    onChange={(width) => updateElement(selected.id, { width })}
                  />
                  <NumberField
                    label="高度 mm"
                    value={selected.height}
                    min={1}
                    max={document.heightMm}
                    onChange={(height) =>
                      updateElement(selected.id, { height })
                    }
                  />
                  <NumberField
                    label="旋轉角度"
                    value={selected.rotation}
                    min={-180}
                    max={180}
                    onChange={(rotation) =>
                      updateElement(selected.id, { rotation })
                    }
                  />
                  <NumberField
                    label="字級 pt"
                    value={selected.fontSize}
                    min={6}
                    max={144}
                    onChange={(fontSize) =>
                      updateElement(selected.id, { fontSize })
                    }
                  />
                </div>
                <label className="field">
                  字型
                  <Select
                    label="字型"
                    value={selected.fontFamily}
                    onChange={(value) =>
                      updateElement(selected.id, {
                        fontFamily: value as TextElement["fontFamily"],
                        fontWeight: 400,
                      })
                    }
                    options={[
                      { value: "Noto Sans TC", label: "Noto Sans TC" },
                      { value: "Iansui", label: "芫荽 Iansui" },
                    ]}
                  />
                </label>
                <p className="field-help">開源字型 · 網頁與 PDF 共用同一版本</p>
                <div className="property-grid">
                  <label className="field">
                    字重
                    <Select
                      label="字重"
                      value={String(selected.fontWeight)}
                      onChange={(value) =>
                        updateElement(selected.id, {
                          fontWeight: Number(value) as 400 | 700,
                        })
                      }
                      options={[
                        { value: "400", label: "標準 400" },
                        ...(selected.fontFamily !== "Iansui" ? [{ value: "700", label: "粗體 700" }] : []),
                      ]}
                    />
                  </label>
                  <label className="field">
                    文字顏色
                    <input
                      type="color"
                      value={selected.color}
                      onChange={(e) =>
                        updateElement(selected.id, { color: e.target.value })
                      }
                    />
                  </label>
                </div>
                <label className="field">
                  文字對齊
                  <Select
                    label="文字對齊"
                    value={selected.align}
                    onChange={(value) =>
                      updateElement(selected.id, {
                        align: value as TextElement["align"],
                      })
                    }
                    options={[
                      { value: "left", label: "靠左" },
                      { value: "center", label: "置中" },
                      { value: "right", label: "靠右" },
                    ]}
                  />
                </label>
                <NumberField
                  label="自動縮字下限 pt"
                  value={selected.minFontSize}
                  min={6}
                  max={selected.fontSize}
                  onChange={(minFontSize) =>
                    updateElement(selected.id, { minFontSize })
                  }
                />
                <p className="field-help">
                  長文字會換行並縮小。仍無法放入文字框時，正式產證會被阻止。
                </p>
                <div className="btn-row">
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() => {
                      const id = crypto.randomUUID();
                      changeDocument((current) => ({
                        ...current,
                        elements: [
                          ...current.elements,
                          {
                            ...selected,
                            id,
                            x: Math.min(
                              selected.x + 5,
                              document.widthMm - selected.width,
                            ),
                            y: Math.min(
                              selected.y + 5,
                              document.heightMm - selected.height,
                            ),
                          },
                        ],
                      }));
                      setSelectedId(id);
                    }}
                  >
                    <CopyIcon />
                    複製
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="danger-text"
                    onClick={() => {
                      changeDocument((current) => ({
                        ...current,
                        elements: current.elements.filter(
                          (element) => element.id !== selected.id,
                        ),
                      }));
                      setSelectedId(null);
                    }}
                  >
                    <TrashIcon />
                    刪除
                  </Button>
                </div>
              </fieldset>
            </section>
          ) : (
            <div className="editor-section">
              <p className="field-help">
                選擇畫布上的文字或左側圖層，即可編輯屬性。
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  disabled,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const number = Number(draft);
    if (!draft.trim() || !Number.isFinite(number)) {
      setDraft(String(value));
      return;
    }
    const bounded = Math.max(
      min ?? -Infinity,
      Math.min(max ?? Infinity, number),
    );
    setDraft(String(bounded));
    if (bounded !== value) onChange(bounded);
  };
  return (
    <label className="field">
      {label}
      <input
        type="number"
        value={draft}
        step="0.1"
        min={min}
        max={max}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
  );
}
