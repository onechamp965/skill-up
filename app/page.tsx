"use client";

import { useEffect, useMemo, useState } from "react";
import { ErrorMessage } from "@/components/ErrorMessage";
import { ExportPanel } from "@/components/ExportPanel";
import { Header } from "@/components/Header";
import { HeroSection } from "@/components/HeroSection";
import { NewsBriefPanel } from "@/components/NewsBriefPanel";
import { NewsCandidateGrid } from "@/components/NewsCandidateGrid";
import { NewsInputPanel } from "@/components/NewsInputPanel";
import { NewsScriptPanel } from "@/components/NewsScriptPanel";
import { ProgressStepper } from "@/components/ProgressStepper";
import { SceneTimeline } from "@/components/SceneTimeline";
import { ShortsPreview } from "@/components/ShortsPreview";
import { SourceList } from "@/components/SourceList";
import { VideoBuilderPanel } from "@/components/VideoBuilderPanel";
import { YouTubeUploadPanel } from "@/components/YouTubeUploadPanel";
import { renderShortsVideo } from "@/lib/clientVideo";
import { STORAGE_KEY } from "@/lib/storage";
import type {
  CollectNewsResponse,
  GenerateImagesResponse,
  GenerateNewsBriefResponse,
  GenerateNewsScriptResponse,
  GenerateVoiceResponse,
  NewsCandidate,
  NewsStudioState
} from "@/types/news";

const demoText = `AI 반도체 시장 경쟁이 빨라지고 있습니다.
글로벌 클라우드 기업들은 생성형 AI 서비스 수요가 늘면서 데이터센터 투자와 AI 가속기 확보를 확대하고 있습니다.
일부 기업은 자체 칩 개발을 추진하고 있고, 기존 반도체 기업은 고성능 메모리와 패키징 기술을 강화하고 있습니다.
다만 투자 속도와 전력 비용, 공급망 제약은 향후 실적과 시장 전망에 변수로 꼽힙니다.`;

const initialState: NewsStudioState = {
  mode: "text",
  keyword: "",
  url: "",
  text: "",
  category: "AI",
  tone: "중립 브리핑",
  targetAudience: "일반인",
  duration: 60,
  sources: [],
  candidates: [],
  images: [],
  step: "idle"
};

