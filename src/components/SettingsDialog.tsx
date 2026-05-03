"use client";

import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Database,
  ListMusic,
  FolderOpen,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Tag as TagIcon,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type ValidationResult = {
  valid: boolean;
  normalizedPath: string | null;
  readable: boolean;
  audioFileCount: number;
  samples: string[];
  error: string | null;
};

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: {
    libraryRoot: string | null;
    stats: { activeFiles: number; removedFiles: number };
  };
  onSaveRoot: (path: string) => Promise<void>;
  scanStatus: {
    running: boolean;
    phase: string;
    discovered: number;
    added: number;
    updated: number;
    removed: number;
    failed: number;
    error: string | null;
  };
  onStartScan: () => Promise<void>;
  collections: { id: string; name: string; fileCount?: number }[];
  tags: { id: string; name: string; color: string }[];
  onCreateCollection: (name: string) => Promise<void>;
  onDeleteCollection: (id: string) => Promise<void>;
  onCreateTag: (name: string) => Promise<void>;
}

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onSaveRoot,
  scanStatus,
  onStartScan,
  collections,
  tags,
  onCreateCollection,
  onDeleteCollection,
  onCreateTag,
}: SettingsDialogProps) {
  const resetKey = `${open ? "open" : "closed"}:${settings.libraryRoot ?? ""}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col overflow-hidden border-border/70 bg-popover/92 p-0 backdrop-blur-2xl sm:max-w-3xl">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,color-mix(in_oklab,var(--primary)_12%,transparent),transparent_34%)]" />
        <DialogHeader className="relative border-b border-border/70 px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-xl font-bold">
            <Database className="size-5 text-primary" />
            Settings
          </DialogTitle>
          <DialogDescription>
            Configure your library folder, scan your files, and manage metadata.
          </DialogDescription>
        </DialogHeader>

        {open ? (
          <SettingsDialogBody
            key={resetKey}
            settings={settings}
            onSaveRoot={onSaveRoot}
            scanStatus={scanStatus}
            onStartScan={onStartScan}
            collections={collections}
            tags={tags}
            onCreateCollection={onCreateCollection}
            onDeleteCollection={onDeleteCollection}
            onCreateTag={onCreateTag}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

type SettingsDialogBodyProps = Pick<
  SettingsDialogProps,
  | "settings"
  | "onSaveRoot"
  | "scanStatus"
  | "onStartScan"
  | "collections"
  | "tags"
  | "onCreateCollection"
  | "onDeleteCollection"
  | "onCreateTag"
>;

function SettingsDialogBody({
  settings,
  onSaveRoot,
  scanStatus,
  onStartScan,
  collections,
  tags,
  onCreateCollection,
  onDeleteCollection,
  onCreateTag,
}: SettingsDialogBodyProps) {
  const [rootDraft, setRootDraft] = useState(settings.libraryRoot ?? "");
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isStartingScan, setIsStartingScan] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [newTagName, setNewTagName] = useState("");

  const hasPathChanged = rootDraft.trim() !== (settings.libraryRoot ?? "");

  const validatePath = async () => {
    const path = rootDraft.trim();

    setIsValidating(true);

    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "validate", path }),
      });
      const result = (await response.json()) as ValidationResult;

      setValidationResult(result);

      if (!response.ok || !result.valid) {
        return result;
      }

      return result;
    } catch (error) {
      const result: ValidationResult = {
        valid: false,
        normalizedPath: null,
        readable: false,
        audioFileCount: 0,
        samples: [],
        error: error instanceof Error ? error.message : "Validation failed.",
      };
      setValidationResult(result);
      return result;
    } finally {
      setIsValidating(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);

    try {
      const validation = await validatePath();
      if (!validation?.valid || validation.normalizedPath === null) {
        toast.error(validation?.error ?? "Choose a valid library prefix");
        return;
      }

      await onSaveRoot(validation.normalizedPath);
      setRootDraft(validation.normalizedPath);
      setValidationResult(validation);
      toast.success("Library path saved");
    } finally {
      setIsSaving(false);
    }
  };

  const handleStartScan = async () => {
    setIsStartingScan(true);

    try {
      await onStartScan();
    } finally {
      setIsStartingScan(false);
    }
  };

  const handleCreateCollection = async () => {
    const name = newCollectionName.trim();
    if (!name) return;

    await onCreateCollection(name);
    setNewCollectionName("");
  };

  const handleDeleteCollection = async (id: string, name: string) => {
    const confirmed = window.confirm(`Delete playlist "${name}"? Files will stay in your library.`);
    if (!confirmed) return;

    await onDeleteCollection(id);
  };

  const handleCreateTag = async () => {
    const name = newTagName.trim();
    if (!name) return;

    await onCreateTag(name);
    setNewTagName("");
  };

  return (
    <Tabs defaultValue="library" className="relative flex min-h-0 flex-1 flex-col">
          <div className="border-b border-border/70 bg-card/30 px-6 py-3 backdrop-blur-xl">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="library">Library</TabsTrigger>
              <TabsTrigger value="metadata">Playlists & Tags</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="library" className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className="space-y-6">
              <section className="space-y-4 rounded-2xl border border-border/60 bg-card/45 p-4 backdrop-blur">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      <FolderOpen className="size-4 text-primary" />
                      R2 Prefix
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Leave blank to scan the whole R2 bucket, or enter a bucket prefix.
                    </p>
                  </div>
                  {settings.libraryRoot ? (
                    <Badge variant="secondary">Configured</Badge>
                  ) : (
                    <Badge variant="outline">Bucket root</Badge>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={rootDraft}
                      onChange={(event) => {
                        setRootDraft(event.target.value);
                        setValidationResult(null);
                      }}
                      placeholder="audio/ or leave blank"
                      className="h-10 flex-1 font-mono text-sm"
                    />
                    <Button
                      variant="outline"
                      onClick={validatePath}
                      disabled={isValidating}
                    >
                      {isValidating ? (
                        <Loader2 className="mr-2 size-4 animate-spin" />
                      ) : null}
                      Validate
                    </Button>
                  </div>

                  {settings.libraryRoot ? (
                    <p className="text-xs text-muted-foreground">
                      Current: <span className="font-mono">{settings.libraryRoot}</span>
                    </p>
                  ) : null}

                  {validationResult ? (
                    <ValidationMessage result={validationResult} />
                  ) : null}

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-muted-foreground">
                      Saving a new prefix resets the indexed library and requires a scan.
                    </p>
                    <Button
                      onClick={handleSave}
                      disabled={isSaving || isValidating || !hasPathChanged}
                      className="gap-2"
                    >
                      {isSaving ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Save className="size-4" />
                      )}
                      Save R2 Prefix
                    </Button>
                  </div>
                </div>
              </section>

              <Separator />

              <section className="space-y-4 rounded-2xl border border-border/60 bg-card/45 p-4 backdrop-blur">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold">Scan Library</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Index new files, refresh changed files, and mark removed files.
                    </p>
                  </div>
                  <Button
                    onClick={handleStartScan}
                    disabled={scanStatus.running || isStartingScan}
                    variant={scanStatus.running ? "outline" : "default"}
                    className="gap-2"
                  >
                    {scanStatus.running || isStartingScan ? (
                      <RefreshCw className="size-4 animate-spin" />
                    ) : null}
                    {scanStatus.running ? "Scanning" : "Scan Library"}
                  </Button>
                </div>

                {scanStatus.error ? (
                  <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                    {scanStatus.error}
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <ScanStat label="Phase" value={scanStatus.phase} />
                  <ScanStat label="Found" value={scanStatus.discovered} />
                  <ScanStat label="Added" value={`+${scanStatus.added}`} />
                  <ScanStat label="Updated" value={`~${scanStatus.updated}`} />
                  <ScanStat label="Removed" value={`-${scanStatus.removed}`} />
                </div>
              </section>
            </div>
          </TabsContent>

          <TabsContent value="metadata" className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className="space-y-8">
              <section className="space-y-4 rounded-2xl border border-border/60 bg-card/45 p-4 backdrop-blur">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <ListMusic className="size-4" /> Playlists
                  </h3>
                  <Badge variant="secondary">{collections.length}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  Save custom groups of sounds for projects, moods, cues, or frequently used kits.
                </p>
                <div className="flex gap-2">
                  <Input
                    placeholder="New playlist name..."
                    value={newCollectionName}
                    onChange={(event) => setNewCollectionName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void handleCreateCollection();
                    }}
                  />
                  <Button size="icon" onClick={handleCreateCollection} disabled={!newCollectionName.trim()}>
                    <Plus className="size-4" />
                  </Button>
                </div>
                <div className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border/70 bg-background/30">
                  {collections.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground">
                      No playlists yet. Create one, then add sounds from the audio player.
                    </div>
                  ) : (
                    collections.map((collection) => (
                      <div key={collection.id} className="flex items-center gap-3 px-4 py-3">
                        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <ListMusic className="size-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{collection.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {collection.fileCount ?? 0} {(collection.fileCount ?? 0) === 1 ? "sound" : "sounds"}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDeleteCollection(collection.id, collection.name)}
                          aria-label={`Delete ${collection.name}`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <Separator />

              <section className="space-y-4 rounded-2xl border border-border/60 bg-card/45 p-4 backdrop-blur">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <TagIcon className="size-4" /> Tags
                  </h3>
                  <Badge variant="secondary">{tags.length}</Badge>
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="New tag name..."
                    value={newTagName}
                    onChange={(event) => setNewTagName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void handleCreateTag();
                    }}
                  />
                  <Button size="icon" onClick={handleCreateTag} disabled={!newTagName.trim()}>
                    <Plus className="size-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <Badge
                      key={tag.id}
                      variant="outline"
                      className="px-3 py-1"
                      style={{
                        borderColor: `${tag.color}60`,
                        color: tag.color,
                        backgroundColor: `${tag.color}10`,
                      }}
                    >
                      {tag.name}
                    </Badge>
                  ))}
                </div>
              </section>
            </div>
          </TabsContent>
        </Tabs>
  );
}

function ValidationMessage({ result }: { result: ValidationResult }) {
  return (
    <div
      className={cn(
        "flex gap-3 rounded-xl border p-4 text-sm",
        result.valid
          ? "border-primary/30 bg-primary/10 text-foreground"
          : "border-destructive/30 bg-destructive/10 text-destructive",
      )}
    >
      {result.valid ? (
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" />
      ) : (
        <AlertCircle className="mt-0.5 size-5 shrink-0" />
      )}
      <div className="min-w-0">
        <p className="font-semibold">
          {result.valid ? "Folder is valid" : "Folder is not valid"}
        </p>
        <p className="mt-1 text-muted-foreground">
          {result.valid
            ? `Found ${result.audioFileCount} supported audio files.`
            : result.error}
        </p>
        {result.valid && result.normalizedPath ? (
          <p className="mt-2 truncate font-mono text-xs text-muted-foreground">
            {result.normalizedPath}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ScanStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-muted/40 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 truncate font-mono text-base font-bold text-foreground">
        {value}
      </p>
    </div>
  );
}
