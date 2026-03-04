import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { MdRefresh } from "react-icons/md";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

export interface DeleteDialogData {
    sessionId: string;
    path: string;
    name: string;
}

interface DeleteDialogProps {
    data: DeleteDialogData;
    onClose: () => void;
    onSuccess: () => void;
}

export default function DeleteDialog({ data, onClose, onSuccess }: DeleteDialogProps) {
    const { t } = useTranslation();
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleDeleteSubmit = async () => {
        try {
            setIsSubmitting(true);
            await invoke("delete_remote_file", {
                sessionId: data.sessionId,
                path: data.path,
            });
            onSuccess();
            onClose();
        } catch (e) {
            toast.error(String(e));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open onOpenChange={(v) => !v && !isSubmitting && onClose()}>
            <DialogContent aria-describedby={undefined} className="w-80 sm:max-w-80">
                <DialogHeader>
                    <DialogTitle className="text-sm">
                        {t("fileExplorer.sureDelete", { name: data.name })}
                    </DialogTitle>
                </DialogHeader>
                <DialogFooter className="mt-4">
                    <Button variant="outline" size="sm" onClick={onClose} disabled={isSubmitting}>
                        {t("dialog.cancel")}
                    </Button>
                    <Button variant="destructive" size="sm" onClick={handleDeleteSubmit} disabled={isSubmitting}>
                        {isSubmitting && <MdRefresh className="text-[0.875rem] animate-spin mr-1" />}
                        {t("fileExplorer.cmDelete")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