export default function Home() {
  const [state, setState] = useState<NewsStudioState>(() => {
    if (typeof window === "undefined") return initialState;
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return initialState;
    try {
      return { ...initialState, ...(JSON.parse(saved) as Partial<NewsStudioState>) };
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
      return initialState;
    }
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState({
    collect: false,
    brief: false,
    script: false,
    images: false,
    voice: false,
    video: false
  });
  const [youtubeConnected, setYoutubeConnected] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("youtube") === "connected";
  });

  const selectedSources = useMemo(() => {
    if (!state.selectedSourceId) return state.sources;
    return state.sources.filter((source) => source.id === state.selectedSourceId);
  }, [state.selectedSourceId, state.sources]);

  useEffect(() => {
    const handler = () => {
      setState((prev) => ({ ...prev, mode: "text", text: demoText, category: "AI" }));
      window.location.hash = "news-input";
    };
    window.addEventListener("load-demo-news", handler);
    return () => window.removeEventListener("load-demo-news", handler);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeForStorage(state)));
    } catch {
      // localStorage can fail in private mode or if metadata grows too large.
    }
  }, [state]);

  useEffect(() => {
    fetch("/api/auth/google/status")
      .then((response) => response.json())
      .then((payload: { connected?: boolean }) => {
        if (payload.connected) setYoutubeConnected(true);
      })
      .catch(() => undefined);
  }, []);

  async function collectNews() {
    setError("");
    setLoading((prev) => ({ ...prev, collect: true }));
    setState((prev) => ({ ...prev, step: "collecting_news" }));
    try {
      const response = await fetch("/api/news/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: state.mode,
          keyword: state.keyword,
          url: state.url,
          text: state.text,
          category: state.category
        })
      });
      const payload = (await response.json()) as CollectNewsResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "뉴스 수집 실패");
      setState((prev) => ({
        ...prev,
        sources: payload.sources,
        candidates: payload.candidates,
        selectedSourceId: payload.sources[0]?.id,
        brief: undefined,
        script: undefined,
        images: [],
        voice: undefined,
        video: undefined,
        step: "news_ready"
      }));
    } catch (event) {
      setError(event instanceof Error ? event.message : "뉴스 수집 실패");
      setState((prev) => ({ ...prev, step: "error" }));
    } finally {
      setLoading((prev) => ({ ...prev, collect: false }));
    }
  }

  async function generateBrief() {
    setError("");
    setLoading((prev) => ({ ...prev, brief: true }));
    setState((prev) => ({ ...prev, step: "generating_brief" }));
    try {
      const response = await fetch("/api/news/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sources: selectedSources,
          tone: state.tone,
          targetAudience: state.targetAudience
        })
      });
      const payload = (await response.json()) as GenerateNewsBriefResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "브리프 생성 실패");
      setState((prev) => ({ ...prev, brief: payload.brief, script: undefined, images: [], step: "brief_ready" }));
    } catch (event) {
      setError(event instanceof Error ? event.message : "브리프 생성 실패");
      setState((prev) => ({ ...prev, step: "error" }));
    } finally {
      setLoading((prev) => ({ ...prev, brief: false }));
    }
  }

  async function generateScript() {
    if (!state.brief) return;
    setError("");
    setLoading((prev) => ({ ...prev, script: true }));
    setState((prev) => ({ ...prev, step: "generating_script" }));
    try {
      const response = await fetch("/api/news/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief: state.brief,
          sources: selectedSources,
          tone: state.tone,
          targetAudience: state.targetAudience,
          duration: state.duration
        })
      });
      const payload = (await response.json()) as GenerateNewsScriptResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "스크립트 생성 실패");
      setState((prev) => ({ ...prev, script: payload.script, images: [], voice: undefined, video: undefined, step: "script_ready" }));
    } catch (event) {
      setError(event instanceof Error ? event.message : "스크립트 생성 실패");
      setState((prev) => ({ ...prev, step: "error" }));
    } finally {
      setLoading((prev) => ({ ...prev, script: false }));
    }
  }

  async function generateImages() {
    if (!state.script) return;
    setError("");
    setLoading((prev) => ({ ...prev, images: true }));
    setState((prev) => ({ ...prev, step: "generating_images" }));
    try {
      const response = await fetch("/api/news/images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: state.script, scenes: state.script.scenes })
      });
      const payload = (await response.json()) as GenerateImagesResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "이미지 생성 실패");
      const failedImages = payload.images.filter((image) => image.status === "failed");
      setState((prev) => ({ ...prev, images: payload.images, step: "images_ready" }));
      if (failedImages.length) {
        setError(
          `${failedImages.length}개 장면 이미지 생성에 실패했습니다: ${failedImages
            .map((image) => `scene ${image.scene_number}`)
            .join(", ")}`
        );
      }
    } catch (event) {
      setError(event instanceof Error ? event.message : "이미지 생성 실패");
      setState((prev) => ({ ...prev, step: "error" }));
    } finally {
      setLoading((prev) => ({ ...prev, images: false }));
    }
  }

  async function generateVoice() {
    if (!state.script) return;
    setError("");
    setLoading((prev) => ({ ...prev, voice: true }));
    setState((prev) => ({ ...prev, step: "generating_voice" }));
    try {
      const response = await fetch("/api/news/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: state.script, narration: state.script.narration, scenes: state.script.scenes })
      });
      const payload = (await response.json()) as GenerateVoiceResponse & { error?: string };
      const voice = payload.voice || payload.audio;
      if (!response.ok) throw new Error(voice?.error || payload.error || "음성 생성 실패");
      if (!voice) throw new Error("음성 생성 응답이 비어 있습니다.");
      setState((prev) => ({ ...prev, voice, step: voice.status === "success" ? "voice_ready" : "script_ready" }));
      if (voice.status === "failed") {
        setError(voice.error || "음성 생성 실패");
      }
    } catch (event) {
      setError(event instanceof Error ? event.message : "음성 생성 실패");
      setState((prev) => ({ ...prev, step: "error" }));
    } finally {
      setLoading((prev) => ({ ...prev, voice: false }));
    }
  }

  async function renderVideo() {
    if (!state.script) return;
    setError("");
    setLoading((prev) => ({ ...prev, video: true }));
    setState((prev) => ({ ...prev, step: "rendering_video" }));
    try {
      const video = await renderShortsVideo({ script: state.script, images: state.images, audio: state.voice });
      setState((prev) => ({ ...prev, video, step: "video_ready" }));
    } catch (event) {
      setError(event instanceof Error ? event.message : "영상 렌더링 실패");
      setState((prev) => ({ ...prev, step: "error" }));
    } finally {
      setLoading((prev) => ({ ...prev, video: false }));
    }
  }

  function selectCandidate(candidate: NewsCandidate) {
    setState((prev) => ({ ...prev, selectedSourceId: candidate.id }));
  }

  function downloadPackage() {
    const blob = new Blob([JSON.stringify({ ...state, generated_at: new Date().toISOString() }, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "news-shorts-result.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main>
      <Header youtubeConnected={youtubeConnected} />
      <HeroSection />
      <div className="workspace">
        <ProgressStepper current={state.step} />
        <ErrorMessage message={error} />
        <NewsInputPanel
          mode={state.mode}
          keyword={state.keyword}
          url={state.url}
          text={state.text}
          category={state.category}
          tone={state.tone}
          targetAudience={state.targetAudience}
          duration={state.duration}
          loading={loading.collect}
          onChange={(patch) => setState((prev) => ({ ...prev, ...patch }))}
          onCollect={collectNews}
        />
        <NewsCandidateGrid candidates={state.candidates} selectedId={state.selectedSourceId} onSelect={selectCandidate} />
        <SourceList sources={selectedSources} />
        <div className="twoColumn">
          <NewsBriefPanel
            brief={state.brief}
            loading={loading.brief}
            disabled={!selectedSources.length}
            onGenerate={generateBrief}
          />
          <NewsScriptPanel
            script={state.script}
            loading={loading.script}
            disabled={!state.brief}
            onGenerate={generateScript}
          />
        </div>
        <SceneTimeline scenes={state.script?.scenes || []} images={state.images} />
        <div className="twoColumn">
          <ShortsPreview script={state.script} images={state.images} />
          <VideoBuilderPanel
            script={state.script}
            images={state.images}
            voice={state.voice}
            video={state.video}
            loadingImages={loading.images}
            loadingVoice={loading.voice}
            loadingVideo={loading.video}
            onGenerateImages={generateImages}
            onGenerateVoice={generateVoice}
            onRenderVideo={renderVideo}
            onDownloadPackage={downloadPackage}
          />
        </div>
        <YouTubeUploadPanel
          key={state.script?.youtube_metadata.title || "youtube-upload"}
          connected={youtubeConnected}
          video={state.video}
          metadata={state.script?.youtube_metadata}
          sourceSummary={state.script?.source_summary}
        />
        <ExportPanel
          brief={state.brief}
          script={state.script}
          sources={selectedSources}
          images={state.images}
          video={state.video}
        />
      </div>
    </main>
  );
}

function sanitizeForStorage(state: NewsStudioState): NewsStudioState {
  return {
    ...state,
    images: state.images.map((image) => ({
      ...image,
      image_url: image.image_url?.startsWith("data:") ? undefined : image.image_url
    })),
    voice: state.voice?.audio_url?.startsWith("data:") ? { ...state.voice, audio_url: undefined } : state.voice,
    video: state.video
      ? {
          ...state.video,
          video_url:
            state.video.video_url?.startsWith("data:") || state.video.video_url?.startsWith("blob:")
              ? undefined
              : state.video.video_url,
          blob: undefined
        }
      : undefined
  };
}
