export interface FileEntry {
    name: string;
    is_dir: boolean;
    is_symlink: boolean;
    size: number;
    permissions: string;
}

export interface FileExplorerProps {
    activeSessionId: string | null;
}
