import { NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import type { GenerateVoiceRequest, GenerateVoiceResponse } from "@/types/news";
import { generateSpeechWithOpenAI } from "@/lib/openai";

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

    console.log("[TTS] input length:", text.length);
    const shouldPersistToPublic = await canPersistToPublic();

    try {
      const audioBuffer = await generateSpeechWithOpenAI(text, body.voice || "alloy");
      const audio_url = shouldPersistToPublic ? await saveAudioFile(audioBuffer) : toAudioDataUrl(audioBuffer);
      console.log("[TTS] output:", audio_url);
      const response: GenerateVoiceResponse = { voice: { audio_url, status: "success" } };
      return NextResponse.json(response);
    } catch (error) {
      console.error("[TTS] failed:", error);
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
    .filter((text): text is string => Boolean(text?.trim()))
    .join("\n")
    .trim();
}

function getGeneratedAudioDir() {
  return path.join(process.cwd(), "public", "generated", "audio");
}

async function canPersistToPublic() {
  try {
    await mkdir(getGeneratedAudioDir(), { recursive: true });
    return true;
  } catch {
    return false;
  }
}

async function saveAudioFile(audioBuffer: Buffer) {
  const fileName = `voice-${Date.now()}.mp3`;
  const filePath = path.join(getGeneratedAudioDir(), fileName);
  await writeFile(filePath, audioBuffer);
  return `/generated/audio/${fileName}`;
}

function toAudioDataUrl(audioBuffer: Buffer) {
  return `data:audio/mpeg;base64,${audioBuffer.toString("base64")}`;
}
