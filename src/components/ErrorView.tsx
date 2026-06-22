import React, { useState } from "react";
import { 
  Search, 
  Scissors, 
  CheckCheck, 
  Lightbulb, 
  Link as LinkIcon, 
  BookOpen, 
  Trash2, 
  Edit3, 
  Check, 
  X, 
  Plus,
  Compass,
  FileText
} from "lucide-react";

interface ErrorItem {
  id?: string;
  text: string;
  error: string;
  suggestion: string;
  type: string;
  timestamp?: number;
}

interface ErrorViewProps {
  errors: ErrorItem[];
  onProofread: () => void;
  onProofreadSelection: () => void;
  onFixAll: () => void;
  onFixItem: (item: ErrorItem) => void;
  onLinkToItem: (item: ErrorItem) => void;
  onLearn: (content: string) => void;
  isChecking: boolean;
  learnedRules: any[];
  onAddRule: (content: string, category: string, source: string) => void;
  onEditRule: (id: string, content: string, category: string, source: string) => void;
  onDeleteRule: (id: string) => void;
  onAnalyzeSource: (source: string) => void;
}

export default function ErrorView({ 
  errors, 
  onProofread, 
  onProofreadSelection,
  onFixAll, 
  onFixItem, 
  onLinkToItem, 
  onLearn,
  isChecking,
  learnedRules = [],
  onAddRule,
  onEditRule,
  onDeleteRule,
  onAnalyzeSource
}: ErrorViewProps) {
  const [activeTab, setActiveTab] = useState<"errors" | "learning">("errors");
  
  // States for manual rule creation
  const [manualContent, setManualContent] = useState("");
  const [manualCategory, setManualCategory] = useState("Định dạng");
  const [manualSource, setManualSource] = useState("Thủ công");

  // States for inline rule editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editCategory, setEditCategory] = useState("Định dạng");
  const [editSource, setEditSource] = useState("Thủ công");

  // Loading state for individual source training triggers
  const [trainingSource, setTrainingSource] = useState<string | null>(null);

  const predefinedSources = [
    { name: "Nghị định 150/2025/NĐ-CP", desc: "Quy chế mới về hồ sơ điện tử, kết nối chia sẻ dữ liệu số & định danh văn bản trực tuyến" },
    { name: "Nghị định 30/2020/NĐ-CP", desc: "Quy chuẩn văn bản hành chính nhà nước, font, lề dãn khoảng cách" },
    { name: "Hướng dẫn 05-HD/VPTW, ngày 27/5/2026", desc: "Quy thế trình bày văn bản Đảng cao cấp (thay thế HD 36-HD/VPTW mới nhất), tiêu đề và phông chữ" }
  ];

  const handleCreateRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualContent.trim()) return;
    onAddRule(manualContent.trim(), manualCategory, manualSource.trim() || "Thủ công");
    setManualContent("");
  };

  const handleStartEdit = (rule: any) => {
    setEditingId(rule.id);
    setEditContent(rule.content);
    setEditCategory(rule.category || "Định dạng");
    setEditSource(rule.source || "Thủ công");
  };

  const handleSaveEdit = (id: string) => {
    if (!editContent.trim()) return;
    onEditRule(id, editContent.trim(), editCategory, editSource.trim());
    setEditingId(null);
  };

  const runTriggerLearning = async (sourceName: string) => {
    setTrainingSource(sourceName);
    try {
      await onAnalyzeSource(sourceName);
    } finally {
      setTrainingSource(null);
    }
  };

  return (
    <div className="w-[450px] border-l border-brand-border bg-white flex flex-col h-full shrink-0 shadow-lg">
      
      {/* TABS HEADER NAVIGATION */}
      <div className="flex border-b border-brand-border bg-slate-50 select-none">
        <button
          onClick={() => setActiveTab("errors")}
          className={`flex-1 py-3 text-center text-xs font-bold transition-all border-b-2 flex items-center justify-center gap-1.5 ${
            activeTab === "errors" 
              ? "border-brand-primary text-brand-primary bg-white shadow-sm" 
              : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100/55"
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          RÀ SOÁT LỖI ({errors.length.toString().padStart(2, '0')})
        </button>
        <button
          onClick={() => setActiveTab("learning")}
          className={`flex-1 py-3 text-center text-xs font-bold transition-all border-b-2 flex items-center justify-center gap-1.5 ${
            activeTab === "learning" 
              ? "border-brand-primary text-brand-primary bg-white shadow-sm" 
              : "border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100/55"
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          TRUNG TÂM TỰ HỌC ({learnedRules.length})
        </button>
      </div>

      {activeTab === "errors" ? (
        // TAB 1: ERRORS LIST & STANDARD ACTIONS
        <div className="flex-1 flex flex-col min-h-0">
          <div className="p-4 border-b border-brand-border flex items-center justify-between bg-slate-50/50">
            <div className="font-semibold text-xs text-brand-text">
              Phát hiện {errors.length.toString().padStart(2, '0')} lỗi cần hiệu chỉnh
            </div>
            <button 
              onClick={onFixAll}
              disabled={errors.length === 0}
              className="px-3 py-1 bg-brand-primary text-white border border-brand-primary rounded-md hover:bg-blue-700 disabled:opacity-40 transition-all text-[11px] font-bold shadow-sm"
            >
              Sửa tất cả lỗi
            </button>
          </div>

          <div className="p-4 border-b border-brand-border grid grid-cols-2 gap-2 bg-brand-bg/30">
            <button 
              onClick={onProofread}
              disabled={isChecking}
              className="flex items-center justify-center px-3 py-2 bg-brand-primary text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-all text-xs font-bold shadow-sm"
            >
              {isChecking ? "Đang soát..." : <><Search className="w-3.5 h-3.5 mr-2" /> Soát toàn bộ</>}
            </button>
            <button 
              onClick={onProofreadSelection}
              disabled={isChecking}
              className="flex items-center justify-center px-3 py-2 bg-white text-slate-700 border border-brand-border rounded-md hover:bg-brand-bg transition-all text-xs font-bold"
            >
              <Scissors className="w-3.5 h-3.5 mr-2 text-slate-500" /> Vùng chọn
            </button>
          </div>

          <div className="flex-1 overflow-auto p-4 space-y-3 bg-slate-50/30">
            {errors.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-28 text-brand-muted text-center h-full">
                <Lightbulb className="w-12 h-12 mb-3 opacity-25 text-brand-primary" />
                <p className="text-[13px] px-8 leading-relaxed italic text-slate-500 select-none">
                  Chưa phát hiện lỗi. Nhấn "Soát toàn bộ" để bắt đầu rà soát tự động theo các tiêu chuẩn đã học.
                </p>
              </div>
            ) : (
              [...errors]
                .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
                .map((item) => (
                  <div key={item.id || `${item.text}-${item.error}`} className="bg-white border border-brand-border rounded-lg p-3.5 shadow-sm border-l-4 border-l-brand-accent hover:shadow-md transition-shadow relative group">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-brand-accent bg-orange-50 px-1.5 py-0.5 rounded border border-orange-100">
                        {item.type}
                      </span>
                      <button 
                        onClick={() => onLinkToItem(item)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-slate-400 hover:text-brand-primary"
                        title="Tìm vị trí lỗi"
                      >
                        <LinkIcon className="w-3 h-3" />
                      </button>
                    </div>
                    
                    <div className="mb-2.5">
                      <div className="text-[13px] font-bold text-slate-800 mb-1 leading-snug">{item.error}</div>
                      <div className="text-[12px] text-slate-400 line-through decoration-brand-accent/30">{item.text}</div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <div className="flex-1 text-[12px] bg-emerald-50/50 text-emerald-700 font-semibold p-2 rounded border border-emerald-100 italic">
                        Gợi ý: {item.suggestion}
                      </div>
                      <button 
                        onClick={() => onFixItem(item)}
                        className="p-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded transition-colors shadow-sm"
                        title="Áp dụng sửa lỗi"
                      >
                        <CheckCheck className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>
      ) : (
        // TAB 2: COGNITIVE SELF-LEARNING INTERFACE
        <div className="flex-1 flex flex-col min-h-0 bg-slate-50/40 overflow-y-auto">
          
          {/* SECTION A: CRAWL & LEARN AUTOMATICALLY */}
          <div className="p-4 bg-white border-b border-brand-border">
            <h4 className="text-[12px] font-bold text-slate-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Compass className="w-4 h-4 text-brand-primary" />
              Tự học từ Nguồn tài liệu số
            </h4>
            <p className="text-[11px] text-slate-500 mb-3 leading-relaxed">
              Các nguồn tài liệu tiêu chuẩn chính quy đã được nạp sẵn. Nhấn Phân tích học tập để AI nạp quy chuẩn ngữ pháp, khoảng cách, font chữ mới nhất:
            </p>
            <div className="grid grid-cols-1 gap-2">
              {predefinedSources.map((source, index) => (
                <div key={index} className="flex flex-col p-2.5 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-50 hover:border-brand-primary/30 transition-all">
                  <div className="flex justify-between items-start gap-2 mb-1">
                    <div>
                      <span className="text-xs font-bold text-slate-800">{source.name}</span>
                      <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">{source.desc}</p>
                    </div>
                    <button
                      onClick={() => runTriggerLearning(source.name)}
                      disabled={trainingSource !== null}
                      className="text-[10px] bg-brand-primary text-white hover:bg-blue-700 font-bold px-2 py-1 rounded transition-colors shrink-0 disabled:opacity-40"
                    >
                      {trainingSource === source.name ? "Đang học..." : "Học ngay"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* SECTION B: MANUAL RULE CREATION / supplement */}
          <div className="p-4 bg-white border-b border-brand-border">
            <h4 className="text-[12px] font-bold text-slate-800 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-emerald-600" />
              Nhập nội dung tự học thủ công
            </h4>
            
            <form onSubmit={handleCreateRule} className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Thể loại</label>
                  <select 
                    value={manualCategory}
                    onChange={(e) => setManualCategory(e.target.value)}
                    className="w-full text-xs p-1.5 border border-slate-200 rounded-md outline-none bg-slate-50/50 focus:border-brand-primary"
                  >
                    <option value="Định dạng">Định dạng (Font/Margin/Tab)</option>
                    <option value="Chính tả & Ngữ pháp">Chính tả & Ngữ pháp</option>
                    <option value="Văn phong">Văn phong hành chính</option>
                    <option value="Logic">Đơn vị / Cấp chính quyền</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Nguồn gốc</label>
                  <input
                    value={manualSource}
                    onChange={(e) => setManualSource(e.target.value)}
                    placeholder="Ví dụ: Thủ công"
                    className="w-full text-xs p-1.5 border border-slate-200 rounded-md outline-none bg-slate-50/50 focus:border-brand-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Nội dung quy tắc đúc kết</label>
                <textarea
                  value={manualContent}
                  onChange={(e) => setManualContent(e.target.value)}
                  placeholder="Ví dụ: Định dạng thụt lề chuẩn là 1cm đến 1.25cm, giãn dòng tối ưu 1.15. Phông chữ tuyệt đối là Times New Roman..."
                  className="w-full h-16 p-2 text-xs border border-slate-200 rounded-md outline-none focus:ring-1 focus:ring-brand-primary focus:border-brand-primary resize-none placeholder:text-slate-400 font-sans"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={!manualContent.trim()}
                  className="flex items-center gap-1 bg-brand-primary text-white hover:bg-blue-700 font-bold text-xs px-3.5 py-1.5 rounded-md transition-colors disabled:opacity-40"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Bổ sung ngay
                </button>
              </div>
            </form>
          </div>

          {/* SECTION C: RULES LIBRARY (WITH EDIT & DELETE) */}
          <div className="p-4 flex-1">
            <div className="flex justify-between items-center mb-2.5">
              <h4 className="text-[12px] font-bold text-slate-800 uppercase tracking-wider">
                Thư viện Kho chuẩn đã học ({learnedRules.length})
              </h4>
            </div>

            {learnedRules.length === 0 ? (
              <div className="border border-dashed border-slate-200 p-8 rounded-xl text-center bg-white">
                <p className="text-[11px] text-slate-400 italic">Hiện tại chưa có bộ quy tắc tự học nào được nạp. Hãy chọn một nguồn học chuẩn phía trên hoặc nhập thủ công.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {learnedRules.map((rule) => (
                  <div key={rule.id} className="p-3 bg-white border border-slate-200 rounded-lg shadow-sm">
                    {editingId === rule.id ? (
                      /* INLINE EDIT TEMPLATE */
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-1.5">
                          <div>
                            <span className="text-[9px] text-slate-400 font-bold block mb-0.5">Category</span>
                            <select
                              value={editCategory}
                              onChange={(e) => setEditCategory(e.target.value)}
                              className="text-[10px] w-full p-1 border border-slate-200 rounded outline-none"
                            >
                              <option value="Định dạng">Định dạng</option>
                              <option value="Chính tả & Ngữ pháp">Chính tả & Ngữ pháp</option>
                              <option value="Văn phong">Văn phong</option>
                              <option value="Logic">Logic</option>
                            </select>
                          </div>
                          <div>
                            <span className="text-[9px] text-slate-400 font-bold block mb-0.5">Nguồn</span>
                            <input
                              value={editSource}
                              onChange={(e) => setEditSource(e.target.value)}
                              className="text-[10px] w-full p-1 border border-slate-200 rounded outline-none"
                            />
                          </div>
                        </div>
                        <div>
                          <span className="text-[9px] text-slate-400 font-bold block mb-0.5">Nội dung</span>
                          <textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            className="text-[11px] w-full p-1.5 border border-slate-300 rounded focus:ring-1 focus:ring-brand-primary min-h-[50px] font-sans"
                          />
                        </div>
                        <div className="flex justify-end gap-1.5">
                          <button
                            onClick={() => setEditingId(null)}
                            className="flex items-center gap-0.5 border border-slate-200 text-slate-600 px-1.5 py-0.5 rounded text-[10px] hover:bg-slate-50"
                          >
                            <X className="w-3 h-3" /> Hủy
                          </button>
                          <button
                            onClick={() => handleSaveEdit(rule.id)}
                            className="flex items-center gap-0.5 bg-emerald-600 hover:bg-emerald-700 text-white px-1.5 py-0.5 rounded text-[10px] font-bold"
                          >
                            <Check className="w-3 h-3" /> Lưu
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* STATIC DISPLAY TEMPLATE */
                      <div>
                        <div className="flex justify-between items-start gap-2 mb-1.5 border-b border-dashed border-slate-100 pb-1.5">
                          <div className="flex items-center gap-1 w-full overflow-hidden shrinkwrap">
                            <span className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-100 px-1.5 py-0.2 rounded whitespace-nowrap">
                              {rule.category || "Chung"}
                            </span>
                            <span className="text-[10px] text-slate-500 font-bold max-w-[200px] truncate" title={rule.source}>
                              Nguồn: {rule.source}
                            </span>
                          </div>
                          <div className="flex gap-1.5 md:opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap shrink-0 md:-mt-0.5 md:group-hover:block" style={{ contentVisibility: "auto" } as any}>
                            <button
                              onClick={() => handleStartEdit(rule)}
                              className="text-slate-400 hover:text-blue-600 transition-colors p-0.5"
                              title="Hiệu chỉnh thủ công"
                            >
                              <Edit3 className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => onDeleteRule(rule.id)}
                              className="text-slate-400 hover:text-red-600 transition-colors p-0.5"
                              title="Loại bỏ quy chuẩn"
                            >
                              <Trash2 className="w-3" />
                            </button>
                          </div>
                        </div>
                        <p className="text-[11.5px] text-slate-700 leading-relaxed font-medium">
                          {rule.content}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      )}

      {/* FIXED FOOTER */}
      <div className="p-3 bg-white border-t border-brand-border flex items-center justify-between text-[10px] font-medium text-brand-muted px-4 shrink-0 select-none">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></div>
          Bản quyền tự học thông minh @Cường
        </div>
        <div className="uppercase tracking-tighter opacity-60">AI Cognitive Sandbox</div>
      </div>

    </div>
  );
}
