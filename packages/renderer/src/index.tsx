import { useEffect, useRef, type CSSProperties } from "react";
import {
  FONT_SHA256,
  IANSUI_SHA256,
  interpolateText,
  type CertificateData,
  type TemplateDocument,
} from "@cert/contracts";
import { fitCertificateText } from "./layout";

export { fitCertificateText } from "./layout";
export const RENDER_FONT_FAMILY = `CertificateNotoTC_${FONT_SHA256.slice(0, 12)}`;

export const IANSUI_RENDER_FAMILY = `CertificateIansui_${IANSUI_SHA256.slice(0, 12)}`;
export interface CertificateViewProps {
  document: TemplateDocument;
  data: CertificateData;
  assetUrls: Record<string, string>;
  fontUrl: string;
  iansuiUrl?: string;
  onLayoutError?: (errors: string[]) => void;
}

/** URLs come from authorized application routes or in-memory server assets, never template JSON. */
function trustedAssetUrl(url: string, kind: "font" | "image"): string {
  const local = /^\/(?!\/)[A-Za-z0-9_./?=&%-]+$/.test(url);
  const embedded =
    kind === "font"
      ? /^data:font\/(?:ttf|otf|woff2);base64,[A-Za-z0-9+/=]+$/.test(url)
      : /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url);
  const blob = /^blob:https?:\/\/[^\s"'<>]+$/.test(url);
  if (!local && !embedded && !blob)
    throw new Error("渲染素材只能使用經授權的同源路徑或內嵌檔案");
  return url;
}

export function CertificateView({
  document: template,
  data,
  assetUrls,
  fontUrl,
  iansuiUrl = "/api/fonts/iansui",
  onLayoutError,
}: CertificateViewProps) {
  const root = useRef<HTMLDivElement>(null);
  const callback = useRef(onLayoutError);
  callback.current = onLayoutError;
  const signature = JSON.stringify([
    template,
    data,
    assetUrls,
    fontUrl,
    iansuiUrl,
  ]);
  const fontSource = trustedAssetUrl(fontUrl, "font");
  const backgroundSource = template.backgroundAssetId
    ? assetUrls[template.backgroundAssetId]
    : undefined;

  useEffect(() => {
    let cancelled = false;
    const fit = async () => {
      try {
        const loaded = await window.document.fonts.load(
          `400 12pt "${RENDER_FONT_FAMILY}"`,
        );
        if (loaded.length === 0) throw new Error("證書字型載入失敗");
        await window.document.fonts.load(`700 12pt "${RENDER_FONT_FAMILY}"`);
        if (template.elements.some((e) => e.fontFamily === "Iansui")) {
          const loadedIansui = await window.document.fonts.load(
            `400 12pt "${IANSUI_RENDER_FAMILY}"`,
          );
          if (!loadedIansui.length) throw new Error("芫荽字型載入失敗");
        }
        await window.document.fonts.ready;
        const images = [...(root.current?.querySelectorAll("img") ?? [])];
        await Promise.all(
          images.map(async (image) => {
            await image.decode();
            if (!image.naturalWidth) throw new Error("證書背景載入失敗");
          }),
        );
        if (!cancelled && root.current) {
          const errors = fitCertificateText(root.current);
          if (template.backgroundAssetId && !backgroundSource)
            errors.push("證書背景尚未載入");
          root.current.dataset.layoutStatus = errors.length ? "error" : "ready";
          callback.current?.(errors);
        }
      } catch (error) {
        if (!cancelled) {
          if (root.current) root.current.dataset.layoutStatus = "error";
          callback.current?.([
            error instanceof Error ? error.message : "證書素材載入失敗",
          ]);
        }
      }
    };
    void fit();
    return () => {
      cancelled = true;
    };
    // Signature tracks the serializable document, values, and authorized resources as one unit.
  }, [signature]);

  return (
    <div
      ref={root}
      data-certificate-page
      data-layout-status="loading"
      style={{
        width: `${template.widthMm}mm`,
        height: `${template.heightMm}mm`,
        position: "relative",
        backgroundColor: "#fff",
        flexShrink: 0,
        printColorAdjust: "exact",
        WebkitPrintColorAdjust: "exact",
        fontFamily: `"${RENDER_FONT_FAMILY}"`,
        fontSynthesis: "none",
        boxSizing: "border-box",
        color: "#203C39",
        lineHeight: 1.25,
      }}
    >
      <style>{`@font-face{font-family:"${RENDER_FONT_FAMILY}";src:url("${fontSource}") format("truetype");font-style:normal;font-weight:100 900;font-display:block;}`}</style>
      {template.elements.some((e) => e.fontFamily === "Iansui") && (
        <style>{`@font-face{font-family:"${IANSUI_RENDER_FAMILY}";src:url("${trustedAssetUrl(iansuiUrl, "font")}") format("truetype");font-weight:400;font-display:block;}`}</style>
      )}
      {backgroundSource && (
        <img
          src={trustedAssetUrl(backgroundSource, "image")}
          alt=""
          draggable={false}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            pointerEvents: "none",
          }}
        />
      )}
      {template.elements.map((element) => {
        const style: CSSProperties = {
          position: "absolute",
          left: `${element.x}mm`,
          top: `${element.y}mm`,
          width: `${element.width}mm`,
          height: `${element.height}mm`,
          transform: `rotate(${element.rotation}deg)`,
          transformOrigin: "center",
          fontFamily: `"${element.fontFamily === "Iansui" ? IANSUI_RENDER_FAMILY : RENDER_FONT_FAMILY}"`,
          fontSynthesis: "none",
          fontSize: `${element.fontSize}pt`,
          fontWeight: element.fontWeight,
          color: element.color,
          textAlign: element.align,
          lineHeight: 1.25,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          wordBreak: "normal",
          boxSizing: "border-box",
          margin: 0,
          padding: 0,
        };
        return (
          <div
            key={element.id}
            data-cert-text
            data-element-id={element.id}
            data-font-size={element.fontSize}
            data-min-font-size={element.minFontSize}
            style={style}
          >
            {interpolateText(element.text, data, { allowMissing: true })}
          </div>
        );
      })}
    </div>
  );
}
