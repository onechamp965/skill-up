import { NextResponse } from "next/server";
import type { GenerateVoiceRequest, GenerateVoiceResponse, GeneratedVoiceSegment } from "@/types/news";
import { generateSpeechWithLocalModel } from "@/lib/localModels";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as GenerateVoiceRequest;
    const text = getTtsInputText(body);

    if (!text) {
      const response: GenerateVoiceResponse = {
        voice: {
          status: "failed",
          error: "TTS 입력 텍스트가 비어 있습니다. script.narration 또는 scenes[].narration을 확인해주세요."
        }
      };
      return NextResponse.json(response, { status: 400 });
    }

    if (body.scenes?.length) {
      const segments: GeneratedVoiceSegment[] = [];

      for (const scene of body.scenes) {
        try {
          const audio_url = await generateSpeechWithLocalModel(scene.narration || scene.subtitle, body.voice);
          segments.push({ scene_number: scene.scene_number, audio_url, status: "success" });
        } catch (error) {
          segments.push({
            scene_number: scene.scene_number,
            status: "failed",
            error: error instanceof Error ? error.message : "씬 음성 생성에 실패했습니다."
          });
        }
      }

      const firstAudio = segments.find((segment) => segment.status === "success" && segment.audio_url)?.audio_url;
      const failedCount = segments.filter((segment) => segment.status === "failed").length;
      const firstError = segments.find((segment) => segment.error)?.error;
      const response: GenerateVoiceResponse = {
        voice: {
          audio_url: firstAudio,
          segments,
          status: firstAudio ? "success" : "failed",
          error: failedCount
            ? firstAudio
              ? `${failedCount}개 씬의 음성 생성에 실패했습니다. 성공한 씬 음성만 영상에 포함됩니다.`
              : firstError || "모든 씬의 음성 생성에 실패했습니다."
            : undefined
        }
      };
      return NextResponse.json(response);
    }

    try {
      const audio_url = await generateSpeechWithLocalModel(text, body.voice);
      const response: GenerateVoiceResponse = { voice: { audio_url, status: "success" } };
      return NextResponse.json(response);
    } catch (error) {
      const response: GenerateVoiceResponse = {
        voice: {
          status: "failed",
          error: error instanceof Error ? error.message : "음성 생성에 실패했습니다."
        }
      };
      return NextResponse.json(response);
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "음성 생성 요청에 실패했습니다." },
      { status: 500 }
    );
  }
}

function getTtsInputText(body: GenerateVoiceRequest) {
  const narration = body.script?.narration || body.narration;
  if (narration?.trim()) return narration.trim();

  const scenes = body.script?.scenes?.length ? body.script.scenes : body.scenes || [];
  return scenes
    .map((scene) => scene.narration)
    .filter((value): value is string => Boolean(value?.trim()))
    .join("\n")
    .trim();
}
