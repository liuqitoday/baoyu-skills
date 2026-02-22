/**
 * liuqi_custom provider
 * 通过 /v1/chat/completions 端点生成图片
 * 适配返回 Markdown 图片链接的代理服务
 */

import type { CliArgs } from "../types";

export function getDefaultModel(): string {
  return process.env.LIUQI_CUSTOM_IMAGE_MODEL || "gemini-3-pro-image-preview";
}

function getApiKey(): string | null {
  return process.env.LIUQI_CUSTOM_API_KEY || null;
}

function getBaseUrl(): string {
  const base = process.env.LIUQI_CUSTOM_BASE_URL || "https://api.openai.com/v1";
  return base.replace(/\/+$/g, "");
}

/**
 * 从 content 中提取 data:image base64 并解码为 Uint8Array
 * 返回 null 表示没有找到 data URL
 */
function extractBase64Image(content: string): Uint8Array | null {
  // 匹配 Markdown 图片中的 data URL: ![...](data:image/...;base64,...)
  const mdDataRegex = /!\[[^\]]*\]\((data:image\/[^;]+;base64,[A-Za-z0-9+/=]+)\)/;
  let match = mdDataRegex.exec(content);
  
  // 也匹配裸 data URL（不在 markdown 里）
  if (!match) {
    const bareDataRegex = /(data:image\/[^;]+;base64,[A-Za-z0-9+/=]+)/;
    match = bareDataRegex.exec(content);
  }
  
  if (!match || !match[1]) return null;
  
  const dataUrl = match[1];
  const b64Match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
  if (!b64Match || !b64Match[1]) return null;
  
  const buf = Buffer.from(b64Match[1], "base64");
  // 基本完整性检查：JPEG 至少要几 KB 且有 EOI 标记，PNG 至少要有 IEND
  if (buf.byteLength < 2048) {
    console.warn(`[liuqi_custom] base64 image too small (${buf.byteLength} bytes), likely truncated — skipping`);
    return null;
  }
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50;
  if (isJpeg && !(buf[buf.byteLength - 2] === 0xff && buf[buf.byteLength - 1] === 0xd9)) {
    console.warn(`[liuqi_custom] JPEG missing EOI marker — image likely truncated (${buf.byteLength} bytes)`);
    return null;
  }
  if (isPng) {
    const tail = buf.slice(buf.byteLength - 12);
    if (!tail.includes(Buffer.from("IEND"))) {
      console.warn(`[liuqi_custom] PNG missing IEND chunk — image likely truncated (${buf.byteLength} bytes)`);
      return null;
    }
  }
  
  return new Uint8Array(buf);
}

/**
 * 从 Markdown 内容中提取图片 URL
 * 支持格式: ![...](url) 或 直接的 http(s) 图片链接
 */
function extractImageUrls(content: string): string[] {
  const urls: string[] = [];
  
  // 匹配 Markdown 图片: ![alt](url)
  const mdRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
  let match;
  while ((match = mdRegex.exec(content)) !== null) {
    const url = match[1]?.trim();
    if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
      urls.push(url);
    }
  }
  
  // 如果没找到 Markdown 格式，尝试直接匹配图片 URL
  if (urls.length === 0) {
    const urlRegex = /https?:\/\/[^\s<>"]+\.(?:png|jpg|jpeg|gif|webp)/gi;
    while ((match = urlRegex.exec(content)) !== null) {
      urls.push(match[0]);
    }
  }
  
  return urls;
}

type ChatCompletionResponse = {
  choices: Array<{
    message: {
      content: string | null;
      role: string;
      images?: Array<{
        type?: string;
        image_url?: {
          url: string;
        };
      }>;
    };
    finish_reason: string;
  }>;
};

