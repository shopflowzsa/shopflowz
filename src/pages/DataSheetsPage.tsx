import { useState, useEffect, useRef } from "react";
import {
  Upload, FileText, Image, File, X, Download, Trash2, Search,
  Grid, List, Eye, FolderOpen, Folder, Plus, Tag, Maximize2,
  FolderPlus, ChevronRight, MoveRight, Pencil, Check, MoreVertical,
  FileSpreadsheet, FileArchive, FolderInput, CheckSquare, Square, ChevronDown,
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
import { getFileDownloadUrl } from "@/lib/cloudinaryService";
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
  storage_path: string;
  category: string;
  folder: string;
  tags: string[];
  description: string;
  uploaded_at: string;
  uploaded_by: string;
}

interface QueuedFile {
  file: File;
  folderPath: string; // destination folder in the app (may be nested e.g. "jbl/pro")
}

interface FolderNode {
  name: string;   // display segment (e.g. "pro")
  path: string;   // full path (e.g. "jbl/pro")
  children: FolderNode[];
}

function buildFolderTree(paths: string[]): FolderNode[] {
  const root: FolderNode[] = [];
  for (const path of paths.filter(Boolean).sort()) {
    const parts = path.split("/");
    let level = root;
    let cur = "";
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      let node = level.find(n => n.path === cur);
      if (!node) { node = { name: part, path: cur, children: [] }; level.push(node); }
      level = node.children;
    }
  }
  return root;
}

const FILE_CATEGORIES = [
  { id: "manuals", label: "Manuals", icon: "📖" },
  { id: "schematics", label: "Schematics", icon: "🔧" },
  { id: "datasheets", label: "Data Sheets", icon: "📊" },
  { id: "guides", label: "Guides", icon: "📋" },
  { id: "diagrams", label: "Diagrams", icon: "📐" },
  { id: "photos", label: "Photos", icon: "📷" },
  { id: "other", label: "Other", icon: "📁" },
];

const STORAGE_BUCKET = "datasheets";
let bucketReady = false;

async function ensureBucket() {
  if (bucketReady) return;
  bucketReady = true; // set optimistically — prevents repeated calls; upload itself will error if bucket truly missing
  await supabaseServiceRole.storage.createBucket(STORAGE_BUCKET, {
    public: true,
    fileSizeLimit: 104857600, // 100 MB
  }).catch(() => {}); // silently ignore — bucket likely already exists
}

