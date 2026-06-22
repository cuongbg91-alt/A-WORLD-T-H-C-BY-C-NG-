import { FileUp, Download, ScrollText, CheckSquare, ShieldCheck, Clipboard } from "lucide-react";
import React from "react";

interface ToolbarProps {
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDownload: () => void;
  onSetMode: (mode: string) => void;
  currentMode: string;
  onPasteClick: () => void;
}

export default function Toolbar({ onUpload, onDownload, onSetMode, currentMode, onPasteClick }: ToolbarProps) {
  const modes = [
    { id: "nd30-report", label: "Báo cáo NĐ 30", icon: <ScrollText className="w-4 h-4 mr-2" /> },
    { id: "nd30-decision", label: "Quyết định NĐ 30", icon: <CheckSquare className="w-4 h-4 mr-2" /> },
    { id: "hd05", label: "Văn bản đảng HD 05/2026", icon: <ShieldCheck className="w-4 h-4 mr-2" /> },
  ];

  return (
    <header className="h-16 bg-brand-sidebar border-b border-brand-border flex items-center justify-between px-6 z-10 shrink-0">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-brand-primary rounded-lg flex items-center justify-center text-white font-bold text-lg">
          V
        </div>
        <span className="font-bold text-lg text-brand-text tracking-tight uppercase">Văn Bản AI</span>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex bg-brand-bg p-1 rounded-lg border border-brand-border">
          {modes.map((mode) => (
            <button
              key={mode.id}
              onClick={() => onSetMode(mode.id)}
              className={`flex items-center px-4 py-1.5 text-[13px] font-medium rounded-md transition-all ${
                currentMode === mode.id
                  ? "bg-white text-brand-primary shadow-sm border border-brand-border"
                  : "text-brand-muted hover:text-brand-text"
              }`}
            >
              {mode.icon}
              {mode.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onPasteClick}
            className="flex items-center px-4 py-2 bg-white text-brand-text border border-brand-border rounded-md hover:bg-brand-bg cursor-pointer transition-all text-[13px] font-medium"
          >
            <Clipboard className="w-4 h-4 mr-2" />
            Dán văn bản
          </button>
          <label className="flex items-center px-4 py-2 bg-white text-brand-text border border-brand-border rounded-md hover:bg-brand-bg cursor-pointer transition-all text-[13px] font-medium">
            <FileUp className="w-4 h-4 mr-2" />
            Tải tệp lên
            <input type="file" className="hidden" accept=".docx,.doc" onChange={onUpload} />
          </label>
          <button
            onClick={onDownload}
            className="flex items-center px-4 py-2 bg-brand-primary text-white rounded-md hover:bg-blue-700 transition-all text-[13px] font-medium shadow-sm"
          >
            <Download className="w-4 h-4 mr-2" />
            Xuất kết quả
          </button>
        </div>
      </div>
    </header>
  );
}
