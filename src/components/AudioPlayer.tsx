"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  FolderPlus,
  Heart,
  Pause,
  Play,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import { AudioScrubber } from "@/components/ui/waveform";
import { cn } from "@/lib/utils";

interface FileRecord {
  id: string;
  filename: string;
  path: string;
  format: string | null;
  duration: number | null;
  fileSize: number | null;
  isFavorite: boolean;
}

interface AudioPlayerProps {
  selectedFile: FileRecord | null;
  onClose: () => void;
  onPlaybackChange?: (isPlaying: boolean) => void;
  onToggleFavorite: (id: string) => Promise<void>;
  collections: { id: string; name: string; fileCount?: number }[];
  onAddToCollection: (collectionId: string) => Promise<void>;
}

const VOLUME_STORAGE_KEY = "foleyard-volume";
const LEGACY_VOLUME_STORAGE_KEYS = ["soundslop-volume"];

export function AudioPlayer({
  selectedFile,
  onClose,
  onPlaybackChange,
  onToggleFavorite,
  collections,
  onAddToCollection,
}: AudioPlayerProps) {
  if (!selectedFile) {
    return null;
  }

  return (
    <AudioPlayerContent
      key={selectedFile.id}
      selectedFile={selectedFile}
      onClose={onClose}
      onPlaybackChange={onPlaybackChange}
      onToggleFavorite={onToggleFavorite}
      collections={collections}
      onAddToCollection={onAddToCollection}
    />
  );
}

