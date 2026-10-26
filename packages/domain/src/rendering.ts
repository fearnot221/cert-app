import { createHash } from "node:crypto";
import { z } from "zod";
import {
  FONT_SHA256,
  IANSUI_SHA256,
  IANSUI_VERSION,
  CWTEX_FONTS,
  type CwtexFamily,
  FONT_ASSET_VERSION,
  RENDERER_VERSION,
  TemplateDocumentSchema,
  type CertificateData,
} from "@cert/contracts";
import { renderPdf } from "@cert/renderer/server";
import { db } from "./db.js";
import { storage } from "./storage.js";
const manifestSchema = z.object({
  font: z.object({
    version: z.literal(FONT_ASSET_VERSION),
    sha256: z.literal(FONT_SHA256),
  }),
  iansui: z
    .object({
      version: z.literal(IANSUI_VERSION),
      sha256: z.literal(IANSUI_SHA256),
    })
    .optional(),
  background: z
    .object({ id: z.string(), sha256: z.string(), vectorSha256: z.string().optional() })
    .nullable(),
  cwTeXKai: z.object({
    version: z.literal(`cwTeXKai-${CWTEX_FONTS.cwTeXKai.sha256.slice(0, 12)}`),
    sha256: z.literal(CWTEX_FONTS.cwTeXKai.sha256),
  }).optional(),
  cwTeXFangsong: z.object({
    version: z.literal(`cwTeXFangsong-${CWTEX_FONTS.cwTeXFangsong.sha256.slice(0, 12)}`),
    sha256: z.literal(CWTEX_FONTS.cwTeXFangsong.sha256),
  }).optional(),
});
export async function renderVersionPdf(
  version: {
    document: unknown;
    assetManifest: unknown;
    rendererVersion: string;
  },
  organizationId: string,
  data: CertificateData,
) {
  if (version.rendererVersion !== RENDERER_VERSION)
    throw new Error("此模板需要不同版本的 renderer，拒絕替換產證");
  const manifest = manifestSchema.parse(version.assetManifest);
  const document = TemplateDocumentSchema.parse(version.document);
  for (const family of Object.keys(CWTEX_FONTS) as CwtexFamily[]) {
    if (document.elements.some((e) => e.fontFamily === family) && !manifest[family])
      throw new Error(`缺少${CWTEX_FONTS[family].label}字型版本資訊`);
  }
  if (
    document.elements.some((e) => e.fontFamily === "Iansui") &&
    !manifest.iansui
  )
    throw new Error("缺少芫荽字型版本資訊");
  let background;
  if (document.backgroundAssetId) {
    if (manifest.background?.id !== document.backgroundAssetId)
      throw new Error("背景版本資訊不符");
    const asset = await db.asset.findFirst({
      where: { id: document.backgroundAssetId, organizationId },
    });
    if (!asset || asset.sha256 !== manifest.background.sha256)
      throw new Error("背景資產與發布時的版本不符");
    const bytes = await storage.get(asset.storageKey);
    if (
      createHash("sha256").update(bytes).digest("hex") !==
      manifest.background.sha256
    )
      throw new Error("背景資產完整性檢查失敗");
    let vector: Buffer | undefined;
    // Published from a PDF upload: draw on the vector page, not the PNG preview.
    if (manifest.background.vectorSha256) {
      if (
        !asset.vectorStorageKey ||
        asset.vectorSha256 !== manifest.background.vectorSha256
      )
        throw new Error("背景向量檔與發布時的版本不符");
      vector = await storage.get(asset.vectorStorageKey);
      if (
        createHash("sha256").update(vector).digest("hex") !==
        manifest.background.vectorSha256
      )
        throw new Error("背景向量檔完整性檢查失敗");
    }
    background = { id: asset.id, mimeType: asset.mimeType, bytes, vector };
  } else if (manifest.background) throw new Error("模板背景與發布版本不符");
  return renderPdf({ document, data, background });
}
