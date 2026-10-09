import sharp from "sharp";
import { Resvg } from "@resvg/resvg-js";
import { resolveCourseSvgFontFiles } from "./course-svg-fonts.js";
import { z } from "zod";
import { hasProviderCredentials } from "../env.js";
import { invokeMultimodalStructured } from "./multimodal-structured-native.js";
import { assertCourseSvgRenderable } from "./safe-svg.js";

export const COURSE_SVG_VISION_MODEL = "deepseek-flash";

/** Deliberately small production contract so the audit stays cheap and robust. */
export const courseSvgVisualAuditSchema = z.object({
  result: z.boolean(),
  reason: z.string().optional(),
});

export type CourseSvgVisualAudit = z.infer<typeof courseSvgVisualAuditSchema>;

export { resolveCourseSvgFontFiles } from "./course-svg-fonts.js";

export async function renderCourseSvgPreview(svg: string): Promise<{
  dataUrl: string;
  width: number;
  height: number;
}> {
  const normalized = assertCourseSvgRenderable(svg);
  const rasterized = new Resvg(normalized, {
    background: "#ffffff",
    font: {
      defaultFontFamily: "Noto Sans SC",
      fontFiles: resolveCourseSvgFontFiles(),
      loadSystemFonts: false,
    },
  }).render();
  const data = await sharp(rasterized.asPng(), { failOn: "error" })
    .resize({
      width: 1_024,
      height: 768,
      fit: "inside",
      withoutEnlargement: false,
    })
    .png()
    .toBuffer({ resolveWithObject: true });
  return {
    dataUrl: `data:image/png;base64,${data.data.toString("base64")}`,
    width: data.info.width,
    height: data.info.height,
  };
}

/**
 * Cold vision audit prompt. The auditor never sees gen history or SVG markup —
 * only this instruction, the teaching brief, and the rendered PNG.
 */
export const COURSE_SVG_AUDIT_PROMPT = `你是一名严谨、跨学科的教学图片审查员。现在给你的是一张已经渲染完成的图片。不要分析图片的制作格式、代码或实现方式，也不要生成替代图片。只根据教学要求和最终可见画面判断。

必须先检查“图片是否正确”，再检查“视觉上是否有问题”：
1. 找出教学要求中最重要的知识结论和必须可见的核心关系，直接核对图片中的对象、形状、位置、连接、方向、顺序和状态是否真正证明了它。核心关系错误、相反、缺失或含糊时，必须判定需要修正。
2. 检查内容完整性和专业正确性：对象身份与数量，结构与层级，包含与邻接，因果或数据流，步骤与时间顺序，状态变化，起点与终点，以及与主题有关的数学、科学或技术关系。不要套用无关领域的惯例。
3. 以画面为证据，不以文字声明为证据。标签、公式、标题、图例或角度标记写对了，不能掩盖实际形状、相对位置、连线、曲率或箭头画错。例如：要求弯折但画面近似直线、先后顺序箭头相反、子项画在父项外、连线接到错误对象，都属于内容错误。
4. 内容正确后，把文字可读性作为重点检查项：任何文字都不得与其他文字、图形、容器边框、连接线、箭头或画布边缘重叠、相交、贴压或互相遮挡。文字跨出所属容器、线条穿过文字、长句压住边框，以及标签虽可辨认但侵占其他对象空间，都必须判定需要修正。不要把“还能看清”当作通过标准。
5. 再检查其余视觉可用性：裁切、小字、低对比度、标签拥挤、层级混乱、对象难以辨认或意外融合、比例和对齐失衡、交点和锚点错误、曲线突折或鼓包、无意义交叉、留白不当，以及手机尺寸下是否容易理解。
6. 最后以较低优先级检查美观度和视觉完成度：构图是否平衡，间距和留白是否有节奏，线条、圆角、字体与图形样式是否一致，配色是否协调，是否存在明显粗糙、零碎或突兀之处。美观问题是必要检查项，但不得凌驾于知识正确性、结构和可读性之上。

输出前必须完成一次全图扫描，不得发现第一个问题就停止。不能仅因为要求中的对象都出现了或文字仍勉强可辨认就判定通过。不要仅因个人风格偏好要求修正；美观问题必须是画面中可定位、可描述并可验收的明显缺陷。

对箭头、连线或流程方向，必须沿每条线从无箭头的起点追踪到箭头所在的终点，用“对象 A → 对象 B”分别记录当前方向和目标方向。必须明确区分“需要改变”与“已经正确、必须保持”的连线；不得在某条线已经符合目标时仍笼统地要求“全部反转”或“都要改”。

若图片正确且没有文字遮挡、其他视觉可用性或明显美观缺陷，只返回 {"result":true}，省略 reason。否则返回 result=false；reason 是给下一轮基于原图修正时直接执行的修正合同，必须内部一致且覆盖全图扫描发现的所有可操作缺陷。必须使用以下顺序和标题："首要问题：[指出具体位置、当前画面实际显示了什么，以及它为何与教学要求冲突、会导致误解或形成明显视觉缺陷]。必须修正：[说明要改变哪些对象、形状、位置、连接、方向、顺序或样式，同时指出关联对象中哪些已正确并必须保持；尽量给出相对参照，禁止只写‘优化布局’或‘更美观’]。验收标准：[描述修正后的图片中可以直接观察并明确判断真假的条件]。次要问题：[按内容或结构、文字遮挡、其他视觉可用性、美观度的顺序列出其余所有具体问题；只有完成全图扫描且确无其他问题时才写‘无’]。" 首要问题必须优先选择内容、语义或结构错误；其后优先处理文字遮挡和其他影响理解的视觉问题；只有前两类均无问题时，才把最严重的美观问题放在首位。`;

