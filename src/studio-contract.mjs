/**
 * 影棚拍摄层与真实感契约。
 *
 * 这些文本来自 PoseWear 人物资产工程里已经过实拍校准的规则
 * （workflow/asset_flow.py 的 studio_contract / makeup_expression_contract，
 * 以及 docs/prompt-guides/ai-realism-prompt-guide.md）。
 *
 * 关键修正：旧契约写的是 "shadowless studio lighting ... no dark patch on the floor"，
 * 实测会把整幅画面压成一张平灰的贴纸，人物像剪下来贴在背景上。
 * 现在的规则是：无缝棚、墙接近纯白、地面比墙暗 5–9%、鞋下有柔和接触影。
 */

/** 构图与空间：按 1024x1536 画布给出可直接核对的像素位置。 */
export function framingContract({ width = 1024, height = 1536, standing = true } = {}) {
  if (!standing) {
    return [
      'FRAMING:',
      '- tall 2:3 full-body vertical photograph; frame the entire posed figure, including outstretched hands and feet, with clear margins on all sides',
      '- choose the camera height for the seated, crouching or reclining figure; allow foreshortening and overlap, not a stretched standing silhouette',
    ];
  }
  const topPx = Math.round(height * 0.165);
  const topPxHigh = Math.round(height * 0.185);
  const solePx = Math.round(height * 0.93);
  const solePxLow = Math.round(height * 0.95);
  return [
    'FRAMING:',
    '- tall 2:3 full-body vertical photograph; the figure occupies about 76-82% of the frame height, so roughly the top sixth stays clean air above the hair and about 5% of visible floor stays below the feet (or worn shoes); both sides keep clear margin around the arms; never fill the frame edge to edge',
    `- FRAMING IN PIXELS: in this ${width}x${height} frame the hair top sits around y=${topPx}-${topPxHigh} and the lowest sole around y=${solePx}-${solePxLow}; never let the feet or worn shoes touch or cross the bottom edge`,
    '- SPACE: the camera stands 3.5-4.5 m away at waist height with a slight upward angle, 50-70 mm equivalent lens and minimal wide-angle distortion; preserve the leg length of the person in reference image 1 without stretching',
  ];
}

/** 地面、色调与接地：这是修掉「无影棚=平贴纸」的核心段落。 */
export function floorAndToneContract({ cleanWhite = true, standing = true } = {}) {
  const calibrated = cleanWhite && standing;
  return [
    'FLOOR PLANE:',
    ...(calibrated ? [
      '- one continuous cyclorama where the floor meets the wall without a hard line; the wall behind the model stays near-white and the floor reads only a few percent darker (about 5-9% lower luminance at the bottom edge than at the top), fading in gradually across the lower fifth so she stands in a space instead of floating on a cut-out',
      '- no visible horizon seam and no grey backdrop card',
      'TONE:',
      '- the wall behind her stays 246-255, essentially white and never grey; only the floor falls to about 228-238 at the bottom edge',
      '- a mid-grey backdrop, a dark gradient behind the head, a heavy vignette or an evenly grey card is wrong even if it adds depth',
    ] : ['- retain the selected backdrop colour across the seamless floor, with a gentle tonal falloff and no visible horizon seam']),
    'CONTACT AND OCCLUSION:',
    standing
      ? '- a soft, very low-contrast shadow pools under each grounded bare foot or worn shoe, with a faint core where the sole meets the floor; do not add shoes for the shadow'
      : '- a soft, very low-contrast shadow forms only where the body or clothing touches the floor in the selected pose, including footwear if grounded',
    '- keep gentle occlusion and soft edges where the clothing meets the body',
    '- no hard shadow edge, no long cast shadow across the background, no heavy vignette, no ambient-occlusion halo, and never a fully shadowless pasted look',
  ];
}

/** 影棚灯光。 */
export function studioLightingContract() {
  return [
    'LIGHTING:',
    '- place one large soft key light slightly above eye level and to one side of the posed subject; the cheek turns softly into shadow and raised seams catch that same light',
    '- use weaker fill from the opposite side so the visible face and the garment stay readable together: retain detail in dark folds and keep pale fabric distinct from the backdrop',
    '- use neutral white balance for skin and garment colours; the seamless backdrop keeps its selected colour. Keep props, windows and light stands out of frame',
    '- locked camera, framing, exposure, white balance and light position for this shot',
  ];
}

/**
 * 真人感：把「不完美」写成可执行的观察项，而不是加噪点或磨皮。
 * 依据 ai-realism-prompt-guide.md 的通用原则与固定室内镜拍版。
 */
export function realismContract({ scene = 'studio' } = {}) {
  if (scene === 'preserve') {
    return [
      'REALISM:',
      '- match the visible skin texture, hair detail, focus and grain of reference image 1; keep existing occlusion and never invent hidden facial detail',
      '- let irregular folds and soft contact shadows follow the unchanged pose and original light; no plastic sheen or cut-out edges',
    ];
  }
  return [
    'REALISM:',
    '- at full-body distance keep only the skin and hair detail the camera resolves; hair may overlap cheek or collar',
    '- apply the facial cues only where visible. For hidden features, do not uncover or reconstruct them: leave hands and hair in place and do not turn the face frontal to show both eyes',
    '- show only the fingers visible from this angle; weight rests at the actual support points. Fabric compresses there and hangs in irregular folds elsewhere',
  ];
}

