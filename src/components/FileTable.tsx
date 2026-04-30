"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Folder,
  FolderOpen,
  GripVertical,
  Heart,
  ListMusic,
  MoreHorizontal,
  Pause,
  Play,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getDesktopBridge, isDesktopApp } from "@/lib/desktop";
import { cn, formatDuration } from "@/lib/utils";

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

interface FileTableProps {
  files: FileRecord[];
  directories: string[];
  currentDirectory: string | null;
  currentPlaylistName?: string | null;
  onNavigate: (dir: string | null) => void;
  onNavigateLibrary?: () => void;
  selectedFileId: string | null;
  isSelectedFilePlaying?: boolean;
  onSelect: (file: FileRecord, index: number) => void;
  onToggleFavorite: (id: string) => Promise<void>;
  searchQuery: string;
  isLoading: boolean;
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const parts = text.split(new RegExp(`(${query})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark
        key={i}
        className="rounded-sm bg-primary/30 px-0.5 text-primary-foreground"
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

export function FileTable({
  files,
  directories,
  currentDirectory,
  currentPlaylistName,
  onNavigate,
  onNavigateLibrary,
  selectedFileId,
  isSelectedFilePlaying = false,
  onSelect,
  onToggleFavorite,
  searchQuery,
  isLoading,
}: FileTableProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [draggingFile, setDraggingFile] = useState<string | null>(null);
  const desktop = isDesktopApp();
  const items = [
    ...directories.map((d) => ({ type: "directory" as const, data: d })),
    ...files.map((f) => ({ type: "file" as const, data: f })),
  ];

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    overscan: 20,
  });

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) {
      return;
    }

    return bridge.onActionError((message) => {
      toast.error(message);
      setDraggingFile(null);
    });
  }, []);

  const handleBack = () => {
    if (!currentDirectory) {
      onNavigateLibrary?.();
      return;
    }

    const parts = currentDirectory.split(/[\\/]/);
    parts.pop();
    onNavigate(parts.length > 0 ? parts.join("/") : null);
  };

  const handleNavigateLibrary = () => {
    if (onNavigateLibrary) {
      onNavigateLibrary();
      return;
    }

    onNavigate(null);
  };

  const handleCopyPath = async (file: FileRecord) => {
    if (desktop) {
      const result = await getDesktopBridge()?.copyFilePath(file.id);
      if (result?.ok) {
        toast.success("File path copied", {
          action: {
            label: "Copy",
            onClick: () => navigator.clipboard.writeText(file.path),
          },
        });
        return;
      }

      toast.error(result?.error ?? "Failed to copy file path");
      return;
    }

    try {
      await navigator.clipboard.writeText(file.path);
      toast.success("File path copied");
    } catch {
      toast.error("Failed to copy file path");
    }
  };

  const handleRevealInExplorer = async (file: FileRecord) => {
    const result = await getDesktopBridge()?.revealInExplorer(file.id);
    if (result?.ok) {
      return;
    }

    toast.error(result?.error ?? "Failed to reveal file in Explorer");
  };

  const handleOpenFile = async (file: FileRecord) => {
    const result = await getDesktopBridge()?.openFileExternally(file.id);
    if (result?.ok) {
      return;
    }

    toast.error(result?.error ?? "Failed to open file");
  };

  const handleNativeDragStart = (
    event: React.DragEvent<HTMLElement>,
    file: FileRecord,
    index: number,
  ) => {
    if (!desktop) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", file.filename);
    console.info("Starting native drag", file.path);
    onSelect(file, index);
    setDraggingFile(file.id);
    getDesktopBridge()?.startDragFile(file.id, file.path);
  };

  const handleDragEnd = () => {
    setDraggingFile(null);
  };

  if (items.length === 0 && !isLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-muted-foreground">
        <div className="mb-4 flex size-16 items-center justify-center rounded-full border border-border bg-card/70 shadow-lg backdrop-blur">
          <Play className="size-8 opacity-20" />
        </div>
        <h3 className="text-lg font-medium">No sounds found</h3>
        {(currentDirectory || currentPlaylistName) && (
          <Button
            variant="outline"
            size="sm"
            className="mt-4 gap-2"
            onClick={handleBack}
          >
            <ChevronLeft className="size-4" /> Go Back
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {(currentDirectory || currentPlaylistName) && !searchQuery && (
        <div className="flex items-center gap-2 border-b border-border/70 bg-card/35 px-6 py-2 backdrop-blur-xl">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-full"
            onClick={handleBack}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <div className="flex items-center gap-1 overflow-hidden text-xs font-medium text-muted-foreground">
            <span
              className="cursor-pointer hover:text-foreground"
              onClick={handleNavigateLibrary}
            >
              Library
            </span>
            {currentDirectory
              ? currentDirectory.split(/[\\/]/).map((part, i, arr) => (
                  <span key={i} className="flex items-center gap-1">
                    <span className="opacity-40">/</span>
                    <span
                      className={cn(
                        "max-w-[150px] cursor-pointer truncate hover:text-foreground",
                        i === arr.length - 1 && "font-bold text-foreground",
                      )}
                      onClick={() => onNavigate(arr.slice(0, i + 1).join("/"))}
                    >
                      {part}
                    </span>
                  </span>
                ))
              : null}
            {currentPlaylistName ? (
              <>
                <span className="opacity-40">/</span>
                <span className="flex max-w-[220px] items-center gap-1 truncate font-bold text-foreground">
                  <ListMusic className="size-3" />
                  {currentPlaylistName}
                </span>
              </>
            ) : null}
          </div>
        </div>
      )}

      <div
        ref={parentRef}
        className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-border"
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const item = items[virtualRow.index];

            if (item.type === "directory") {
              const dir = item.data;
              const label = dir.split(/[\\/]/).pop() || dir;

              return (
                <div
                  key={`dir-${dir}`}
                  className="group absolute left-0 top-0 flex w-full cursor-pointer items-center gap-4 border-b border-border/35 px-4 py-2 transition-colors hover:bg-card/65 hover:backdrop-blur"
                  style={{
                    height: "64px",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  onClick={() => onNavigate(dir)}
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
                    <Folder className="size-5 fill-primary/5 transition-colors group-hover:text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {label}
                    </div>
                    <div className="mt-0.5 text-[10px] font-bold uppercase tracking-tight text-muted-foreground">
                      Folder
                    </div>
                  </div>
                  <ChevronRight className="mr-2 size-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
                </div>
              );
            }

            const file = item.data;
            const isSelected = selectedFileId === file.id;
            const isDragging = draggingFile === file.id;
            const showDesktopActions = desktop && (isSelected || isDragging);

            return (
              <ContextMenu key={`file-${file.id}`}>
                <ContextMenuTrigger>
                  <div
                    className={cn(
                      "group absolute left-0 top-0 flex w-full cursor-pointer items-center gap-4 border-b border-border/35 px-4 py-2 transition-colors",
                      isSelected
                        ? "bg-card/80 shadow-[inset_3px_0_0_var(--primary)] backdrop-blur"
                        : "hover:bg-card/65 hover:backdrop-blur",
                      isDragging && "opacity-60",
                    )}
                    style={{
                      height: "64px",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    onClick={() => onSelect(file, virtualRow.index)}
                  >
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted/45 ring-1 ring-border/50">
                      {isSelected && isSelectedFilePlaying ? (
                        <Pause
                          className={cn(
                            "size-4 fill-current text-primary transition-all",
                          )}
                        />
                      ) : (
                        <Play
                          className={cn(
                            "size-4 transition-all",
                            isSelected
                              ? "fill-current text-primary"
                              : "text-muted-foreground/60 group-hover:text-muted-foreground",
                          )}
                        />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground transition-colors group-hover:text-primary">
                        {highlightMatch(file.filename, searchQuery)}
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <span className="rounded bg-muted/80 px-1.5 py-0.5 text-[9px] ring-1 ring-border/50">
                          {file.format ?? "???"}
                        </span>
                        <span>{formatDuration(file.duration)}</span>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      {desktop ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <div
                                role="button"
                                tabIndex={0}
                                draggable
                                className={cn(
                                  "flex size-8 items-center justify-center rounded-full text-muted-foreground/65 opacity-0 transition-all group-hover:opacity-100",
                                  showDesktopActions && "opacity-100",
                                  isDragging && "cursor-grabbing",
                                  !isDragging &&
                                    "cursor-grab hover:bg-accent hover:text-foreground",
                                )}
                                onClick={(event) => event.stopPropagation()}
                                onMouseDown={(event) => {
                                  event.stopPropagation();
                                  if (event.button === 0) {
                                    onSelect(file, virtualRow.index);
                                  }
                                }}
                                onDragStart={(event) =>
                                  handleNativeDragStart(
                                    event,
                                    file,
                                    virtualRow.index,
                                  )
                                }
                                onDragEnd={handleDragEnd}
                                aria-label="Drag file into another app"
                              >
                                <GripVertical className="size-4" />
                              </div>
                            }
                          />
                          <TooltipContent>Drag into another app</TooltipContent>
                        </Tooltip>
                      ) : null}

                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon"
                              className={cn(
                                "size-8 rounded-full transition-all",
                                file.isFavorite
                                  ? "bg-red-500/10 text-red-500 hover:bg-red-500/20 hover:text-red-600"
                                  : "text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground",
                              )}
                              onClick={(event) => {
                                event.stopPropagation();
                                void onToggleFavorite(file.id);
                              }}
                            >
                              <Heart
                                className={cn(
                                  "size-4",
                                  file.isFavorite && "fill-current",
                                )}
                              />
                            </Button>
                          }
                        />
                        <TooltipContent>
                          {file.isFavorite
                            ? "Remove from favorites"
                            : "Add to favorites"}
                        </TooltipContent>
                      </Tooltip>

                      {desktop ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon"
                                className={cn(
                                  "size-8 rounded-full text-muted-foreground/60 opacity-0 transition-all hover:bg-accent hover:text-foreground group-hover:opacity-100",
                                  isSelected && "opacity-100",
                                )}
                                onClick={(event) => event.stopPropagation()}
                                aria-label="More file actions"
                              >
                                <MoreHorizontal className="size-4" />
                              </Button>
                            }
                          />
                          <DropdownMenuContent
                            align="end"
                            className="w-44 rounded-xl border-border/60 bg-popover/95 backdrop-blur-xl"
                          >
                            <DropdownMenuItem
                              onClick={() => void handleRevealInExplorer(file)}
                            >
                              <FolderOpen className="size-4" />
                              Reveal in Explorer
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => void handleOpenFile(file)}
                            >
                              <ExternalLink className="size-4" />
                              Open file
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => void handleCopyPath(file)}
                            >
                              <Copy className="size-4" />
                              Copy path
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}

                      <ChevronRight
                        className={cn(
                          "size-4 text-muted-foreground transition-transform",
                          isSelected
                            ? "translate-x-1 text-primary"
                            : "group-hover:translate-x-0.5",
                        )}
                      />
                    </div>
                  </div>
                </ContextMenuTrigger>

                <ContextMenuContent className="w-44">
                  <ContextMenuLabel>{file.filename}</ContextMenuLabel>
                  <ContextMenuSeparator />
                  {desktop ? (
                    <>
                      <ContextMenuItem
                        onClick={() => void handleRevealInExplorer(file)}
                      >
                        <FolderOpen />
                        Reveal in Explorer
                      </ContextMenuItem>
                      <ContextMenuItem
                        onClick={() => void handleOpenFile(file)}
                      >
                        <ExternalLink />
                        Open file
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                    </>
                  ) : null}
                  <ContextMenuItem onClick={() => void handleCopyPath(file)}>
                    <Copy />
                    Copy path
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>
      </div>
    </div>
  );
}
