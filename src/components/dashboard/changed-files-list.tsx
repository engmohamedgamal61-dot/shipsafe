import type { ChangedFile } from "@/domain/types";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<ChangedFile["status"], string> = {
  added: "A",
  modified: "M",
  removed: "D",
  renamed: "R",
};

const STATUS_CLASSES: Record<ChangedFile["status"], string> = {
  added: "text-verdict-approve",
  modified: "text-severity-p2",
  removed: "text-severity-p0",
  renamed: "text-severity-nit",
};

export function ChangedFilesList({ files }: { files: ChangedFile[] }) {
  return (
    <ul className="flex flex-col divide-y divide-border font-mono text-sm">
      {files.map((file) => (
        <li key={file.path} className="flex items-center gap-3 py-2">
          <span className={cn("w-4 font-semibold", STATUS_CLASSES[file.status])}>
            {STATUS_LABEL[file.status]}
          </span>
          <span className="flex-1 truncate">{file.path}</span>
          <span className="text-verdict-approve">+{file.additions}</span>
          <span className="text-severity-p0">-{file.deletions}</span>
        </li>
      ))}
    </ul>
  );
}