function AudioPlayerContent({
  selectedFile,
  onClose,
  onPlaybackChange,
  onToggleFavorite,
  collections,
  onAddToCollection,
}: {
  selectedFile: FileRecord;
  onClose: () => void;
  onPlaybackChange?: (isPlaying: boolean) => void;
  onToggleFavorite: (id: string) => Promise<void>;
  collections: { id: string; name: string; fileCount?: number }[];
  onAddToCollection: (collectionId: string) => Promise<void>;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const volumeRef = useRef(0.72);
  const isMutedRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [waveformData] = useState<number[]>([]);
  const [volume, setVolume] = useState(() => {
    if (typeof window === "undefined") {
      return 0.72;
    }

    const savedVolume =
      window.localStorage.getItem(VOLUME_STORAGE_KEY) ??
      LEGACY_VOLUME_STORAGE_KEYS.map((key) => window.localStorage.getItem(key)).find(
        (value) => value !== null,
      );
    const parsedVolume = savedVolume ? Number(savedVolume) : 0.72;
    return Number.isFinite(parsedVolume) ? parsedVolume : 0.72;
  });
  const [isMuted, setIsMuted] = useState(false);

  useEffect(() => {
    volumeRef.current = volume;
    isMutedRef.current = isMuted;
  }, [isMuted, volume]);

  useEffect(() => {
    const audio = new Audio(`/api/audio?id=${encodeURIComponent(selectedFile.id)}`);
    audio.preload = "metadata";
    audio.volume = isMutedRef.current ? 0 : volumeRef.current;
    audioRef.current = audio;

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleLoadedMetadata = () => {
      setCurrentTime(audio.currentTime || 0);
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(audio.duration || 0);
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);

    audio.play().catch(() => {
      setIsPlaying(false);
    });

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("ended", handleEnded);
      audio.src = "";

      if (audioRef.current === audio) {
        audioRef.current = null;
      }
    };
  }, [selectedFile.id]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [isMuted, volume]);

  useEffect(() => {
    onPlaybackChange?.(isPlaying);
  }, [isPlaying, onPlaybackChange]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VOLUME_STORAGE_KEY, String(volume));
    }
  }, [volume]);

  const title = useMemo(() => {
    return selectedFile.filename.replace(/\.[^.]+$/, "");
  }, [selectedFile.filename]);

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (audio.paused) {
      audio.play().catch(() => {
        setIsPlaying(false);
      });
      return;
    }

    audio.pause();
  };

  const handleSeek = (time: number) => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    audio.currentTime = time;
    setCurrentTime(time);
  };

  const handleVolumeChange = (value: number | readonly number[]) => {
    const nextVolume = Array.isArray(value) ? value[0] : value;

    setVolume(nextVolume);
    if (nextVolume > 0 && isMuted) {
      setIsMuted(false);
    }
    if (nextVolume === 0) {
      setIsMuted(true);
    }
  };

  const effectiveDuration = duration || selectedFile.duration || 0;

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 md:left-[17rem] md:right-6">
      <div className="relative overflow-hidden rounded-[24px] border border-border bg-card/90 shadow-2xl backdrop-blur-2xl md:h-[108px]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,color-mix(in_oklab,var(--primary)_16%,transparent),transparent_34%),radial-gradient(circle_at_center,color-mix(in_oklab,var(--foreground)_4%,transparent),transparent_58%)]" />
        <div className="relative flex flex-col gap-3 px-4 py-3 text-card-foreground md:h-full md:flex-row md:items-center md:gap-4 md:px-5 md:py-3">
          <div className="flex items-center gap-3 md:gap-4">
            <Button
              size="icon"
              onClick={togglePlayback}
              className="h-16 w-16 shrink-0 rounded-full border border-primary/45 bg-primary/10 text-primary shadow-[0_0_0_1px_color-mix(in_oklab,var(--primary)_16%,transparent),0_0_24px_color-mix(in_oklab,var(--primary)_22%,transparent)] backdrop-blur-md transition-transform hover:scale-[1.02] hover:bg-primary/15 active:scale-95 md:h-14 md:w-14"
              aria-label={isPlaying ? "Pause audio" : "Play audio"}
            >
              {isPlaying ? (
                <Pause className="size-7 fill-current md:size-6" />
              ) : (
                <Play className="ml-1 size-7 fill-current md:size-6" />
              )}
            </Button>

            <div className="min-w-0 md:hidden">
              <div className="truncate text-base font-semibold text-card-foreground">
                {title || selectedFile.filename}
              </div>
            </div>
          </div>

          <div className="min-w-0 flex-1 md:flex md:h-full md:flex-col md:justify-center">
            <div className="mb-2 hidden items-center justify-between gap-3 md:flex">
              <div className="min-w-0 truncate text-base font-semibold leading-none text-card-foreground">
                {title || selectedFile.filename}
              </div>

              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="size-8 shrink-0 rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                aria-label="Close player"
              >
                <X className="size-3.5" />
              </Button>
            </div>

            <div className="rounded-2xl md:hidden">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-xs font-mono text-muted-foreground">
                  {formatTime(currentTime)}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  className="size-8 shrink-0 rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  aria-label="Close player"
                >
                  <X className="size-4" />
                </Button>
                <div className="text-xs font-mono text-muted-foreground">
                  {formatTime(effectiveDuration)}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-muted/40 px-1 py-1 md:border-none md:bg-transparent md:px-0 md:py-0">
              <AudioScrubber
                data={waveformData}
                currentTime={currentTime}
                duration={Math.max(effectiveDuration, 1)}
                onSeek={handleSeek}
                height={34}
                barWidth={3}
                barGap={1}
                barRadius={999}
                barHeight={3}
                showHandle={false}
                barColor="rgba(255, 255, 255, 0.72)"
                className="w-full overflow-hidden"
              />
            </div>

            <div className="mt-0.5 flex items-center justify-between text-[10px] font-mono text-muted-foreground md:hidden">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(effectiveDuration)}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 md:flex-nowrap md:self-center">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "size-8 rounded-full border border-border bg-muted/40 text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                selectedFile.isFavorite && "text-primary",
              )}
              onClick={() => onToggleFavorite(selectedFile.id)}
              aria-label={selectedFile.isFavorite ? "Unlike file" : "Like file"}
            >
              <Heart
                className={cn(
                  "size-4",
                  selectedFile.isFavorite && "fill-current",
                )}
              />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    className="h-9 rounded-full border border-primary/35 bg-primary/10 px-3.5 text-sm font-medium text-card-foreground hover:bg-primary/15"
                  >
                    <FolderPlus className="mr-2.5 size-4" />
                    Add to Playlist
                  </Button>
                }
              />
              <DropdownMenuContent
                align="end"
                className="w-60 rounded-2xl border-border bg-popover text-popover-foreground"
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-muted-foreground">
                    Playlists
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {collections.length === 0 ? (
                    <DropdownMenuItem disabled className="text-muted-foreground">
                      No playlists found
                    </DropdownMenuItem>
                  ) : (
                    collections.map((collection) => (
                      <DropdownMenuItem
                        key={collection.id}
                        onClick={() => onAddToCollection(collection.id)}
                        className="text-popover-foreground"
                      >
                        <span className="truncate">{collection.name}</span>
                        {typeof collection.fileCount === "number" ? (
                          <span className="ml-auto text-xs text-muted-foreground">
                            {collection.fileCount}
                          </span>
                        ) : null}
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex min-w-[150px] flex-1 items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1.5 md:min-w-[160px] md:flex-none">
              <Button
                variant="ghost"
                size="icon"
                className="size-6 shrink-0 rounded-full text-muted-foreground hover:bg-transparent hover:text-foreground"
                onClick={() => setIsMuted((current) => !current)}
                aria-label={isMuted ? "Unmute audio" : "Mute audio"}
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="size-3.5" />
                ) : (
                  <Volume2 className="size-3.5" />
                )}
              </Button>
              <Slider
                value={[isMuted ? 0 : volume]}
                min={0}
                max={1}
                step={0.01}
                onValueChange={handleVolumeChange}
                aria-label="Volume"
                className="flex-1"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatTime(seconds: number) {
  if (!seconds || Number.isNaN(seconds)) {
    return "0:00";
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}
