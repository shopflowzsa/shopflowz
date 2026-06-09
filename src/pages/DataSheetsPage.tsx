import { useState, useEffect, useRef } from "react";
import {
  Upload, FileText, Image, File, X, Download, Trash2, Search,
  Grid, List, Eye, FolderOpen, Folder, Plus, Tag, Maximize2,
  FolderPlus, ChevronRight, MoveRight, Pencil, Check, MoreVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase, supabaseServiceRole } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

interface DataSheetFile {
  id: string;
  name: string;
  type: string;
  size: number;
  url: string;
  category: string;
  folder: string;
  tags: string[];
  description: string;
  uploadedAt: string;
  uploadedBy: string;
}

const BUCKET_NAME = "tech-datasheets";

const FILE_CATEGORIES = [
  { id: "manuals", label: "Manuals", icon: "📖" },
  { id: "schematics", label: "Schematics", icon: "🔧" },
  { id: "datasheets", label: "Data Sheets", icon: "📊" },
  { id: "guides", label: "Guides", icon: "📋" },
  { id: "diagrams", label: "Diagrams", icon: "📐" },
  { id: "photos", label: "Photos", icon: "📷" },
  { id: "other", label: "Other", icon: "📁" },
];

const ACCEPTED_FILE_TYPES = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg,.jpeg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "text/plain": ".txt",
};

