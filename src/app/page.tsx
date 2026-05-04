"use client";

import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { Search, Loader2, PanelLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Sidebar } from "@/components/Sidebar";
import { FileTable } from "@/components/FileTable";
import { AudioPlayer, AudioPlayerRef } from "@/components/AudioPlayer";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface FileRecord {
  id: string;
  filename: string;
  path: string;
  directory: string | null;
  format: string | null;
  duration: number | null;
  fileSize: number | null;
  isFavorite: boolean;
}

interface CollectionRecord {
  id: string;
  name: string;
  fileCount?: number;
}

interface TagRecord {
  id: string;
  name: string;
  color: string;
}

interface ScanStatus {
  running: boolean;
  phase: string;
  discovered: number;
  added: number;
  updated: number;
  removed: number;
  failed: number;
  error: string | null;
}

const emptyScanStatus: ScanStatus = {
  running: false,
  phase: "idle",
  discovered: 0,
  added: 0,
  updated: 0,
  removed: 0,
  failed: 0,
  error: null,
};

import { AudioPlayerProvider } from "@/components/ui/audio-player";

export default function Home() {
  return (
    <AudioPlayerProvider>
      <HomeContent />
    </AudioPlayerProvider>
  );
}

function HomeContent() {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [directories, setDirectories] = useState<string[]>([]);
  const [tags, setTags] = useState<TagRecord[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileRecord | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [currentView, setCurrentView] = useState<
    "all" | "favorites" | "collection" | "directory"
  >("all");
  const [selectedCollection, setSelectedCollection] = useState<string | null>(
    null,
  );
  const [selectedDirectory, setSelectedDirectory] = useState<string | null>(
    null,
  );
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [isPlayerPlaying, setIsPlayerPlaying] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
  const [settings, setSettings] = useState({
    libraryRoot: null,
    stats: { activeFiles: 0, removedFiles: 0 },
  });
  const [scanStatus, setScanStatus] = useState<ScanStatus>(emptyScanStatus);

  const audioPlayerRef = useRef<AudioPlayerRef>(null);

  const showLibrary = useCallback(() => {
    setCurrentView("all");
    setSelectedCollection(null);
    setSelectedDirectory(null);
    setSearchQuery("");
  }, []);

  const showFavorites = useCallback(() => {
    setCurrentView("favorites");
    setSelectedCollection(null);
    setSelectedDirectory(null);
    setSearchQuery("");
  }, []);

  const showCollection = useCallback((collectionId: string) => {
    setCurrentView("collection");
    setSelectedCollection(collectionId);
    setSelectedDirectory(null);
    setSearchQuery("");
  }, []);

  const navigateDirectory = useCallback((directory: string | null) => {
    setCurrentView(directory ? "directory" : "all");
    setSelectedCollection(null);
    setSelectedDirectory(directory);
  }, []);

  const loadFiles = useCallback(async () => {
    setIsLoadingFiles(true);
    const params = new URLSearchParams();
    if (deferredSearchQuery.trim()) {
      params.set("q", deferredSearchQuery.trim());
    } else {
      // Only filter by directory if not searching
      if (currentView === "directory" && selectedDirectory) {
        params.set("directory", selectedDirectory);
      } else if (currentView === "all") {
        // In "all" view without search, if we have a selectedDirectory, show its files
        if (selectedDirectory) {
          params.set("directory", selectedDirectory);
        } else {
          setFiles([]);
          setIsLoadingFiles(false);
          return;
        }
      }
    }

    if (currentView === "favorites") params.set("favorites", "true");
    if (currentView === "collection" && selectedCollection)
      params.set("collectionId", selectedCollection);

    try {
      const response = await fetch(`/api/files?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to fetch files");
      const data = await response.json();
      setFiles(data.files ?? []);
    } catch {
      toast.error("Failed to load library");
    } finally {
      setIsLoadingFiles(false);
    }
  }, [currentView, deferredSearchQuery, selectedCollection, selectedDirectory]);

  const loadDirectories = useCallback(async () => {
    // Only load directories if we're not searching
    if (
      deferredSearchQuery.trim() ||
      currentView === "favorites" ||
      currentView === "collection"
    ) {
      setDirectories([]);
      return;
    }

    try {
      const params = new URLSearchParams();
      if (selectedDirectory) params.set("parent", selectedDirectory);
      const res = await fetch(`/api/directories?${params.toString()}`);
      const data = await res.json();
      setDirectories(data.directories ?? []);
    } catch (error) {
      console.error("Failed to load directories:", error);
      toast.error("Failed to load directories");
    }
  }, [deferredSearchQuery, currentView, selectedDirectory]);

  const loadInitialData = useCallback(async () => {
    try {
      const [settingsRes, collectionsRes, tagsRes, scanRes] = await Promise.all(
        [
          fetch("/api/settings"),
          fetch("/api/collections"),
          fetch("/api/tags"),
          fetch("/api/scan"),
        ],
      );

      const [settingsData, collectionsData, tagsData, scanData] =
        await Promise.all([
          settingsRes.json(),
          collectionsRes.json(),
          tagsRes.json(),
          scanRes.json(),
        ]);

      setSettings(settingsData);
      setCollections(collectionsData.collections ?? []);
      setTags(tagsData.tags ?? []);
      setScanStatus(scanData);
    } catch {
      toast.error("Failed to sync with server");
    }
  }, []);

  useEffect(() => {
    const run = async () => {
      await loadInitialData();
    };

    void run();
  }, [loadInitialData]);

  useEffect(() => {
    const run = async () => {
      await Promise.all([loadFiles(), loadDirectories()]);
    };

    void run();
  }, [loadFiles, loadDirectories]);

  const handleToggleFavorite = async (id: string) => {
    try {
      const res = await fetch("/api/files", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "toggleFavorite" }),
      });
      if (!res.ok) throw new Error();

      // Optimistic update
      setFiles((prev) =>
        prev.map((f) =>
          f.id === id ? { ...f, isFavorite: !f.isFavorite } : f,
        ),
      );
      if (selectedFile?.id === id) {
        setSelectedFile({
          ...selectedFile,
          isFavorite: !selectedFile.isFavorite,
        });
      }
    } catch {
      toast.error("Failed to update favorite status");
    }
  };

  const handleSaveRoot = async (path: string) => {
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", path }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Failed to save settings");
      }

      setSettings({ libraryRoot: data.libraryRoot, stats: data.stats });
      setScanStatus((current) => ({
        ...current,
        libraryRoot: data.libraryRoot,
        stats: data.stats,
      }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save settings");
    }
  };

  const handleStartScan = async () => {
    try {
      const res = await fetch("/api/scan", { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Failed to start scan");
      }

      setScanStatus(data.status);
      toast.info("Scan started");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start scan");
    }
  };

  const handleCreateCollection = async (name: string) => {
    if (!name.trim()) return;
    try {
      const res = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) throw new Error();
      loadInitialData();
      toast.success("Playlist created");
    } catch {
      toast.error("Failed to create playlist");
    }
  };

  const handleDeleteCollection = async (collectionId: string) => {
    try {
      const res = await fetch("/api/collections", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionId }),
      });
      if (!res.ok) throw new Error();

      if (selectedCollection === collectionId) {
        setSelectedCollection(null);
        setCurrentView("all");
      }

      loadInitialData();
      toast.success("Playlist deleted");
    } catch {
      toast.error("Failed to delete playlist");
    }
  };

  const handleCreateTag = async (name: string) => {
    if (!name.trim()) return;
    try {
      await fetch("/api/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      loadInitialData();
      toast.success("Tag created");
    } catch {
      toast.error("Failed to create tag");
    }
  };

  const handleAddToCollection = async (collectionId: string) => {
    if (!selectedFile) return;
    const playlist = collections.find(
      (collection) => collection.id === collectionId,
    );

    try {
      const res = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: selectedFile.id,
          collectionId,
        }),
      });
      if (!res.ok) throw new Error();

      await loadInitialData();
      toast.success(`Added to ${playlist?.name ?? "playlist"}`);
    } catch {
      toast.error("Failed to add to playlist");
    }
  };

  // Poll scan status
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (scanStatus.running) {
      interval = setInterval(async () => {
        const res = await fetch("/api/scan");
        const data = await res.json();
        setScanStatus(data);
        if (!data.running) {
          loadFiles();
          loadInitialData();
          toast.success("Scan complete");
        }
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [scanStatus.running, loadFiles, loadInitialData]);

  const selectedPlaylistName =
    currentView === "collection"
      ? (collections.find((collection) => collection.id === selectedCollection)
          ?.name ?? null)
      : null;

  return (
    <div className="relative flex h-screen overflow-hidden bg-background font-sans">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,color-mix(in_oklab,var(--primary)_10%,transparent),transparent_32%),radial-gradient(circle_at_bottom_right,color-mix(in_oklab,var(--foreground)_5%,transparent),transparent_38%)]" />
      <Sidebar
        className="hidden md:flex"
        currentView={currentView}
        collections={collections}
        selectedCollection={selectedCollection}
        tags={tags}
        scanStatus={scanStatus}
        onOpenSettings={() => setShowSettings(true)}
        onSelectLibrary={showLibrary}
        onSelectFavorites={showFavorites}
        onSelectCollection={showCollection}
      />

      <Dialog open={showMobileSidebar} onOpenChange={setShowMobileSidebar}>
        <DialogContent
          showCloseButton={false}
          className="left-0 top-0 h-screen w-[calc(100%-3rem)] max-w-80 translate-x-0 translate-y-0 rounded-none border-r border-border/70 bg-card/90 p-0 shadow-2xl duration-300 ease-out data-open:slide-in-from-left-8 data-open:fade-in-0 data-closed:slide-out-to-left-8 data-closed:fade-out-0 sm:max-w-80"
        >
          <DialogTitle className="sr-only">Navigation Menu</DialogTitle>
          <Sidebar
            className="w-full border-r-0"
            currentView={currentView}
            collections={collections}
            selectedCollection={selectedCollection}
            tags={tags}
            scanStatus={scanStatus}
            onOpenSettings={() => setShowSettings(true)}
            onSelectLibrary={showLibrary}
            onSelectFavorites={showFavorites}
            onSelectCollection={showCollection}
            onAction={() => setShowMobileSidebar(false)}
          />
        </DialogContent>
      </Dialog>

      <main className="relative flex min-w-0 flex-1 flex-col bg-background/45 backdrop-blur-xl">
        <header className="shrink-0 border-b border-border/70 bg-background/20 px-4 py-3 backdrop-blur-xl md:px-5">
          <div className="flex h-10 items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="size-10 rounded-xl border border-border/50 bg-card/30 backdrop-blur-md duration-200 animate-in fade-in-0 zoom-in-95 md:hidden active:scale-95"
              onClick={() => setShowMobileSidebar(true)}
              aria-label="Open navigation menu"
            >
              <PanelLeft className="size-4" />
            </Button>

            <div className="relative flex-1 rounded-xl border border-border/50 bg-card/30 px-px py-px backdrop-blur-md duration-300 animate-in fade-in-0 slide-in-from-top-2 md:max-w-xl">
              <div className="relative rounded-lg bg-background/40">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search library..."
                  className="h-8 rounded-lg border-0 bg-transparent pl-10 pr-4 text-sm shadow-none placeholder:text-muted-foreground/70 focus-visible:ring-0"
                />
              </div>
            </div>

            {isLoadingFiles && (
              <Loader2 className="size-4 text-primary animate-spin" />
            )}
          </div>
        </header>

        <FileTable
          files={files}
          directories={directories}
          currentDirectory={selectedDirectory}
          currentPlaylistName={selectedPlaylistName}
          onNavigate={navigateDirectory}
          onNavigateLibrary={showLibrary}
          selectedFileId={selectedFile?.id ?? null}
          isSelectedFilePlaying={isPlayerPlaying}
          onSelect={(file) => {
             if (selectedFile?.id === file.id) {
               audioPlayerRef.current?.togglePlayback();
             } else {
               setSelectedFile(file);
             }
           }}
          onToggleFavorite={handleToggleFavorite}
          searchQuery={deferredSearchQuery}
          isLoading={isLoadingFiles}
        />
        <div
          className={cn(
            "h-0 transition-all duration-300",
            selectedFile && "h-28",
          )}
        />
      </main>

      <AudioPlayer
        ref={audioPlayerRef}
        selectedFile={selectedFile}
        onClose={() => {
          setSelectedFile(null);
          setIsPlayerPlaying(false);
        }}
        onPlaybackChange={setIsPlayerPlaying}
        onToggleFavorite={handleToggleFavorite}
        collections={collections}
        onAddToCollection={handleAddToCollection}
      />

      <SettingsDialog
        open={showSettings}
        onOpenChange={setShowSettings}
        settings={settings}
        onSaveRoot={handleSaveRoot}
        scanStatus={scanStatus}
        onStartScan={handleStartScan}
        collections={collections}
        tags={tags}
        onCreateCollection={handleCreateCollection}
        onDeleteCollection={handleDeleteCollection}
        onCreateTag={handleCreateTag}
      />
    </div>
  );
}
