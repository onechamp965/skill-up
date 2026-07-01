import { NextResponse } from "next/server";
import type { GenerateImagesRequest, GenerateImagesResponse, GeneratedSceneImage, NewsScene } from "@/types/news";
import { generateImageWithLocalModel } from "@/lib/localModels";
import { normalizeNewsImagePrompt } from "@/lib/prompts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GenerateImagesRequest;
    const scenes = body.scenes?.length ? body.scenes : body.script?.scenes || [];
    const images: GeneratedSceneImage[] = [];

    for (const scene of scenes) {
      const image_prompt = normalizeNewsImagePrompt(scene);
      try {
        const image_url = await generateImageWithLocalModel(image_prompt);
        images.push({ scene_number: scene.scene_number, image_prompt, image_url, status: "success" });
      } catch (error) {
        images.push({
          scene_number: scene.scene_number,
          image_prompt,
          image_url: createFallbackSceneImage(scene),
          status: "success",
          error: `로컬 이미지 생성 실패로 대체 비주얼을 사용했습니다: ${
            error instanceof Error ? error.message : "이미지 생성에 실패했습니다."
          }`
        });
      }
    }

    const response: GenerateImagesResponse = { images };
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "이미지 생성 요청에 실패했습니다." },
      { status: 500 }
    );
  }
}

function createFallbackSceneImage(scene: NewsScene) {
  const palette =
    scene.scene_number % 3 === 0
      ? { top: "#0f172a", bottom: "#0f766e", accent: "#f59e0b", mist: "#dbeafe", glass: "#ffffff" }
      : scene.scene_number % 3 === 1
        ? { top: "#111827", bottom: "#1d4ed8", accent: "#fb7185", mist: "#bfdbfe", glass: "#eef2ff" }
        : { top: "#1e1b4b", bottom: "#14532d", accent: "#f472b6", mist: "#c4b5fd", glass: "#f8fafc" };
  const panelX = 120 + (scene.scene_number % 2) * 40;
  const panelY = 112 + (scene.scene_number % 3) * 22;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536" viewBox="0 0 1024 1536">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${palette.top}"/>
      <stop offset="1" stop-color="${palette.bottom}"/>
    </linearGradient>
    <radialGradient id="light" cx="50%" cy="30%" r="70%">
      <stop offset="0" stop-color="${palette.glass}" stop-opacity="0.18"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1536" fill="url(#bg)"/>
  <rect width="1024" height="1536" fill="url(#light)"/>
  <ellipse cx="${panelX}" cy="${panelY}" rx="240" ry="140" fill="${palette.accent}" opacity="0.24"/>
  <circle cx="780" cy="320" r="170" fill="${palette.mist}" opacity="0.12"/>
  <rect x="112" y="960" width="800" height="284" rx="48" fill="#ffffff" opacity="0.08"/>
  <rect x="150" y="1000" width="360" height="170" rx="22" fill="#ffffff" opacity="0.14"/>
  <rect x="184" y="1030" width="290" height="22" rx="11" fill="${palette.glass}" opacity="0.4"/>
  <rect x="184" y="1070" width="230" height="20" rx="10" fill="${palette.glass}" opacity="0.28"/>
  <rect x="184" y="1110" width="180" height="20" rx="10" fill="${palette.glass}" opacity="0.2"/>
  <rect x="560" y="1024" width="230" height="132" rx="18" fill="${palette.glass}" opacity="0.18"/>
  <rect x="588" y="1050" width="176" height="84" rx="12" fill="${palette.mist}" opacity="0.32"/>
  <rect x="614" y="1080" width="128" height="16" rx="8" fill="${palette.glass}" opacity="0.34"/>
  <line x1="164" y1="1280" x2="860" y2="1280" stroke="${palette.glass}" stroke-width="20" stroke-linecap="round" opacity="0.08"/>
  <path d="M160 820 C320 760, 470 770, 632 824 S808 886, 916 848" fill="none" stroke="${palette.accent}" stroke-width="24" stroke-linecap="round" opacity="0.45"/>
  <path d="M170 792 C306 716, 458 724, 604 786" fill="none" stroke="${palette.glass}" stroke-width="8" stroke-linecap="round" opacity="0.2"/>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