async function uploadToStorage(file: File, workspaceId: string): Promise<{ url: string; storagePath: string }> {
  await ensureBucket();
  const safeName = file.name.replace(/[^a-zA-Z0-9._\-]/g, "_");
  const storagePath = `${workspaceId}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabaseServiceRole.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (error) throw error;
  const { data: { publicUrl } } = supabaseServiceRole.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(storagePath);
  return { url: publicUrl, storagePath };
}

// Recursively collect all files from DataTransfer items (supports dropped folders)
async function collectFromDataTransferItems(items: DataTransferItem[], baseFolder: string): Promise<QueuedFile[]> {
  const result: QueuedFile[] = [];

  async function readEntry(entry: FileSystemEntry, folder: string) {
    if (entry.isFile) {
      await new Promise<void>(resolve => {
        (entry as FileSystemFileEntry).file(f => {
          result.push({ file: f, folderPath: folder });
          resolve();
        });
      });
    } else if (entry.isDirectory) {
      const subFolder = folder ? `${folder}/${entry.name}` : entry.name;
      await readDirectory(entry as FileSystemDirectoryEntry, subFolder);
    }
  }

  async function readDirectory(dirEntry: FileSystemDirectoryEntry, folder: string) {
    const reader = dirEntry.createReader();
    let batch: FileSystemEntry[];
    do {
      batch = await new Promise(resolve => reader.readEntries(resolve));
      for (const entry of batch) await readEntry(entry, folder);
    } while (batch.length > 0);
  }

  for (const item of items) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) await readEntry(entry, baseFolder);
  }

  return result;
}

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
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Folder panel state
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [showNewFolderDialog, setShowNewFolderDialog] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderParent, setNewFolderParent] = useState<string>(""); // "" = root
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [movingFile, setMovingFile] = useState<DataSheetFile | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkMoveDialog, setShowBulkMoveDialog] = useState(false);
  const [movingFolder, setMovingFolder] = useState<string | null>(null);

  // Upload form state
  const [uploadName, setUploadName] = useState("");
  const [uploadCategory, setUploadCategory] = useState("other");
  const [uploadFolder, setUploadFolder] = useState("");
  const [uploadTags, setUploadTags] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadQueue, setUploadQueue] = useState<QueuedFile[]>([]);
  const [isFolderUpload, setIsFolderUpload] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ name: string; folder: string; done: boolean; error: boolean }[]>([]);

  useEffect(() => { loadFiles(); }, [workspace?.id]);

  useEffect(() => {
    if (showUploadDialog && selectedFolder && selectedFolder !== "__none__" && !isFolderUpload) {
      setUploadFolder(selectedFolder);
    }
  }, [showUploadDialog]);

  async function loadFiles() {
    if (!workspace?.id) return;
    try {
      setLoading(true);
      const { data, error } = await supabaseServiceRole
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
    if (!workspace?.id) return;
    const filesToUpload: QueuedFile[] = uploadQueue.length > 0
      ? uploadQueue
      : uploadFile
        ? [{ file: uploadFile, folderPath: uploadFolder.trim() }]
        : [];
    if (filesToUpload.length === 0) return;

    setUploading(true);
    const tags = uploadTags.split(",").map(t => t.trim()).filter(Boolean);

    if (filesToUpload.length === 1 && !isFolderUpload) {
      try {
        const { file: f, folderPath } = filesToUpload[0];
        const { url, storagePath } = await uploadToStorage(f, workspace.id);
        const { error: dbError } = await supabaseServiceRole.from("tech_datasheets").insert({
          workspace_id: workspace.id,
          name: uploadName || f.name,
          type: f.type || "application/octet-stream",
          size: f.size,
          url,
          storage_path: storagePath,
          category: uploadCategory,
          folder: folderPath,
          tags,
          description: uploadDescription,
          uploaded_by: workspace.id,
        });
        if (dbError) throw dbError;
      } catch (error) {
        console.error("Error uploading file:", error);
        alert("Failed to upload file. Please try again.");
        setUploading(false);
        return;
      }
    } else {
      const progress = filesToUpload.map(q => ({ name: q.file.name, folder: q.folderPath, done: false, error: false }));
      setUploadProgress([...progress]);

      for (let i = 0; i < filesToUpload.length; i++) {
        const { file: f, folderPath } = filesToUpload[i];
        try {
          const { url, storagePath } = await uploadToStorage(f, workspace.id);
          const { error: dbError } = await supabaseServiceRole.from("tech_datasheets").insert({
            workspace_id: workspace.id,
            name: f.name.replace(/\.[^/.]+$/, ""),
            type: f.type || "application/octet-stream",
            size: f.size,
            url,
            storage_path: storagePath,
            category: uploadCategory,
            // folder uploads use their own paths; regular multi-select uses uploadFolder
            folder: isFolderUpload ? folderPath : uploadFolder.trim(),
            tags,
            description: uploadDescription,
            uploaded_by: workspace.id,
          });
          if (dbError) throw dbError;
          progress[i] = { ...progress[i], done: true };
        } catch {
          progress[i] = { ...progress[i], error: true };
        }
        setUploadProgress([...progress]);
      }
    }

    setShowUploadDialog(false);
    setUploadName(""); setUploadCategory("other"); setUploadFolder("");
    setUploadTags(""); setUploadDescription(""); setUploadFile(null);
    setUploadQueue([]); setUploadProgress([]); setIsFolderUpload(false);
    setUploading(false);
    await loadFiles();
  }

  async function handleDelete(file: DataSheetFile) {
    if (!confirm(`Delete "${file.name}"?`)) return;
    try {
      if (file.storage_path && !file.storage_path.startsWith("http")) {
        await supabaseServiceRole.storage.from(STORAGE_BUCKET).remove([file.storage_path]);
      }
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
    if (!name) return;
    const fullPath = newFolderParent ? `${newFolderParent}/${name}` : name;
    if (folders.includes(fullPath)) return;
    setFolders(prev => [...prev, fullPath].sort());
    setNewFolderName("");
    setShowNewFolderDialog(false);
    if (newFolderParent) setExpandedFolders(prev => new Set([...prev, newFolderParent]));
    setSelectedFolder(fullPath);
  }

  async function handleDeleteFolder(folder: string) {
    const affected = folders.filter(f => f === folder || f.startsWith(folder + "/"));
    if (!confirm(`Delete "${folder}" and all subfolders? Files inside will move to "No Folder".`)) return;
    await Promise.all(affected.map(f =>
      supabaseServiceRole.from("tech_datasheets")
        .update({ folder: "" })
        .eq("workspace_id", workspace!.id)
        .eq("folder", f)
    ));
    if (selectedFolder && (selectedFolder === folder || selectedFolder.startsWith(folder + "/")))
      setSelectedFolder(null);
    await loadFiles();
  }

  async function handleRenameFolder(oldPath: string) {
    const newName = renameValue.trim();
    if (!newName) { setRenamingFolder(null); return; }
    const parent = oldPath.includes("/") ? oldPath.substring(0, oldPath.lastIndexOf("/")) : "";
    const newPath = parent ? `${parent}/${newName}` : newName;
    if (newPath === oldPath) { setRenamingFolder(null); return; }
    // Rename this folder and all children
    const affected = folders.filter(f => f === oldPath || f.startsWith(oldPath + "/"));
    await Promise.all(affected.map(f => {
      const updatedPath = newPath + f.slice(oldPath.length);
      return supabaseServiceRole.from("tech_datasheets")
        .update({ folder: updatedPath })
        .eq("workspace_id", workspace!.id)
        .eq("folder", f);
    }));
    if (selectedFolder && (selectedFolder === oldPath || selectedFolder.startsWith(oldPath + "/"))) {
      setSelectedFolder(newPath + selectedFolder.slice(oldPath.length));
    }
    setRenamingFolder(null);
    setRenameValue("");
    await loadFiles();
  }

  function toggleSelect(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === filteredFiles.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredFiles.map(f => f.id)));
    }
  }

  async function handleBulkMove(targetFolder: string) {
    const ids = Array.from(selectedIds);
    await Promise.all(ids.map(id =>
      supabaseServiceRole.from("tech_datasheets").update({ folder: targetFolder }).eq("id", id)
    ));
    setSelectedIds(new Set());
    setShowBulkMoveDialog(false);
    await loadFiles();
  }

  async function handleBulkDelete() {
    const count = selectedIds.size;
    if (!confirm(`Delete ${count} file${count > 1 ? "s" : ""}? This cannot be undone.`)) return;
    const toDelete = files.filter(f => selectedIds.has(f.id));
    const storagePaths = toDelete.map(f => f.storage_path).filter(p => p && !p.startsWith("http"));
    if (storagePaths.length > 0) {
      await supabaseServiceRole.storage.from(STORAGE_BUCKET).remove(storagePaths);
    }
    await Promise.all(toDelete.map(f =>
      supabaseServiceRole.from("tech_datasheets").delete().eq("id", f.id)
    ));
    setSelectedIds(new Set());
    await loadFiles();
  }

  async function handleMoveFolder(sourcePath: string, destParent: string) {
    const folderName = sourcePath.split("/").pop()!;
    const newBase = destParent ? `${destParent}/${folderName}` : folderName;
    if (newBase === sourcePath) { setMovingFolder(null); return; }
    if (newBase.startsWith(sourcePath + "/")) { alert("Cannot move a folder into its own subfolder."); return; }

    const affected = folders.filter(f => f === sourcePath || f.startsWith(sourcePath + "/"));
    await Promise.all(affected.map(f => {
      const newPath = newBase + f.slice(sourcePath.length);
      return supabaseServiceRole.from("tech_datasheets")
        .update({ folder: newPath })
        .eq("workspace_id", workspace!.id)
        .eq("folder", f);
    }));
    if (selectedFolder && (selectedFolder === sourcePath || selectedFolder.startsWith(sourcePath + "/"))) {
      setSelectedFolder(newBase + selectedFolder.slice(sourcePath.length));
    }
    setMovingFolder(null);
    await loadFiles();
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const base = selectedFolder && selectedFolder !== "__none__" ? selectedFolder : "";
    const items = Array.from(e.dataTransfer.items);

    if (items.length > 0 && items[0].webkitGetAsEntry) {
      const queued = await collectFromDataTransferItems(items, base);
      if (queued.length === 0) return;
      const hasSubFolders = queued.some(q => q.folderPath !== base);
      if (queued.length === 1 && !hasSubFolders) {
        setUploadFile(queued[0].file);
        setUploadName(queued[0].file.name.replace(/\.[^/.]+$/, ""));
        setUploadQueue([]);
        setIsFolderUpload(false);
      } else {
        setUploadQueue(queued);
        setUploadFile(null);
        setUploadName("");
        setIsFolderUpload(hasSubFolders);
      }
      setShowUploadDialog(true);
      return;
    }

    // Fallback for browsers without FileSystem API
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length === 0) return;
    if (dropped.length === 1) {
      setUploadFile(dropped[0]);
      setUploadName(dropped[0].name.replace(/\.[^/.]+$/, ""));
      setUploadQueue([]);
      setIsFolderUpload(false);
    } else {
      setUploadQueue(dropped.map(f => ({ file: f, folderPath: base })));
      setUploadFile(null);
      setUploadName("");
      setIsFolderUpload(false);
    }
    setShowUploadDialog(true);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files || []);
    if (selected.length === 0) return;
    const base = selectedFolder && selectedFolder !== "__none__" ? selectedFolder : "";
    if (selected.length === 1) {
      setUploadFile(selected[0]);
      setUploadName(selected[0].name.replace(/\.[^/.]+$/, ""));
      setUploadQueue([]);
      setIsFolderUpload(false);
    } else {
      setUploadQueue(selected.map(f => ({ file: f, folderPath: base })));
      setUploadFile(null);
      setUploadName("");
      setIsFolderUpload(false);
    }
    setShowUploadDialog(true);
    e.target.value = "";
  }

  function handleFolderSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files || []);
    if (selected.length === 0) return;
    const base = selectedFolder && selectedFolder !== "__none__" ? selectedFolder : "";

    const queued: QueuedFile[] = selected.map(f => {
      // webkitRelativePath: "RootFolderName/sub/file.pdf" — skip root name, keep sub-path
      const parts = (f.webkitRelativePath || f.name).split("/");
      const dirParts = parts.slice(1, -1); // drop root folder name + filename
      const folderPath = [base, ...dirParts].filter(Boolean).join("/");
      return { file: f, folderPath };
    });

    setUploadQueue(queued);
    setUploadFile(null);
    setUploadName("");
    setIsFolderUpload(true);
    setShowUploadDialog(true);
    e.target.value = "";
  }

  function getFileIcon(type: string, size: "sm" | "lg" = "lg") {
    const cls = size === "lg" ? "h-8 w-8" : "h-4 w-4";
    if (type.startsWith("image/")) return <Image className={`${cls} text-green-500`} />;
    if (type === "application/pdf") return <FileText className={`${cls} text-red-500`} />;
    if (type.includes("spreadsheet") || type.includes("excel") || type === "text/csv")
      return <FileSpreadsheet className={`${cls} text-emerald-600`} />;
    if (type.includes("zip") || type.includes("rar") || type.includes("7z") || type.includes("tar") || type.includes("gz"))
      return <FileArchive className={`${cls} text-orange-400`} />;
    if (type.includes("word") || type.includes("document"))
      return <FileText className={`${cls} text-blue-500`} />;
    return <File className={`${cls} text-slate-400`} />;
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
  const folderTree = buildFolderTree(folders);

  function FolderTreeItem({ node, depth = 0 }: { node: FolderNode; depth?: number }) {
    const isExpanded = expandedFolders.has(node.path);
    const isSelected = selectedFolder === node.path;
    const hasChildren = node.children.length > 0;
    const count = files.filter(f => f.folder === node.path || f.folder.startsWith(node.path + "/")).length;
    const directCount = files.filter(f => f.folder === node.path).length;
    const isRenaming = renamingFolder === node.path;

    return (
      <div>
        <div className={`group relative flex items-center gap-1 px-2 py-1 rounded-md text-sm transition-colors cursor-pointer ${isSelected ? "bg-primary/15 text-primary font-medium" : "hover:bg-muted text-foreground"}`}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
        >
          {/* Expand/collapse toggle */}
          <span className="shrink-0 w-4 flex items-center justify-center"
            onClick={e => { e.stopPropagation(); setExpandedFolders(prev => { const n = new Set(prev); n.has(node.path) ? n.delete(node.path) : n.add(node.path); return n; }); }}
          >
            {hasChildren
              ? isExpanded
                ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
                : <ChevronRight className="h-3 w-3 text-muted-foreground" />
              : null}
          </span>

          {isRenaming ? (
            <div className="flex items-center gap-1 flex-1">
              <Input className="h-5 text-xs py-0 px-1" value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleRenameFolder(node.path); if (e.key === "Escape") setRenamingFolder(null); }}
                autoFocus onClick={e => e.stopPropagation()}
              />
              <button onClick={e => { e.stopPropagation(); handleRenameFolder(node.path); }}>
                <Check className="h-3 w-3 text-primary" />
              </button>
            </div>
          ) : (
            <>
              <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" onClick={() => setSelectedFolder(node.path)} />
              <span className="truncate flex-1 text-left text-xs" onClick={() => setSelectedFolder(node.path)}>{node.name}</span>
              <span className="text-xs text-muted-foreground shrink-0" onClick={() => setSelectedFolder(node.path)}>{count}</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <span className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-muted-foreground/20 shrink-0" onClick={e => e.stopPropagation()}>
                    <MoreVertical className="h-3 w-3" />
                  </span>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="right" align="start">
                  <DropdownMenuItem onClick={e => { e.stopPropagation(); setNewFolderParent(node.path); setNewFolderName(""); setShowNewFolderDialog(true); }}>
                    <FolderPlus className="h-3.5 w-3.5 mr-2" /> New Subfolder
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={e => { e.stopPropagation(); setMovingFolder(node.path); }}>
                    <MoveRight className="h-3.5 w-3.5 mr-2" /> Move Into…
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={e => { e.stopPropagation(); setRenamingFolder(node.path); setRenameValue(node.name); }}>
                    <Pencil className="h-3.5 w-3.5 mr-2" /> Rename
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive" onClick={e => { e.stopPropagation(); handleDeleteFolder(node.path); }}>
                    <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>

        {hasChildren && isExpanded && (
          <div>
            {node.children.map(child => <FolderTreeItem key={child.path} node={child} depth={depth + 1} />)}
          </div>
        )}
      </div>
    );
  }

  // Summary for folder uploads
  const folderUploadSummary = (() => {
    if (!isFolderUpload || uploadQueue.length === 0) return null;
    const folderSet = new Set(uploadQueue.map(q => q.folderPath).filter(Boolean));
    return { fileCount: uploadQueue.length, folderCount: folderSet.size };
  })();

  return (
    <div className="flex h-full bg-background overflow-hidden">
      {/* ── Left folder panel ─────────────────────────────── */}
      <div className="w-52 shrink-0 border-r bg-muted/30 flex flex-col overflow-hidden">
        <div className="p-3 border-b flex items-center justify-between">
          <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Folders</span>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { setNewFolderParent(""); setNewFolderName(""); setShowNewFolderDialog(true); }} title="New root folder">
            <FolderPlus className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          <button
            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors ${selectedFolder === null ? "bg-primary/15 text-primary font-medium" : "hover:bg-muted text-foreground"}`}
            onClick={() => setSelectedFolder(null)}
          >
            <FolderOpen className="h-4 w-4 shrink-0" />
            <span className="truncate">All Files</span>
            <span className="ml-auto text-xs text-muted-foreground">{files.length}</span>
          </button>

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

          {folderTree.map(node => <FolderTreeItem key={node.path} node={node} />)}
        </div>

        <div className="p-2 border-t">
          <Button variant="outline" size="sm" className="w-full" onClick={() => { setNewFolderParent(selectedFolder && selectedFolder !== "__none__" ? selectedFolder : ""); setNewFolderName(""); setShowNewFolderDialog(true); }}>
            <FolderPlus className="h-3.5 w-3.5 mr-1.5" />
            {selectedFolder && selectedFolder !== "__none__" ? "New Subfolder" : "New Folder"}
          </Button>
        </div>
      </div>

      {/* ── Main area ──────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 border-b bg-card px-4 py-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground hover:text-foreground cursor-pointer" onClick={() => setSelectedFolder(null)}>
                Tech Data Sheets
              </span>
              {selectedFolder && selectedFolder !== "__none__" && (
                <><ChevronRight className="h-4 w-4 text-muted-foreground" /><span className="font-semibold">{selectedFolder}</span></>
              )}
              {selectedFolder === "__none__" && (
                <><ChevronRight className="h-4 w-4 text-muted-foreground" /><span className="font-semibold italic text-muted-foreground">Unfiled</span></>
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
              <Button variant="outline" onClick={() => folderInputRef.current?.click()} title="Upload entire folder (preserves subfolder structure)">
                <FolderInput className="h-4 w-4 mr-1" /> Upload Folder
              </Button>
              <Button onClick={() => {
                setUploadFolder(selectedFolder && selectedFolder !== "__none__" ? selectedFolder : "");
                setIsFolderUpload(false);
                setShowUploadDialog(true);
              }}>
                <Plus className="h-4 w-4 mr-1" /> Upload Files
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-3 mt-3 flex-wrap">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search files..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-9" />
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              <Button variant={selectedCategory === null ? "secondary" : "outline"} size="sm" onClick={() => setSelectedCategory(null)}>All</Button>
              {FILE_CATEGORIES.map(cat => (
                <Button key={cat.id} variant={selectedCategory === cat.id ? "secondary" : "outline"} size="sm" onClick={() => setSelectedCategory(cat.id)}>
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
              <p className="text-muted-foreground mb-2">Drag and drop files or folders here</p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-2" /> Upload Files
                </Button>
                <Button variant="outline" onClick={() => folderInputRef.current?.click()}>
                  <FolderInput className="h-4 w-4 mr-2" /> Upload Folder
                </Button>
              </div>
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {filteredFiles.map(file => {
                const isSelected = selectedIds.has(file.id);
                return (
                  <div
                    key={file.id}
                    className={`group relative bg-card border rounded-lg p-3 hover:shadow-md transition-shadow cursor-pointer ${isSelected ? "ring-2 ring-primary border-primary" : ""}`}
                    onClick={() => selectedIds.size > 0 ? setSelectedIds(prev => { const n = new Set(prev); n.has(file.id) ? n.delete(file.id) : n.add(file.id); return n; }) : setPreviewFile(file)}
                  >
                    {/* Checkbox */}
                    <div
                      className={`absolute top-2 left-2 transition-opacity ${isSelected || selectedIds.size > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                      onClick={e => toggleSelect(file.id, e)}
                    >
                      {isSelected
                        ? <CheckSquare className="h-4 w-4 text-primary" />
                        : <Square className="h-4 w-4 text-muted-foreground" />}
                    </div>
                    <div className="flex flex-col items-center text-center">
                      {getFileIcon(file.type)}
                      <p className="mt-2 text-sm font-medium truncate w-full" title={file.name}>{file.name}</p>
                      <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                      {file.folder && (
                        <p className="text-xs text-amber-600 truncate w-full mt-0.5">
                          <Folder className="inline h-3 w-3 mr-0.5" />{file.folder}
                        </p>
                      )}
                      <Badge variant="outline" className="mt-1 text-xs">{getCategoryIcon(file.category)} {getCategoryLabel(file.category)}</Badge>
                    </div>
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={e => e.stopPropagation()}>
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={e => { e.stopPropagation(); window.open(getFileDownloadUrl(file.url, file.name), "_blank"); }}>
                            <Download className="h-3.5 w-3.5 mr-2" /> Download
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={e => { e.stopPropagation(); setMovingFile(file); }}>
                            <MoveRight className="h-3.5 w-3.5 mr-2" /> Move to Folder
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onClick={e => { e.stopPropagation(); handleDelete(file); }}>
                            <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredFiles.map(file => {
                const isSelected = selectedIds.has(file.id);
                return (
                  <div
                    key={file.id}
                    className={`group flex items-center gap-3 bg-card border rounded-lg px-3 py-2 hover:shadow-sm transition-shadow cursor-pointer ${isSelected ? "ring-2 ring-primary border-primary" : ""}`}
                    onClick={() => selectedIds.size > 0 ? setSelectedIds(prev => { const n = new Set(prev); n.has(file.id) ? n.delete(file.id) : n.add(file.id); return n; }) : setPreviewFile(file)}
                  >
                    {/* Checkbox */}
                    <div
                      className={`shrink-0 transition-opacity ${isSelected || selectedIds.size > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                      onClick={e => toggleSelect(file.id, e)}
                    >
                      {isSelected
                        ? <CheckSquare className="h-4 w-4 text-primary" />
                        : <Square className="h-4 w-4 text-muted-foreground" />}
                    </div>
                    {getFileIcon(file.type)}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{file.name}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                        <span>{formatFileSize(file.size)}</span>
                        <span>•</span>
                        <span>{getCategoryIcon(file.category)} {getCategoryLabel(file.category)}</span>
                        {file.folder && (
                          <><span>•</span><span className="text-amber-600"><Folder className="inline h-3 w-3 mr-0.5" />{file.folder}</span></>
                        )}
                        {file.tags?.length > 0 && (
                          <><span>•</span><span>{file.tags.join(", ")}</span></>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={e => { e.stopPropagation(); setPreviewFile(file); }}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={e => { e.stopPropagation(); window.open(getFileDownloadUrl(file.url, file.name), "_blank"); }}>
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-indigo-500" onClick={e => { e.stopPropagation(); setMovingFile(file); }} title="Move to folder">
                        <MoveRight className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={e => { e.stopPropagation(); handleDelete(file); }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Bulk action bar — floats at bottom when files are selected */}
          {selectedIds.size > 0 && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-card border shadow-xl rounded-full px-5 py-3">
              <button className="text-sm text-muted-foreground hover:text-foreground" onClick={() => setSelectedIds(new Set())}>
                <X className="h-4 w-4" />
              </button>
              <span className="text-sm font-medium">{selectedIds.size} selected</span>
              <div className="w-px h-5 bg-border" />
              <Button size="sm" variant="ghost" onClick={toggleSelectAll}>
                {selectedIds.size === filteredFiles.length ? "Deselect all" : "Select all"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowBulkMoveDialog(true)}>
                <MoveRight className="h-4 w-4 mr-1" /> Move
              </Button>
              <Button size="sm" variant="destructive" onClick={handleBulkDelete}>
                <Trash2 className="h-4 w-4 mr-1" /> Delete
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Hidden file inputs — no accept filter, all types allowed */}
      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
      {/* webkitdirectory allows selecting a whole folder including subfolders */}
      <input ref={folderInputRef} type="file" multiple className="hidden" onChange={handleFolderSelect}
        {...({ webkitdirectory: "", directory: "" } as any)} />

      {/* Move Folder Dialog */}
      <Dialog open={!!movingFolder} onOpenChange={open => { if (!open) setMovingFolder(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MoveRight className="h-5 w-5" /> Move "{movingFolder?.split("/").pop()}" into…
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1 max-h-80 overflow-y-auto">
            <p className="text-xs text-muted-foreground pb-1">Choose a destination (or move to root):</p>
            <button
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-muted transition-colors"
              onClick={() => movingFolder && handleMoveFolder(movingFolder, "")}
            >
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
              <span className="italic text-muted-foreground">Root (no parent)</span>
            </button>
            {folders
              .filter(f => f !== movingFolder && !f.startsWith((movingFolder ?? "") + "/"))
              .map(f => {
                const depth = f.split("/").length - 1;
                return (
                  <button key={f}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-muted transition-colors"
                    style={{ paddingLeft: `${12 + depth * 14}px` }}
                    onClick={() => movingFolder && handleMoveFolder(movingFolder, f)}
                  >
                    <Folder className="h-4 w-4 text-amber-500 shrink-0" />
                    <span className="truncate">{f.split("/").pop()}</span>
                  </button>
                );
              })}
          </div>
        </DialogContent>
      </Dialog>

      {/* New Folder Dialog */}
      <Dialog open={showNewFolderDialog} onOpenChange={setShowNewFolderDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderPlus className="h-5 w-5 text-amber-500" />
              {newFolderParent ? `New subfolder in "${newFolderParent}"` : "New Folder"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {newFolderParent && (
              <p className="text-xs text-muted-foreground">Will be created at: <span className="font-mono text-foreground">{newFolderParent}/…</span></p>
            )}
            <Input
              placeholder="Folder name"
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleCreateFolder()}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setShowNewFolderDialog(false); setNewFolderName(""); }}>Cancel</Button>
              <Button onClick={handleCreateFolder} disabled={!newFolderName.trim()}>Create</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Move Dialog */}
      <Dialog open={showBulkMoveDialog} onOpenChange={setShowBulkMoveDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MoveRight className="h-5 w-5" /> Move {selectedIds.size} file{selectedIds.size > 1 ? "s" : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1 max-h-80 overflow-y-auto">
            <button className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-muted transition-colors"
              onClick={() => handleBulkMove("")}>
              <Folder className="h-4 w-4 text-muted-foreground" />
              <span className="italic text-muted-foreground">No Folder (Unfiled)</span>
            </button>
            {folders.map(folder => {
              const depth = folder.split("/").length - 1;
              return (
                <button key={folder}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-muted transition-colors"
                  style={{ paddingLeft: `${12 + depth * 14}px` }}
                  onClick={() => handleBulkMove(folder)}>
                  <Folder className="h-4 w-4 text-amber-500 shrink-0" />
                  <span className="truncate">{folder.split("/").pop()}</span>
                  {depth > 0 && <span className="text-xs text-muted-foreground truncate ml-1">({folder})</span>}
                </button>
              );
            })}
          </div>
          <div className="pt-2 border-t">
            <Button variant="outline" size="sm" className="w-full" onClick={() => { setShowBulkMoveDialog(false); setNewFolderParent(""); setShowNewFolderDialog(true); }}>
              <FolderPlus className="h-3.5 w-3.5 mr-1.5" /> Create New Folder
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Move to Folder Dialog */}
      <Dialog open={!!movingFile} onOpenChange={() => setMovingFile(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><MoveRight className="h-5 w-5" /> Move "{movingFile?.name}"</DialogTitle>
          </DialogHeader>
          <div className="space-y-1 max-h-80 overflow-y-auto">
            <button className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-muted transition-colors"
              onClick={() => movingFile && handleMoveFile(movingFile, "")}>
              <Folder className="h-4 w-4 text-muted-foreground" />
              <span className="italic text-muted-foreground">No Folder (Unfiled)</span>
            </button>
            {folders.map(folder => {
              const depth = folder.split("/").length - 1;
              const isCurrent = movingFile?.folder === folder;
              return (
                <button key={folder}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-muted transition-colors ${isCurrent ? "bg-primary/10 text-primary" : ""}`}
                  style={{ paddingLeft: `${12 + depth * 14}px` }}
                  onClick={() => movingFile && handleMoveFile(movingFile, folder)}>
                  <Folder className="h-4 w-4 text-amber-500 shrink-0" />
                  <span className="truncate">{folder.split("/").pop()}</span>
                  {isCurrent && <span className="ml-auto text-xs text-muted-foreground shrink-0">(current)</span>}
                </button>
              );
            })}
          </div>
          <div className="pt-2 border-t">
            <Button variant="outline" size="sm" className="w-full" onClick={() => { setMovingFile(null); setNewFolderParent(""); setShowNewFolderDialog(true); }}>
              <FolderPlus className="h-3.5 w-3.5 mr-1.5" /> Create New Folder
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Upload Dialog */}
      <Dialog open={showUploadDialog} onOpenChange={open => { if (!uploading) setShowUploadDialog(open); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{isFolderUpload ? "Upload Folder" : "Upload Files"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">

            {/* File / queue display */}
            {uploadQueue.length > 0 ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium">
                    {uploadQueue.length} file{uploadQueue.length > 1 ? "s" : ""}
                    {folderUploadSummary ? ` across ${folderUploadSummary.folderCount} folder${folderUploadSummary.folderCount > 1 ? "s" : ""}` : ""}
                  </p>
                  {!uploading && (
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setUploadQueue([]); setIsFolderUpload(false); }}>
                      Clear
                    </Button>
                  )}
                </div>
                <div className="max-h-48 overflow-y-auto space-y-1 border rounded-lg p-2 bg-muted/30">
                  {uploadQueue.map((q, i) => {
                    const prog = uploadProgress[i];
                    return (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        {getFileIcon(q.file.type, "sm")}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs truncate">{q.file.name}</p>
                          {q.folderPath && <p className="text-xs text-amber-600 truncate"><Folder className="inline h-2.5 w-2.5 mr-0.5" />{q.folderPath}</p>}
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(q.file.size)}</span>
                        {prog?.done && <span className="text-green-500 text-xs shrink-0">✓</span>}
                        {prog?.error && <span className="text-red-500 text-xs shrink-0">✗</span>}
                        {!prog && !uploading && (
                          <button onClick={() => setUploadQueue(prev => prev.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive shrink-0">
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                {isFolderUpload && (
                  <p className="text-xs text-muted-foreground">Subfolder structure will be preserved automatically.</p>
                )}
              </div>
            ) : uploadFile ? (
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
              <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-6 text-center space-y-3">
                <Upload className="h-10 w-10 mx-auto text-muted-foreground" />
                <div className="flex justify-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="h-4 w-4 mr-1" /> Select Files
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => folderInputRef.current?.click()}>
                    <FolderInput className="h-4 w-4 mr-1" /> Select Folder
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">PDF, Excel, Word, ZIP, images — all formats accepted</p>
              </div>
            )}

            {/* File name — only for single file */}
            {uploadQueue.length === 0 && uploadFile && (
              <div>
                <label className="text-sm font-medium">File Name</label>
                <Input value={uploadName} onChange={e => setUploadName(e.target.value)} placeholder="Enter file name" />
              </div>
            )}

            {/* Folder selector — hidden for folder uploads (paths are auto-set) */}
            {!isFolderUpload && (
              <div>
                <label className="text-sm font-medium">Folder</label>
                <div className="mt-1 space-y-1">
                  <select
                    className="w-full h-9 rounded-md border bg-background px-3 text-sm"
                    value={uploadFolder}
                    onChange={e => setUploadFolder(e.target.value)}
                  >
                    <option value="">— No Folder —</option>
                    {folders.map(f => {
                      const depth = f.split("/").length - 1;
                      return <option key={f} value={f}>{"    ".repeat(depth)}{f.split("/").pop()}</option>;
                    })}
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
            )}

            <div>
              <label className="text-sm font-medium">Category</label>
              <div className="flex flex-wrap gap-2 mt-1">
                {FILE_CATEGORIES.map(cat => (
                  <Button key={cat.id} variant={uploadCategory === cat.id ? "secondary" : "outline"} size="sm" onClick={() => setUploadCategory(cat.id)}>
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
              <Button variant="outline" onClick={() => setShowUploadDialog(false)} disabled={uploading}>Cancel</Button>
              <Button onClick={handleUpload} disabled={(!uploadFile && uploadQueue.length === 0) || uploading}>
                {uploading
                  ? `Uploading ${uploadProgress.filter(p => p.done).length}/${uploadProgress.length}…`
                  : `Upload${uploadQueue.length > 1 ? ` ${uploadQueue.length} files` : ""}`}
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
                <img
                  src={previewFile.url}
                  alt={previewFile.name}
                  className="max-w-full max-h-[60vh] object-contain rounded-lg"
                  onError={e => {
                    (e.target as HTMLImageElement).style.display = "none";
                    (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden");
                  }}
                />
                <div className="hidden flex-col items-center justify-center py-12 text-center">
                  <File className="h-16 w-16 text-muted-foreground mb-4" />
                  <p className="font-medium mb-1">Image could not be loaded</p>
                </div>
              </div>
            ) : (previewFile?.type === "application/pdf" || previewFile?.url?.toLowerCase().includes(".pdf")) ? (
              <div className="relative w-full h-[60vh]">
                <embed src={previewFile!.url} type="application/pdf" className="w-full h-full rounded-lg border" />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12">
                {getFileIcon(previewFile?.type || "")}
                <p className="text-muted-foreground mt-4 mb-4">Preview not available for this file type</p>
                <Button onClick={() => window.open(getFileDownloadUrl(previewFile?.url || "", previewFile?.name), "_blank")}>
                  <Download className="h-4 w-4 mr-2" /> Download to View
                </Button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{getCategoryIcon(previewFile?.category || "")} {getCategoryLabel(previewFile?.category || "")}</Badge>
              {previewFile?.folder && (
                <Badge variant="outline" className="text-amber-600 border-amber-300">
                  <Folder className="h-3 w-3 mr-1" />{previewFile.folder}
                </Badge>
              )}
              {previewFile?.tags?.map(tag => (
                <Badge key={tag} variant="secondary"><Tag className="h-3 w-3 mr-1" />{tag}</Badge>
              ))}
            </div>
            {previewFile?.description && <p className="text-sm text-muted-foreground">{previewFile.description}</p>}
            <div className="flex justify-between items-center text-sm text-muted-foreground">
              <span>Size: {formatFileSize(previewFile?.size || 0)}</span>
              <span>Uploaded: {previewFile?.uploaded_at ? new Date(previewFile.uploaded_at).toLocaleDateString() : "Unknown"}</span>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