export async function generateImage(
  prompt: string,
  model: string,
  args: CliArgs
): Promise<Uint8Array> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error(
      "LIUQI_CUSTOM_API_KEY is required for liuqi_custom provider.\n" +
      "Set it in ~/.baoyu-skills/.env or environment variables."
    );
  }

  const baseUrl = getBaseUrl();
  
  // 构建生图提示词
  let imagePrompt = `请生成图片: ${prompt}`;
  if (args.aspectRatio) {
    imagePrompt += ` (比例: ${args.aspectRatio})`;
  }
  if (args.quality === "2k") {
    imagePrompt += " (高清 2K 分辨率)";
  }

  console.log(`[liuqi_custom] Generating image via chat completions...`);
  console.log(`[liuqi_custom] Model: ${model}`);
  console.log(`[liuqi_custom] Base URL: ${baseUrl}`);

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 65536,
      messages: [
        {
          role: "user",
          content: imagePrompt,
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`[liuqi_custom] Chat API error (${res.status}): ${err}`);
  }

  const result = (await res.json()) as ChatCompletionResponse;
  
  const message = result.choices?.[0]?.message;
  
  // 优先检查 images 数组 (Gemini 风格的响应)
  if (message?.images && message.images.length > 0) {
    const imageData = message.images[0]?.image_url?.url;
    if (imageData) {
      // 处理 base64 data URL
      if (imageData.startsWith("data:image/")) {
        console.log(`[liuqi_custom] Found base64 image in response`);
        const base64Match = imageData.match(/^data:image\/[^;]+;base64,(.+)$/);
        if (base64Match && base64Match[1]) {
          const buf = Buffer.from(base64Match[1], "base64");
          console.log(`[liuqi_custom] Image decoded successfully (${buf.byteLength} bytes)`);
          return new Uint8Array(buf);
        }
      }
      // 处理普通 URL
      if (imageData.startsWith("http://") || imageData.startsWith("https://")) {
        console.log(`[liuqi_custom] Found image URL in response: ${imageData.slice(0, 100)}...`);
        const imgRes = await fetch(imageData);
        if (!imgRes.ok) {
          throw new Error(`[liuqi_custom] Failed to download image: ${imgRes.status}`);
        }
        const buf = await imgRes.arrayBuffer();
        console.log(`[liuqi_custom] Image downloaded successfully (${buf.byteLength} bytes)`);
        return new Uint8Array(buf);
      }
    }
  }
  
  // 回退到从 content 中提取图片
  const content = message?.content;
  if (!content) {
    throw new Error("[liuqi_custom] No content or images in response");
  }

  console.log(`[liuqi_custom] Response received, extracting image from content...`);

  // 优先尝试 data:image base64（Gemini 原生图片生成返回格式）
  const base64Image = extractBase64Image(content);
  if (base64Image) {
    console.log(`[liuqi_custom] Extracted base64 image from content (${base64Image.byteLength} bytes)`);
    return base64Image;
  }

  // 回退到 http(s) URL 提取
  const imageUrls = extractImageUrls(content);
  if (imageUrls.length === 0) {
    // 检查是否有被截断的 data URL（帮助诊断）
    if (content.includes("data:image/")) {
      console.error(`[liuqi_custom] Found data:image URL in content but it appears truncated or invalid`);
      console.error(`[liuqi_custom] Content length: ${content.length} chars`);
      console.error(`[liuqi_custom] Hint: increase max_tokens if image base64 is being cut off`);
    }
    console.error(`[liuqi_custom] Response content: ${content.slice(0, 500)}`);
    throw new Error("[liuqi_custom] No image URL found in response");
  }

  const imageUrl = imageUrls[0]!;
  console.log(`[liuqi_custom] Downloading image from: ${imageUrl}`);

  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) {
    throw new Error(`[liuqi_custom] Failed to download image: ${imgRes.status}`);
  }

  const buf = await imgRes.arrayBuffer();
  console.log(`[liuqi_custom] Image downloaded successfully (${buf.byteLength} bytes)`);
  
  return new Uint8Array(buf);
}