export function DataSheetsPage() {
  const { workspace } = useAuth();
  const [files, setFiles] = useState<DataSheetFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [previewFile, setPreviewFile] = useState<DataSheetFile | null>(null);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Folder state
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Move file state
  const [movingFile, setMovingFile] = useState<DataSheetFile | null>(null);

  // Upload form state
  const [uploadName, setUploadName] = useState("");
  const [uploadCategory, setUploadCategory] = useState("other");
  const [uploadFolder, setUploadFolder] = useState("");
  const [uploadTags, setUploadTags] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  useEffect(() => {
    loadFiles();
  }, [workspace?.id]);

  // When entering a folder via upload, pre-select it
  useEffect(() => {
    if (showUploadDialog && selectedFolder) {
      setUploadFolder(selectedFolder);
    }
  }, [showUploadDialog]);

  async function loadFiles() {
    if (!workspace?.id) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("tech_datasheets")
        .select("*")
        .eq("workspace_id", workspace.id)
        .order("uploaded_at", { ascending: false });
      if (error) throw error;
      setFiles(data || []);
      const uniqueFolders = [...new Set(data?.map(f => f.folder).filter(Boolean) || [])];
      setFolders(uniqueFolders.sort());
    } catch (error) {
      console.error("Error loading files:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload() {
    if (!uploadFile || !workspace?.id) return;
    try {
      setUploading(true);
      const fileName = `${Date.now()}_${uploadFile.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
      const filePath = `${workspace.id}/${fileName}`;
      const { error: uploadError } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(filePath, uploadFile, { cacheControl: "3600", upsert: false });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from(BUCKET_NAME).getPublicUrl(filePath);
      const tags = uploadTags.split(",").map(t => t.trim()).filter(Boolean);
      const { error: dbError } = await supabaseServiceRole.from("tech_datasheets").insert({
        workspace_id: workspace.id,
        name: uploadName || uploadFile.name,
        type: uploadFile.type,
        size: uploadFile.size,
        url: urlData.publicUrl,
        storage_path: filePath,
        category: uploadCategory,
        folder: uploadFolder.trim(),
        tags,
        description: uploadDescription,
        uploaded_by: workspace.id,
      });
      if (dbError) throw dbError;
      setShowUploadDialog(false);
      setUploadName(""); setUploadCategory("other"); setUploadFolder("");
      setUploadTags(""); setUploadDescription(""); setUploadFile(null);
      await loadFiles();
    } catch (error) {
      console.error("Error uploading file:", error);
      alert("Failed to upload file. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(file: DataSheetFile) {
    if (!confirm(`Delete "${file.name}"?`)) return;
    try {
      const pathParts = file.url.split(`${BUCKET_NAME}/`);
      const storagePath = pathParts[1];
      if (storagePath) await supabase.storage.from(BUCKET_NAME).remove([storagePath]);
      await supabaseServiceRole.from("tech_datasheets").delete().eq("id", file.id);
      await loadFiles();
    } catch (error) {
      console.error("Error deleting file:", error);
      alert("Failed to delete file.");
    }
  }

  async function handleMoveFile(file: DataSheetFile, targetFolder: string) {
    await supabaseServiceRole.from("tech_datasheets").update({ folder: targetFolder }).eq("id", file.id);
    setMovingFile(null);
    await loadFiles();
  }

  async function handleCreateFolder() {
    const name = newFolderName.trim();
    if (!name || folders.includes(name)) return;
    setFolders(prev => [...prev, name].sort());
    setNewFolderName("");
    setShowNewFolderDialog(false);
    setSelectedFolder(name);
  }

  async function handleDeleteFolder(folder: string) {
    if (!confirm(`Delete folder "${folder}"? Files inside will be moved to "No Folder".`)) return;
    await supabaseServiceRole.from("tech_datasheets")
      .update({ folder: "" })
      .eq("workspace_id", workspace!.id)
      .eq("folder", folder);
    if (selectedFolder === folder) setSelectedFolder(null);
    await loadFiles();
  }

  async function handleRenameFolder(oldName: string) {
    const newName = renameValue.trim();
    if (!newName || newName === oldName) { setRenamingFolder(null); return; }
    await supabaseServiceRole.from("tech_datasheets")
      .update({ folder: newName })
      .eq("workspace_id", workspace!.id)
      .eq("folder", oldName);
    if (selectedFolder === oldName) setSelectedFolder(newName);
    setRenamingFolder(null);
    setRenameValue("");
    await loadFiles();
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      setUploadFile(droppedFile);
      setUploadName(droppedFile.name.replace(/\.[^/.]+$/, ""));
      setShowUploadDialog(true);
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setUploadFile(selectedFile);
      setUploadName(selectedFile.name.replace(/\.[^/.]+$/, ""));
      setShowUploadDialog(true);
    }
  }

  function getFileIcon(type: string) {
    if (type.startsWith("image/")) return <Image className="h-8 w-8 text-green-500" />;
    if (type === "application/pdf") return <FileText className="h-8 w-8 text-red-500" />;
    return <File className="h-8 w-8 text-slate-400" />;
  }

  function getCategoryLabel(categoryId: string) {
    return FILE_CATEGORIES.find(c => c.id === categoryId)?.label || categoryId;
  }

  function getCategoryIcon(categoryId: string) {
    return FILE_CATEGORIES.find(c => c.id === categoryId)?.icon || "📁";
  }

  const filteredFiles = files.filter(file => {
    const matchesSearch =
      !searchQuery ||
      file.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      file.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      file.tags?.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCategory = !selectedCategory || file.category === selectedCategory;
    const matchesFolder = selectedFolder === null
      ? true
      : selectedFolder === "__none__"
        ? !file.folder
        : file.folder === selectedFolder;
    return matchesSearch && matchesCategory && matchesFolder;
  });

  const unfiledCount = files.filter(f => !f.folder).length;

  return (
    <div className="flex h-full bg-background overflow-hidden">
      {/* ── Left folder panel ─────────────────────────────── */}
      <div className="w-52 shrink-0 border-r bg-muted/30 flex flex-col overflow-hidden">
        <div className="p-3 border-b flex items-center justify-between">
          <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Folders</span>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => setShowNewFolderDialog(true)}
            title="New folder"
          >
            <FolderPlus className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {/* All files */}
          <button
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${selectedFolder === null ? "bg-primary/15 text-primary font-medium" : "hover:bg-muted text-foreground"}`}
            onClick={() => setSelectedFolder(null)}
          >
            <FolderOpen className="h-4 w-4 shrink-0" />
            <span className="truncate">All Files</span>
            <span className="ml-auto text-xs text-muted-foreground">{files.length}</span>
          </button>

          {/* Unfiled */}
          {unfiledCount > 0 && (
            <button
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${selectedFolder === "__none__" ? "bg-primary/15 text-primary font-medium" : "hover:bg-muted text-foreground"}`}
              onClick={() => setSelectedFolder("__none__")}
            >
              <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate italic text-muted-foreground">Unfiled</span>
              <span className="ml-auto text-xs text-muted-foreground">{unfiledCount}</span>
            </button>
          )}

          {/* Named folders */}
          {folders.map(folder => {
            const count = files.filter(f => f.folder === folder).length;
            return (
              <div key={folder} className="group relative">
                {renamingFolder === folder ? (
                  <div className="flex items-center gap-1 px-2 py-1">
                    <Input
                      className="h-6 text-xs"
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") handleRenameFolder(folder);
                        if (e.key === "Escape") setRenamingFolder(null);
                      }}
                      autoFocus
                    />
                    <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => handleRenameFolder(folder)}>
                      <Check className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <button
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${selectedFolder === folder ? "bg-primary/15 text-primary font-medium" : "hover:bg-muted text-foreground"}`}
                    onClick={() => setSelectedFolder(folder)}
                  >
                    <Folder className="h-4 w-4 shrink-0 text-amber-500" />
                    <span className="truncate flex-1 text-left">{folder}</span>
                    <span className="text-xs text-muted-foreground">{count}</span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <span
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted-foreground/20"
                          onClick={e => e.stopPropagation()}
                        >
                          <MoreVertical className="h-3 w-3" />
                        </span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent side="right" align="start">
                        <DropdownMenuItem onClick={e => { e.stopPropagation(); setRenamingFolder(folder); setRenameValue(folder); }}>
                          <Pencil className="h-3.5 w-3.5 mr-2" /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={e => { e.stopPropagation(); handleDeleteFolder(folder); }}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete Folder
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="p-2 border-t">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => setShowNewFolderDialog(true)}
          >
            <FolderPlus className="h-3.5 w-3.5 mr-1.5" />
            New Folder
          </Button>
        </div>
      </div>

      {/* ── Main area ──────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 border-b bg-card px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm">
              <span
                className="text-muted-foreground hover:text-foreground cursor-pointer"
                onClick={() => setSelectedFolder(null)}
              >
                Tech Data Sheets
              </span>
              {selectedFolder && selectedFolder !== "__none__" && (
                <>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  <span className="font-semibold">{selectedFolder}</span>
                </>
              )}
              {selectedFolder === "__none__" && (
                <>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  <span className="font-semibold italic text-muted-foreground">Unfiled</span>
                </>
              )}
              <Badge variant="secondary" className="ml-1">{filteredFiles.length} files</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setViewMode("grid")} className={viewMode === "grid" ? "bg-primary/20" : ""}>
                <Grid className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setViewMode("list")} className={viewMode === "list" ? "bg-primary/20" : ""}>
                <List className="h-4 w-4" />
              </Button>
              <Button onClick={() => { setUploadFolder(selectedFolder && selectedFolder !== "__none__" ? selectedFolder : ""); setShowUploadDialog(true); }}>
                <Plus className="h-4 w-4 mr-1" />
                Upload File
              </Button>
            </div>
          </div>

          {/* Search & category filters */}
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search files..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              <Button variant={selectedCategory === null ? "secondary" : "outline"} size="sm" onClick={() => setSelectedCategory(null)}>
                All
              </Button>
              {FILE_CATEGORIES.map(cat => (
                <Button
                  key={cat.id}
                  variant={selectedCategory === cat.id ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setSelectedCategory(cat.id)}
                >
                  {cat.icon} {cat.label}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* File list */}
        <div
          className="flex-1 overflow-auto p-4"
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground">Loading files...</p>
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className={`flex flex-col items-center justify-center h-full border-2 border-dashed rounded-lg transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-muted"}`}>
              <Upload className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium mb-2">No files here</p>
              <p className="text-muted-foreground mb-4">Drag and drop files, or click to upload</p>
              <Button onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4 mr-2" /> Upload File
              </Button>
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {filteredFiles.map(file => (
                <div
                  key={file.id}
                  className="group relative bg-card border rounded-lg p-3 hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => setPreviewFile(file)}
                >
                  <div className="flex flex-col items-center text-center">
                    {getFileIcon(file.type)}
                    <p className="mt-2 text-sm font-medium truncate w-full" title={file.name}>{file.name}</p>
                    <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                    {file.folder && (
                      <p className="text-xs text-amber-600 truncate w-full mt-0.5">
                        <Folder className="inline h-3 w-3 mr-0.5" />{file.folder}
                      </p>
                    )}
                    <Badge variant="outline" className="mt-1 text-xs">
                      {getCategoryIcon(file.category)} {getCategoryLabel(file.category)}
                    </Badge>
                  </div>
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={e => e.stopPropagation()}>
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={e => { e.stopPropagation(); window.open(file.url, "_blank"); }}>
                          <Download className="h-3.5 w-3.5 mr-2" /> Download
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={e => { e.stopPropagation(); setMovingFile(file); }}>
                          <MoveRight className="h-3.5 w-3.5 mr-2" /> Move to Folder
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={e => { e.stopPropagation(); handleDelete(file); }}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredFiles.map(file => (
                <div
                  key={file.id}
                  className="group flex items-center gap-3 bg-card border rounded-lg px-3 py-2 hover:shadow-sm transition-shadow cursor-pointer"
                  onClick={() => setPreviewFile(file)}
                >
                  {getFileIcon(file.type)}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{file.name}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                      <span>{formatFileSize(file.size)}</span>
                      <span>•</span>
                      <span>{getCategoryIcon(file.category)} {getCategoryLabel(file.category)}</span>
                      {file.folder && (
                        <>
                          <span>•</span>
                          <span className="text-amber-600"><Folder className="inline h-3 w-3 mr-0.5" />{file.folder}</span>
                        </>
                      )}
                      {file.tags && file.tags.length > 0 && (
                        <>
                          <span>•</span>
                          <span>{file.tags.join(", ")}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={e => { e.stopPropagation(); window.open(file.url, "_blank"); }}>
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={e => { e.stopPropagation(); const a = document.createElement("a"); a.href = file.url; a.download = file.name; a.click(); }}>
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-indigo-500 hover:text-indigo-600" onClick={e => { e.stopPropagation(); setMovingFile(file); }} title="Move to folder">
                      <MoveRight className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={e => { e.stopPropagation(); handleDelete(file); }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Hidden file input */}
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelect} accept={Object.values(ACCEPTED_FILE_TYPES).join(",")} />

      {/* New Folder Dialog */}
      <Dialog open={showNewFolderDialog} onOpenChange={setShowNewFolderDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderPlus className="h-5 w-5 text-amber-500" /> New Folder
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              placeholder="Folder name (e.g. Samsung, LG TVs)"
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleCreateFolder()}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setShowNewFolderDialog(false); setNewFolderName(""); }}>Cancel</Button>
              <Button onClick={handleCreateFolder} disabled={!newFolderName.trim()}>Create Folder</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Move to Folder Dialog */}
      <Dialog open={!!movingFile} onOpenChange={() => setMovingFile(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MoveRight className="h-5 w-5" /> Move "{movingFile?.name}"
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Choose a destination folder:</p>
            <button
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-muted border border-transparent hover:border-muted-foreground/20 transition-colors"
              onClick={() => movingFile && handleMoveFile(movingFile, "")}
            >
              <Folder className="h-4 w-4 text-muted-foreground" />
              <span className="italic text-muted-foreground">No Folder (Unfiled)</span>
            </button>
            {folders.map(folder => (
              <button
                key={folder}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-muted border transition-colors ${movingFile?.folder === folder ? "border-primary bg-primary/10" : "border-transparent hover:border-muted-foreground/20"}`}
                onClick={() => movingFile && handleMoveFile(movingFile, folder)}
              >
                <Folder className="h-4 w-4 text-amber-500" />
                {folder}
                {movingFile?.folder === folder && <span className="ml-auto text-xs text-muted-foreground">(current)</span>}
              </button>
            ))}
            <div className="pt-2 border-t">
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => { setMovingFile(null); setShowNewFolderDialog(true); }}
              >
                <FolderPlus className="h-3.5 w-3.5 mr-1.5" /> Create New Folder
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Upload Dialog */}
      <Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload File</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {uploadFile ? (
              <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                {getFileIcon(uploadFile.type)}
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{uploadFile.name}</p>
                  <p className="text-sm text-muted-foreground">{formatFileSize(uploadFile.size)}</p>
                </div>
                <Button size="icon" variant="ghost" onClick={() => { setUploadFile(null); setUploadName(""); }}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div
                className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center cursor-pointer hover:border-muted-foreground/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-sm text-muted-foreground">Click to select a file</p>
              </div>
            )}

            <div>
              <label className="text-sm font-medium">File Name</label>
              <Input value={uploadName} onChange={e => setUploadName(e.target.value)} placeholder="Enter file name" />
            </div>

            <div>
              <label className="text-sm font-medium">Folder</label>
              <div className="mt-1 space-y-1">
                <select
                  className="w-full h-9 rounded-md border bg-background px-3 text-sm"
                  value={uploadFolder}
                  onChange={e => setUploadFolder(e.target.value)}
                >
                  <option value="">— No Folder —</option>
                  {folders.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
                <p className="text-xs text-muted-foreground">Or type a new folder name:</p>
                <Input
                  placeholder="New folder name..."
                  value={uploadFolder}
                  onChange={e => setUploadFolder(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Category</label>
              <div className="flex flex-wrap gap-2 mt-1">
                {FILE_CATEGORIES.map(cat => (
                  <Button
                    key={cat.id}
                    variant={uploadCategory === cat.id ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => setUploadCategory(cat.id)}
                  >
                    {cat.icon} {cat.label}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Tags (comma-separated)</label>
              <Input value={uploadTags} onChange={e => setUploadTags(e.target.value)} placeholder="e.g., samsung, tv, repair" />
            </div>

            <div>
              <label className="text-sm font-medium">Description</label>
              <textarea
                className="w-full min-h-[60px] px-3 py-2 text-sm rounded-md border bg-background"
                value={uploadDescription}
                onChange={e => setUploadDescription(e.target.value)}
                placeholder="Optional description..."
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowUploadDialog(false)}>Cancel</Button>
              <Button onClick={handleUpload} disabled={!uploadFile || uploading}>
                {uploading ? "Uploading..." : "Upload"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={!!previewFile} onOpenChange={() => setPreviewFile(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <div className="flex items-center justify-between w-full pr-8">
              <DialogTitle className="truncate">{previewFile?.name}</DialogTitle>
              <Button variant="outline" size="sm" onClick={() => window.open(previewFile?.url, "_blank")} className="ml-2 shrink-0">
                <Maximize2 className="h-4 w-4 mr-1" /> Full Screen
              </Button>
            </div>
          </DialogHeader>
          <div className="space-y-4">
            {previewFile?.type.startsWith("image/") ? (
              <div className="flex justify-center">
                <img src={previewFile.url} alt={previewFile.name} className="max-w-full max-h-[60vh] object-contain rounded-lg" />
              </div>
            ) : previewFile?.type === "application/pdf" ? (
              <iframe src={previewFile.url} className="w-full h-[60vh] rounded-lg" title={previewFile.name} />
            ) : (
              <div className="flex flex-col items-center justify-center py-12">
                <File className="h-16 w-16 text-muted-foreground mb-4" />
                <p className="text-muted-foreground mb-4">Preview not available</p>
                <Button onClick={() => window.open(previewFile?.url, "_blank")}>
                  <Download className="h-4 w-4 mr-2" /> Download to View
                </Button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">
                {getCategoryIcon(previewFile?.category || "")} {getCategoryLabel(previewFile?.category || "")}
              </Badge>
              {previewFile?.folder && (
                <Badge variant="outline" className="text-amber-600 border-amber-300">
                  <Folder className="h-3 w-3 mr-1" />{previewFile.folder}
                </Badge>
              )}
              {previewFile?.tags?.map(tag => (
                <Badge key={tag} variant="secondary">
                  <Tag className="h-3 w-3 mr-1" />{tag}
                </Badge>
              ))}
            </div>
            {previewFile?.description && (
              <p className="text-sm text-muted-foreground">{previewFile.description}</p>
            )}
            <div className="flex justify-between items-center text-sm text-muted-foreground">
              <span>Size: {formatFileSize(previewFile?.size || 0)}</span>
              <span>Uploaded: {new Date(previewFile?.uploadedAt || "").toLocaleDateString()}</span>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
