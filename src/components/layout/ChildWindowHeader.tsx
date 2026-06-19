import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { MdClose } from "react-icons/md";
import { isMacOS } from "@/lib/platform";

interface ChildWindowHeaderProps {
  title: string;
  onClose: () => void;
  icon?: ReactNode;
}

export default function ChildWindowHeader({ title, onClose, icon }: ChildWindowHeaderProps) {
  const { t } = useTranslation();

  return (
    <header
      className="border-b flex items-center gap-2 px-2 shrink-0 select-none"
      style={{ height: "30px", backgroundColor: "var(--df-bg-panel)", borderColor: "var(--df-border)" }}
    >
      <div
        className={`flex-1 min-w-0 h-full flex items-center gap-2 px-2${isMacOS ? " pl-[70px]" : ""}`}
        data-tauri-drag-region
      >
        {icon ? <span className="text-primary pointer-events-none shrink-0">{icon}</span> : null}
        <span className="text-sm font-medium truncate pointer-events-none">{title}</span>
      </div>

      {!isMacOS && (
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-md transition-colors text-[var(--df-text-muted)] hover:bg-red-500/90 hover:text-white shrink-0"
          aria-label={t("common.close")}
          title={t("common.close")}
          onClick={onClose}
        >
          <MdClose className="text-base" />
        </button>
      )}
    </header>
  );
}
