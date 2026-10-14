import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import {
  ArrowLeftIcon,
  PlusIcon,
  TextIcon,
  ImageIcon,
  CopyIcon,
  TrashIcon,
  UploadIcon,
  CheckIcon,
  MagnifyingGlassIcon,
} from "@radix-ui/react-icons";
import { CertificateView } from "@cert/renderer";
import { api, ApiError, orgPath, post } from "../lib/api";
import { useAction } from "../lib/hooks";
import type {
  Organization,
  Template,
  TemplateDocument,
  TextElement,
} from "../lib/types";
import { Alert, Status } from "../components/common";
import { Button } from "../components/ui/button";
import { previewData } from "./Templates";

const MM = 96 / 25.4;
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
  const [document, setDocument] = useState<TemplateDocument>(template.document);
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
  const [addField, setAddField] = useState("recipient_name");
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
      x: 40,
      y: 40,
      width: 120,
      height: 20,
      rotation: 0,
      fontFamily: "Noto Sans TC",
      fontSize: 24,
      minFontSize: 12,
      fontWeight: 400,
      color: "#203432",
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
      action.setSuccess("背景已上傳，請儲存草稿。");
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
              variant="outline"
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
      <div className="editor-feedback">
        <Alert message={action.error} />
        <Alert message={action.success} kind="success" />
        {conflict && (
          <Alert message="另一位編輯者已儲存更新。本次變更沒有覆蓋伺服器版本；請保留所需內容，返回列表重新開啟最新草稿後再編輯。" />
        )}
        <Alert message={qualityWarning} kind="info" />
        {layoutErrors.length > 0 && (
          <Alert message={`版面檢查未通過：${layoutErrors.join("；")}`} />
        )}
      </div>
      <div className="editor-layout">
        <aside className="editor-left">
          <section className="editor-section">
            <h2>新增元素</h2>
            <Button
              variant="outline"
              className="w-full justify-start"
              disabled={!canWrite}
              onClick={() => addText()}
            >
              <TextIcon />
              固定文字
            </Button>
            <label className="mt-4">
              動態欄位
              <select
                value={addField}
                onChange={(e) => setAddField(e.target.value)}
              >
                {document.fields.map((field) => (
                  <option key={field.key} value={field.key}>
                    {field.label}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="outline"
              className="w-full mt-2"
              disabled={!canWrite}
              onClick={() => addText(addField)}
            >
              <PlusIcon />
              加入動態文字
            </Button>
          </section>
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
                accept="image/png,image/jpeg,image/webp"
                disabled={!canWrite || action.busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                  e.target.value = "";
                }}
              />
            </label>
            <p className="field-help">
              PNG、JPG、WebP。背景會填滿整張紙，建議使用相同長寬比例。
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
                  <span>{element.text || "空白文字"}</span>
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
                  data={{
                    ...previewData,
                    organization_name: organization.name,
                  }}
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
              <label className="sr-only" htmlFor="zoom">
                畫布縮放
              </label>
              <select
                id="zoom"
                value={Math.round(scale * 100)}
                onChange={(e) => setScale(Number(e.target.value) / 100)}
              >
                {[
                  ...new Set([
                    25,
                    40,
                    50,
                    60,
                    75,
                    100,
                    Math.round(scale * 100),
                  ]),
                ]
                  .sort((a, b) => a - b)
                  .map((value) => (
                    <option key={value} value={value}>
                      {value}%
                    </option>
                  ))}
              </select>
              <Button size="sm" variant="ghost" onClick={fit}>
                適合畫面
              </Button>
            </div>
          </div>
        </section>
        <aside className="editor-right">
          <section className="editor-section">
            <h2>頁面設定</h2>
            <label>
              紙張尺寸
              <select
                disabled={!canWrite}
                value={
                  document.widthMm === 297 && document.heightMm === 210
                    ? "landscape"
                    : document.widthMm === 210 && document.heightMm === 297
                      ? "portrait"
                      : "custom"
                }
                onChange={(e) => {
                  if (e.target.value !== "custom")
                    resizePage(
                      e.target.value === "landscape" ? 297 : 210,
                      e.target.value === "landscape" ? 210 : 297,
                    );
                }}
              >
                <option value="landscape">A4 橫式</option>
                <option value="portrait">A4 直式</option>
                <option value="custom">自訂尺寸</option>
              </select>
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
          <section className="editor-section"><h2>公開驗證 QR Code</h2><label><input type="checkbox" checked={!!document.verificationQr} disabled={!canWrite} onChange={e => changeDocument(current => { const next = { ...current }; if (e.target.checked) next.verificationQr = { x: current.widthMm - 30, y: current.heightMm - 30, size: 22 }; else delete next.verificationQr; return next; })} />在證書上加入驗證 QR Code</label><p className="field-help">請保留白色邊界，避免文字或背景遮擋。樣張僅供檢查，正式 PDF 使用專屬連結。</p>{document.verificationQr && <div className="property-grid">{(['x','y','size'] as const).map(key => <NumberField key={key} label={key === 'size' ? 'QR 尺寸 mm' : `QR ${key.toUpperCase()} mm`} min={key === 'size' ? 20 : 0} max={key === 'size' ? 80 : 1000} value={document.verificationQr![key]} disabled={!canWrite} onChange={value => changeDocument(current => ({ ...current, verificationQr: { ...current.verificationQr!, [key]: value } }))} />)}</div>}</section>
          {selected ? (
            <section className="editor-section">
              <h2>文字屬性</h2>
              <fieldset disabled={!canWrite}>
                <label>
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
                <label>
                  字型
                  <select
                    value={selected.fontFamily}
                    onChange={(e) =>
                      updateElement(selected.id, {
                        fontFamily: e.target.value as TextElement["fontFamily"],
                        fontWeight: 400,
                      })
                    }
                  >
                    <option>Noto Sans TC</option>
                    <option value="Iansui">芫荽 Iansui</option>
                  </select>
                </label>
                <p className="field-help">開源字型 · 網頁與 PDF 共用同一版本</p>
                <div className="property-grid">
                  <label>
                    字重
                    <select
                      value={selected.fontWeight}
                      onChange={(e) =>
                        updateElement(selected.id, {
                          fontWeight: Number(e.target.value) as 400 | 700,
                        })
                      }
                    >
                      <option value={400}>標準 400</option>
                      {selected.fontFamily !== "Iansui" && (
                        <option value={700}>粗體 700</option>
                      )}
                    </select>
                  </label>
                  <label>
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
                <label>
                  文字對齊
                  <select
                    value={selected.align}
                    onChange={(e) =>
                      updateElement(selected.id, {
                        align: e.target.value as TextElement["align"],
                      })
                    }
                  >
                    <option value="left">靠左</option>
                    <option value="center">置中</option>
                    <option value="right">靠右</option>
                  </select>
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
                <div className="button-row mt-4">
                  <Button
                    size="sm"
                    variant="outline"
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
    <label>
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