/**
 * Production SVG audit. A missing DeepSeek key disables the optional pass
 * without affecting the original diagram. Each call is cold: fixed prompt +
 * teaching brief + rendered image only (no gen transcript).
 */
export async function auditCourseSvgIfConfigured(params: {
  svg: string;
  teachingBrief?: string;
  signal?: AbortSignal;
}): Promise<CourseSvgVisualAudit | null> {
  // Hosted reads DEEPSEEK_API_KEY directly. Desktop-local bridges the saved,
  // OS-encrypted DeepSeek credential into the same provider environment when
  // the sidecar starts, so this readiness check covers both topologies.
  if (!hasProviderCredentials("deepseek")) return null;

  const preview = await renderCourseSvgPreview(params.svg);
  const teachingBrief = params.teachingBrief?.trim().slice(0, 4_000);
  const audit = await invokeMultimodalStructured({
    operation: "unit.learning_material.svg_visual_audit",
    prompt: teachingBrief
      ? `${COURSE_SVG_AUDIT_PROMPT}\n\n教学要求（内容正确性的唯一依据）：\n${teachingBrief}`
      : COURSE_SVG_AUDIT_PROMPT,
    imageDataUrl: preview.dataUrl,
    imageDetail: "original",
    schema: courseSvgVisualAuditSchema,
    bindingName: "course_svg_visual_audit",
    // The repair contract must finish its verification and secondary-issue
    // sections. The former 320-token cap truncated real direction audits,
    // which made the next edit round guess at an incomplete instruction.
    maxTokens: 512,
    signal: params.signal,
    meta: {
      imageWidth: preview.width,
      imageHeight: preview.height,
      svgProductionAudit: true,
    },
    selection: {
      id: "deepseek",
      model: COURSE_SVG_VISION_MODEL,
      options: {
        chatModel: COURSE_SVG_VISION_MODEL,
        deepseekThinkingEnabled: false,
      },
    },
  });
  // Success feedback is not consumed by the repair path. Normalize it away in
  // case a provider still emits an explanation despite the prompt.
  return audit.result ? { result: true } : audit;
}