/** 明确列出会毁掉真实感的失败模式，放在提示词末尾更有效。 */
export function realismAntiPatterns() {
  return [
    'AVOID:',
    '- no plastic skin, painted-on glow, fused fingers, uniform creases, CGI-sharp edges or mannequin stiffness',
  ];
}

/**
 * 身份锁定：脸、发型、身体比例、肤色都必须来自人物参考，
 * 不允许「美化」成另一个人。这是模特一致性最重要的段落。
 */
export function identityLockContract({ builtinStudio = false } = {}) {
  return [
    ...(builtinStudio ? [
      'IDENTITY LOCK (same person in both views):',
      '- keep the face from reference image 2: its length and width, midface length, chin length, jawline, brows, nose and lips. Keep its eye spacing and natural eye opening (height and width); gaze and perspective change their appearance, not their anatomy',
      '- follow reference image 2 for the hair: long, straight black hair worn loose, falling naturally around the face and shoulders. Keep the portrait’s part and fringe; let the strands shift with the pose and gravity',
      '- match the portrait’s smooth cheek-to-jaw contour: below the cheekbones it tapers gently to a rounded chin. Keep its skin tone and black hair without a brown or gold cast. No eye-enlarging filters or contour that would lengthen the face',
      'STUDIO MAKEUP (match reference image 2 on visible features):',
      '- match the portrait’s fine black upper lashes in separated clusters, short outer liner, blush placement and pale nude-pink lips. Keep the central lower lid unobtrusive: no drawn under-eye rolls or added lower eyeliner; allow natural lower-lid shadow',
      '- the short, soft shadow beside each visible nose wing fades into the cheek well before the corner of the mouth. Do not draw a continuous dark nasolabial line or blur away the skin texture',
      '- keep the visible skin texture and let highlights and shadows follow the studio light. Keep the relaxed eye opening as the cheek or jaw meets the hand; let the expression follow the selected pose',
    ] : [
      'PRESERVE EXACTLY (from reference image 1):',
      '- face, facial features, skin tone, skin texture, hair style and body proportions; retain the photographed hair colour and part',
      '- keep the makeup from reference image 1 as photographed, whether bare or made up. If the source face is obscured, keep that occlusion rather than inventing a face',
    ]),
    '- keep the exact body: shoulder and hip widths, waist position, relative limb lengths, calf and ankle shape from reference image 1. No reshaping',
  ];
}

export const PROPORTION_TARGETS = Object.freeze({
  source: 'turnaround 2026-11-26 (standing front, white tee, dark leggings, barefoot)',
  crownY: 43,
  chinY: 241,
  soleY: 1460,
  get headCount() { return (this.soleY - this.crownY) / (this.chinY - this.crownY); },
  teeHemFirstGrayY: 586,
  trouserLegGapY: 761,
  kneeY: 1020,
  kneeWidthsPx: Object.freeze([75, 77]),
  calfPeakRows: Object.freeze([1151, 1144]),
  calfWidthsPx: Object.freeze([73, 74]),
  bareAnkleY: 1360,
  bareAnkleWidthPx: 40,
});

export function proportionContract({ standing = true } = {}) {
  if (!standing) {
    return [
      'BODY PROPORTIONS (posed view):',
      '- use the build in reference image 1, not the apparent body widths of the skeleton or the standing outline on screen',
    ];
  }
  const { crownY, chinY, soleY, headCount, teeHemFirstGrayY, trouserLegGapY, kneeY, kneeWidthsPx,
    calfPeakRows, calfWidthsPx, bareAnkleY, bareAnkleWidthPx } = PROPORTION_TARGETS;
  const percentBelowCrown = (row) => `${(100 * (row - crownY) / (soleY - crownY)).toFixed(1)}%`;
  return [
    'BODY PROPORTIONS (standing front reference only):',
    `- on the original turnaround: hair crown at y=${crownY}, chin near y=${chinY}, barefoot sole at y=${soleY}; the visible standing figure spans about ${headCount.toFixed(2)} heads`,
    `- below the central tee hem, grey trousers first appear at y=${teeHemFirstGrayY} (${percentBelowCrown(teeHemFirstGrayY)} down from the crown); the first visible gap between the trouser legs opens at y=${trouserLegGapY} (${percentBelowCrown(trouserLegGapY)}). These are clothing edges, not anatomical landmarks or placement guides for the new garments`,
    `- front widths, image left/right: knee region in leggings at y=${kneeY} about ${kneeWidthsPx.join('/')} px; widest calf at representative rows y=${calfPeakRows.join('/')} about ${calfWidthsPx.join('/')} px; bare ankles at y=${bareAnkleY} about ${bareAnkleWidthPx} px each`,
    '- these are source pixels, not output coordinates or body measurements. With bent knees or a turned body, allow foreshortening and overlap rather than matching the standing widths on screen',
  ];
}
