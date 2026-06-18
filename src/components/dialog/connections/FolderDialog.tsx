import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Group, GroupSyncType } from "@/types/global";

interface FolderDialogProps {
  open: boolean;
  isEditing: boolean;
  name: string;
  editingGroup: Group | null;
  onNameChange: (name: string) => void;
  onSubmit: (options: { syncType: GroupSyncType; allowUpload: boolean }) => void;
  onCancel: () => void;
}

export default function FolderDialog({
  open,
  isEditing,
  name,
  editingGroup,
  onNameChange,
  onSubmit,
  onCancel,
}: FolderDialogProps) {
  const { t } = useTranslation();
  const [syncType, setSyncType] = React.useState<GroupSyncType>("private");
  const [allowUpload, setAllowUpload] = React.useState(false);

  // Initialize state when editing
  React.useEffect(() => {
    if (isEditing && editingGroup) {
      setSyncType(editingGroup.sync_type || "private");
      setAllowUpload(editingGroup.allow_upload || false);
    } else {
      setSyncType("private");
      setAllowUpload(false);
    }
  }, [isEditing, editingGroup, open]);

  const handleSubmit = useCallback(() => {
    if (!name.trim()) return;
    onSubmit({ syncType, allowUpload });
  }, [name, syncType, allowUpload, onSubmit]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent showCloseButton={false} className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {isEditing ? t("savedConnections.renameFolder") : t("savedConnections.newFolder")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {isEditing ? t("savedConnections.renameFolder") : t("savedConnections.newFolder")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="folder-name">文件夹名称</Label>
            <Input
              id="folder-name"
              className="text-sm"
              placeholder={t("savedConnections.folderNamePlaceholder")}
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label>同步类型</Label>
            <Tabs
              value={syncType}
              onValueChange={(v) => setSyncType(v as GroupSyncType)}
              className="w-full"
            >
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="private" className="text-xs">
                  私有配置
                </TabsTrigger>
                <TabsTrigger value="shared" className="text-xs">
                  公用配置
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {syncType === "shared" && (
            <div className="flex items-center justify-between space-x-2">
              <div className="space-y-0.5">
                <Label htmlFor="allow-upload">允许上传到云端</Label>
                <p className="text-xs text-muted-foreground">启用后此文件夹内容将可上传到云端</p>
              </div>
              <Switch id="allow-upload" checked={allowUpload} onCheckedChange={setAllowUpload} />
            </div>
          )}

          {syncType === "private" && (
            <p className="text-xs text-muted-foreground">私有配置仅保存在本地，不会同步到云端</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancel}>
            {t("dialog.cancel")}
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={!name.trim()}>
            {t("dialog.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
