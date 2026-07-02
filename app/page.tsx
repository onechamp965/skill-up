"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ErrorMessage } from "@/components/ErrorMessage";
import { ExportPanel } from "@/components/ExportPanel";
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
  GeneratedVoice,
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
  captions: { enabled: true },
  step: "idle"
};

export default function Home() {
  const [state, setState] = useState<NewsStudioState>(initialState);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState({
    collect: false,
    brief: false,
    script: false,
    images: false,
    voice: false,
    video: false
  });
  const [youtubeConnected, setYoutubeConnected] = useState(false);
  const voiceRequestRef = useRef<AbortController | null>(null);

  const selectedSources = useMemo(() => {
    if (!state.selectedSourceId) return state.sources;
    return state.sources.filter((source) => source.id === state.selectedSourceId);
  }, [state.selectedSourceId, state.sources]);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) {
          setState(normalizeStoredState(JSON.parse(saved) as Partial<NewsStudioState>));
        }
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    });
  }, []);

  useEffect(() => {
    return () => {
      voiceRequestRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeForStorage(state)));
    } catch {
      // localStorage can fail in private mode or if metadata grows too large.
    }
  }, [state]);

  useEffect(() => {
    queueMicrotask(() => {
      const params = new URLSearchParams(window.location.search);
      setYoutubeConnected(params.get("youtube") === "connected");
    });
  }, []);

  useEffect(() => {
    const handler = () => {
      setState((prev) => ({ ...prev, mode: "text", text: demoText, category: "AI" }));
      window.location.hash = "studio";
    };
    window.addEventListener("load-demo-news", handler);
    return () => window.removeEventListener("load-demo-news", handler);
  }, []);

  useEffect(() => {
    fetch("/api/auth/google/status")
      .then((response) => response.json())
      .then((payload: { connected?: boolean }) => {
        if (payload.connected) setYoutubeConnected(true);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("news-shorts-bookmarks", JSON.stringify([]));
    } catch {
      // ignore storage quota issues.
    }
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
    if (!state.script || loading.voice) return;
    voiceRequestRef.current?.abort();
    const controller = new AbortController();
    voiceRequestRef.current = controller;
    setError("");
    setLoading((prev) => ({ ...prev, voice: true }));
    setState((prev) => ({ ...prev, step: "generating_voice" }));
    try {
      const response = await fetch("/api/news/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ script: state.script, narration: state.script.narration })
      });
      const payload = (await response.json()) as GenerateVoiceResponse & { error?: string };
      const voice = payload.voice || payload.audio;
      if (!response.ok) throw new Error(voice?.error || payload.error || "음성 생성 실패");
      if (!voice) throw new Error("음성 생성 응답이 비어 있습니다.");
      const singleTrackVoice = normalizeSingleTrackVoice(voice);
      if (!singleTrackVoice) throw new Error("단일 TTS 응답이 아닙니다. 서버를 새로고침한 뒤 다시 생성해주세요.");
      setState((prev) => ({
        ...prev,
        voice: singleTrackVoice,
        step: singleTrackVoice.status === "success" ? "voice_ready" : "script_ready"
      }));
      if (singleTrackVoice.status === "failed") {
        setError(singleTrackVoice.error || "음성 생성 실패");
      }
    } catch (event) {
      if (event instanceof DOMException && event.name === "AbortError") return;
      setError(event instanceof Error ? event.message : "음성 생성 실패");
      setState((prev) => ({ ...prev, step: "error" }));
    } finally {
      if (voiceRequestRef.current === controller) {
        voiceRequestRef.current = null;
        setLoading((prev) => ({ ...prev, voice: false }));
      }
    }
  }

  async function renderVideo() {
    if (!state.script) return;
    setError("");
    setLoading((prev) => ({ ...prev, video: true }));
    setState((prev) => ({ ...prev, step: "rendering_video" }));
    try {
      const video = await renderShortsVideo({
        script: state.script,
        images: state.images,
        audio: normalizeSingleTrackVoice(state.voice),
        captions: state.captions
      });
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
    <main className="pageRoot">
      <header className="siteHeader">
        <div className="brandLockup">
          <a className="brandMark" href="#top" aria-label="News Shorts Studio home">
            N
          </a>
          <div>
            <p className="brandEyebrow">Editorial AI workflow</p>
            <strong>News Shorts Studio</strong>
          </div>
        </div>

        <nav className="siteNav" aria-label="Primary">
          <a href="#studio">Studio</a>
          <a href="#workflow">Workflow</a>
          <a href="#export">Export</a>
        </nav>

        <div className="headerActions">
          <a className="ghostButton" href="/api/auth/google/start">
            {youtubeConnected ? "Google connected" : "Sign in"}
          </a>
        </div>
      </header>

      <section className="heroSection" id="top">
        <div className="heroText">
          <p className="eyebrow">Modern. Editorial. AI native.</p>
          <h1>뉴스를 읽는 화면은 덜고, 숏츠를 만드는 화면만 남겼습니다</h1>
          <p className="heroCopy">
            뉴스 카드와 편집형 섹션은 지우고, 기사 입력부터 브리프, 스크립트, 이미지, TTS, 영상까지 이어지는
            제작 흐름만 남겼습니다. 지금부터는 숏츠를 빠르게 만드는 일에 집중합니다.
          </p>
          <div className="heroActions">
            <a className="primaryLink" href="#studio">
              Studio 열기
            </a>
            <button
              type="button"
              className="secondaryButton"
              onClick={() => window.dispatchEvent(new CustomEvent("load-demo-news"))}
            >
              예시 불러오기
            </button>
          </div>
          <div className="heroMeta" aria-label="Key highlights">
            <div>
              <strong>News input</strong>
              <span>URL, text, keyword</span>
            </div>
            <div>
              <strong>Local AI</strong>
              <span>LLM, TTS, images</span>
            </div>
            <div>
              <strong>Delivery</strong>
              <span>video and upload</span>
            </div>
          </div>
        </div>

        <div className="heroMedia">
          <div className="workflowPreview">
            <div className="workflowPreviewHeader">
              <span>Studio status</span>
              <strong>{state.step}</strong>
            </div>
            <div className="workflowStatGrid">
              <div>
                <b>{state.sources.length}</b>
                <span>sources</span>
              </div>
              <div>
                <b>{state.candidates.length}</b>
                <span>candidates</span>
              </div>
              <div>
                <b>{state.script?.scenes.length || 0}</b>
                <span>scenes</span>
              </div>
              <div>
                <b>{state.images.length}</b>
                <span>images</span>
              </div>
            </div>
            <div className="workflowPreviewNote">
              <span>Current focus</span>
              <strong>{state.script?.title || "뉴스 입력 후 브리프를 생성하세요"}</strong>
              <p>{state.brief?.one_line_summary || "기사 URL 또는 뉴스 텍스트를 넣으면 바로 시작됩니다."}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="sectionBand studioSection" id="studio">
        <div className="sectionBandHeader">
          <div>
            <p className="eyebrow">Studio</p>
            <h2>숏츠 제작 흐름</h2>
          </div>
          <p className="sectionLead">
            입력, 브리프, 스크립트, 씬 이미지, TTS, 비디오 렌더링을 한 화면에서 순서대로 처리합니다.
          </p>
        </div>
        <ProgressStepper current={state.step} />
        <ErrorMessage message={error} />
        <div className="studioGrid" id="workflow">
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
          <div className="studioSidebar">
            <NewsCandidateGrid candidates={state.candidates} selectedId={state.selectedSourceId} loading={loading.collect} onSelect={selectCandidate} />
            <SourceList sources={selectedSources} />
          </div>
        </div>
        <div className="studioGrid twoColumn">
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
        <div className="studioGrid twoColumn">
          <ShortsPreview script={state.script} images={state.images} />
          <VideoBuilderPanel
            script={state.script}
            images={state.images}
            voice={state.voice}
            video={state.video}
            captions={state.captions}
            loadingImages={loading.images}
            loadingVoice={loading.voice}
            loadingVideo={loading.video}
            onGenerateImages={generateImages}
            onGenerateVoice={generateVoice}
            onRenderVideo={renderVideo}
            onDownloadPackage={downloadPackage}
            onChangeCaptions={(captions) => setState((prev) => ({ ...prev, captions }))}
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
      </section>

      <section className="sectionBand" id="export">
        <div className="workflowFooter">
          <div>
            <p className="eyebrow">Production</p>
            <h2>완성본을 내려받거나 업로드하세요</h2>
          </div>
          <p className="sectionLead">
            JSON 패키지, 비디오 다운로드, YouTube 업로드까지 이어지는 마무리 단계만 남겨두었습니다.
          </p>
        </div>
      </section>
    </main>
  );
}

function sanitizeForStorage(state: NewsStudioState): NewsStudioState {
  const voice = normalizeSingleTrackVoice(state.voice);

  return {
    ...state,
    images: state.images.map((image) => ({
      ...image,
      image_url: image.image_url?.startsWith("data:") ? undefined : image.image_url
    })),
    voice: voice?.audio_url?.startsWith("data:") ? { ...voice, audio_url: undefined } : voice,
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

function normalizeStoredState(saved: Partial<NewsStudioState>): NewsStudioState {
  const hasLegacySegmentedVoice = Boolean(saved.voice?.segments?.length);
  const state = { ...initialState, ...saved };
  return {
    ...state,
    voice: normalizeSingleTrackVoice(state.voice),
    video: hasLegacySegmentedVoice ? undefined : state.video
  };
}

function normalizeSingleTrackVoice(voice?: GeneratedVoice) {
  if (!voice) return undefined;
  if (voice.segments?.length) return undefined;
  const { segments: _segments, ...singleTrackVoice } = voice;
  return singleTrackVoice;
}
