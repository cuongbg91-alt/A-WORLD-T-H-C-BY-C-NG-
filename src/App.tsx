import React, { useState, useEffect } from "react";
import Toolbar from "./components/Toolbar";
import TextView from "./components/TextView";
import ErrorView from "./components/ErrorView";
import { parseDocx, generateDocx } from "./lib/docx-utils";
import { runLocalProofreader } from "./lib/local-proofreader";

interface ErrorItem {
  id?: string;
  text: string;
  error: string;
  suggestion: string;
  type: string;
  timestamp?: number;
}



function replaceTextInHtml(html: string, searchText: string, replacementHtml: string): string {
  if (typeof window === "undefined" || !html || !searchText) return html;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
    const container = doc.body.firstChild as HTMLElement;
    if (!container) return html;

    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      textNodes.push(node as Text);
    }

    const escapedSearch = searchText.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&').replace(/\s+/g, '\\s+');
    const regex = new RegExp(escapedSearch, 'g');

    // Quét ngược lại để việc thay đổi cấu trúc không ảnh hưởng tới indices của các node phía trước
    for (let i = textNodes.length - 1; i >= 0; i--) {
      const node = textNodes[i];
      const text = node.textContent || "";
      if (regex.test(text)) {
        const parent = node.parentNode;
        if (!parent) continue;

        const fragment = document.createDocumentFragment();
        let lastIndex = 0;
        regex.lastIndex = 0;
        let match;
        while ((match = regex.exec(text)) !== null) {
          // Thêm phần chữ trước khớp
          const before = text.substring(lastIndex, match.index);
          if (before) {
            fragment.appendChild(document.createTextNode(before));
          }
          // Thêm phần thay thế cho đoạn chữ khớp
          const temp = document.createElement("div");
          temp.innerHTML = replacementHtml;
          while (temp.firstChild) {
            fragment.appendChild(temp.firstChild);
          }
          lastIndex = regex.lastIndex;
        }
        // Thêm phần chữ còn lại sau khớp cuối cùng
        const after = text.substring(lastIndex);
        if (after) {
          fragment.appendChild(document.createTextNode(after));
        }
        parent.replaceChild(fragment, node);
      }
    }

    return container.innerHTML;
  } catch (err) {
    console.error("Lỗi khi thay thế text trong HTML:", err);
    // Fallback bảo vệ bằng Regex an toàn không can thiệp bên trong thẻ HTML <>
    const escapedSearch = searchText.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(?![^<]*>)(${escapedSearch})`, 'g');
    return html.replace(regex, replacementHtml);
  }
}

export default function App() {
  const [originalText, setOriginalText] = useState("");
  const [htmlContent, setHtmlContent] = useState("");
  const [errors, setErrors] = useState<ErrorItem[]>([]);
  const [highlightedError, setHighlightedError] = useState<ErrorItem | null>(null);
  const [mode, setMode] = useState("nd30-report");
  const [isChecking, setIsChecking] = useState(false);
  const [fileName, setFileName] = useState("");
  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");

  // State hỗ trợ thông báo lỗi và thành công nâng cao
  const [toast, setToast] = useState<{ type: "success" | "warning" | "error" | "info"; message: string } | null>(null);
  const [learnedRules, setLearnedRules] = useState<any[]>([]);

  const fetchLearnedRules = async () => {
    try {
      const res = await fetch("/api/learned-rules");
      const data = await res.json();
      if (data.success) {
        setLearnedRules(data.learnedRules);
      }
    } catch (e) {
      console.error("Lỗi lấy danh sách tự học:", e);
    }
  };

  useEffect(() => {
    fetchLearnedRules();
  }, []);

  const handleAddRule = async (content: string, category: string, source: string) => {
    try {
      const res = await fetch("/api/learned-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, category, source }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("success", "Đã lưu quy định bổ sung thủ công thành công!");
        fetchLearnedRules();
      } else {
        showToast("error", data.error || "Không thể lưu quy định bổ sung.");
      }
    } catch (e) {
      console.error(e);
      showToast("error", "Lỗi kết nối máy chủ khi lưu quy định.");
    }
  };

  const handleEditRule = async (id: string, content: string, category: string, source: string) => {
    try {
      const res = await fetch(`/api/learned-rules/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, category, source }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("success", "Đã cập nhật quy định thành công!");
        fetchLearnedRules();
      } else {
        showToast("error", data.error || "Không thể cập nhật quy tắc.");
      }
    } catch (e) {
      console.error(e);
      showToast("error", "Lỗi kết nối máy chủ khi cập nhật.");
    }
  };

  const handleDeleteRule = async (id: string) => {
    try {
      const res = await fetch(`/api/learned-rules/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.success) {
        showToast("success", "Đã xóa quy định tự học!");
        fetchLearnedRules();
      } else {
        showToast("error", data.error || "Không thể xoá quy chuẩn.");
      }
    } catch (e) {
      console.error(e);
      showToast("error", "Lỗi kết nối máy chủ khi xoá.");
    }
  };

  const handleAnalyzeSource = async (source: string) => {
    try {
      showToast("info", `AI đang rà quét và phân tích học tập quy chuẩn từ ${source}...`);
      const res = await fetch("/api/analyze-and-learn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("success", `AI đã học thành công ${data.addedRules?.length || 0} quy tắc chất lượng từ ${source}!`);
        fetchLearnedRules();
      } else {
        showToast("error", data.error || "AI phân tích tự học gặp sự cố.");
      }
    } catch (e) {
      console.error(e);
      showToast("error", "Lỗi gửi kết nối yêu cầu AI tự học.");
    }
  };

  const showToast = (type: "success" | "warning" | "error" | "info", message: string) => {
    setToast({ type, message });
    // Tự động biến mất sau 6 giây
    const timer = setTimeout(() => {
      setToast(prev => prev && prev.message === message ? null : prev);
    }, 6000);
    return () => clearTimeout(timer);
  };

  const updateState = (nextText: string, nextHtml: string, nextErrors: ErrorItem[]) => {
    setOriginalText(nextText);
    setHtmlContent(nextHtml);
    setErrors(nextErrors);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    try {
      if (file.name.toLowerCase().endsWith(".doc")) {
        showToast("info", "Đang xử lý bóc tách định dạng Word 97 - 2003 (.doc)...");
        
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            const b64 = result.split(',')[1];
            resolve(b64);
          };
          reader.onerror = (err) => reject(err);
          reader.readAsDataURL(file);
        });

        const res = await fetch("/api/parse-doc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base64, filename: file.name }),
        });
        const data = await res.json();
        
        if (data.success) {
          setOriginalText(data.text);
          setHtmlContent(data.html);
          setOrientation(data.orientation || "portrait");
          setErrors([]);
          showToast("success", `Đã tải tệp lên thành công: ${file.name}`);
        } else {
          showToast("error", data.error || "Không thể nạp nội dung của file .doc này.");
        }
      } else {
        const { text, html, orientation: detectedOrientation } = await parseDocx(file);
        
        setOriginalText(text);
        setHtmlContent(html);
        setOrientation(detectedOrientation);
        setErrors([]);

        showToast("success", `Đã tải tệp lên thành công: ${file.name}`);
      }
    } catch (error) {
      console.error("Failed to parse file:", error);
      showToast("error", "Không thể bóc tách nội dung của tệp này. Vui lòng chắc chắn file không bị lỗi.");
    }
  };

  const handleDownload = async () => {
    if (!htmlContent) {
      showToast("warning", "Không có nội dung để xuất tệp tin.");
      return;
    }
    try {
      const htmlToSave = document.getElementById('word-content')?.innerHTML || htmlContent;
      let outputName = "van_ban_da_soat.docx";
      if (fileName) {
        if (fileName.endsWith('.docx')) {
          outputName = fileName.replace('.docx', '_da_soat.docx');
        } else if (fileName.endsWith('.doc')) {
          outputName = fileName.replace('.doc', '_da_soat.docx');
        } else {
          outputName = fileName + '_da_soat.docx';
        }
      }
      await generateDocx(htmlToSave, outputName, orientation);
      showToast("success", "Xuất file DOCX rà duyệt hoàn chỉnh thành công!");
    } catch (error) {
      console.error("Failed to download docx:", error);
      showToast("error", "Có lỗi xảy ra khi tạo dựng tệp Word đã sửa.");
    }
  };

  const handleOrientationChange = (nextOrientation: "portrait" | "landscape") => {
    setOrientation(nextOrientation);
  };

  const handlePasteConfirm = (text: string) => {
    if (!text.trim()) {
      showToast("warning", "Vui lòng dán hoặc soạn nội dung văn bản hành chính vào ô nhập liệu.");
      return;
    }
    
    // Tạo HTML content đơn giản từ text dán
    const html = text.split('\n').map(line => {
      const escaped = line
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `<p class="text-justify">${escaped}</p>`;
    }).join('\n');

    setOriginalText(text);
    setHtmlContent(html);
    const customName = `Văn bản dán (${new Date().toLocaleTimeString("vi-VN", { hour: '2-digit', minute: '2-digit' })})`;
    setFileName(customName);
    setErrors([]);
    setOrientation("portrait");
    setIsPasteModalOpen(false);
    setPastedText("");
    
    showToast("success", "Đã nạp văn bản tự soạn thảo từ clipboard.");
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setPastedText(text);
      showToast("success", "Đã dán nhanh văn bản từ bộ nhớ tạm thành công!");
    } catch (err) {
      console.warn("Không thể truy cập Clipboard:", err);
      showToast("info", "Bạn hãy sử dụng tổ hợp phím tắt Ctrl + V (hoặc Cmd + V) để dán trực tiếp vào khung soạn thảo.");
    }
  };

  const proofread = async (targetText?: string) => {
    const textToProcess = targetText || originalText;
    if (!textToProcess) {
      showToast("warning", "Vui lòng tải tệp docx lên hoặc dán nội dung văn bản rà soát.");
      return;
    }

    setIsChecking(true);
    
    // Khởi chạy rà soát quy tắc hành chính địa lý và lỗi định dạng tĩnh nhanh cục bộ
    const localErrors = runLocalProofreader(textToProcess, mode, learnedRules);
    setErrors(localErrors);

    try {
      const response = await fetch("/api/proofread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: textToProcess, mode }),
      });

      if (!response.ok) {
        let errorMessage = "Đã xảy ra lỗi khi yêu cầu rà soát văn bản.";
        try {
          const errData = await response.json();
          if (errData && errData.error) {
            errorMessage = errData.error;
          }
        } catch (_) {
          try {
            const errText = await response.clone().text();
            if (errText && errText.length < 200) {
              errorMessage = errText;
            }
          } catch (__) {}
        }
        throw new Error(errorMessage);
      }

      if (!response.body) {
        throw new Error("Trình duyệt không hỗ trợ đọc luồng dữ liệu.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        // Chuẩn hóa khoảng xuống dòng để thống nhất các nền tảng
        buffer = buffer.replace(/\r\n/g, "\n");
        
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const block = buffer.substring(0, boundary).trim();
          buffer = buffer.substring(boundary + 2);
          boundary = buffer.indexOf("\n\n");

          if (!block) continue;
          
          if (block.startsWith("data:")) {
            const jsonText = block.substring(5).trim();
            let parsedData: any = null;
            try {
              parsedData = JSON.parse(jsonText);
            } catch (jsonErr) {
              console.error("Lỗi phân tích cú pháp sự kiện luồng dữ liệu:", jsonErr, jsonText);
            }

            if (parsedData) {
              if (parsedData.type === "chunk_result") {
                if (parsedData.errors && parsedData.errors.length > 0) {
                  setErrors(prev => {
                    const existingKeys = new Set(prev.map(e => `${e.text}-${e.error}-${e.suggestion}`));
                    const uniqueNew = parsedData.errors.filter((e: any) => !existingKeys.has(`${e.text}-${e.error}-${e.suggestion}`));
                    const uniqueNewWithMeta = uniqueNew.map((e: any, index: number) => ({
                      ...e,
                      id: e.id || `${Math.random().toString(36).substring(2, 9)}-${Date.now()}-${index}`,
                      timestamp: e.timestamp || Date.now()
                    }));
                    return [...prev, ...uniqueNewWithMeta];
                  });
                }
              } else if (parsedData.type === "warning") {
                showToast("warning", parsedData.message);
                if (parsedData.message && (parsedData.message.includes("Limit") || parsedData.message.includes("limit") || parsedData.message.includes("quota") || parsedData.message.includes("Quota"))) {
                  throw new Error(parsedData.message);
                }
              } else if (parsedData.type === "error") {
                throw new Error(parsedData.error);
              }
            }
          }
        }
      }

      // Xử lý nốt dữ liệu sót trong buffer nếu có
      if (buffer.trim() && buffer.startsWith("data:")) {
        const jsonText = buffer.substring(5).trim();
        let parsedData: any = null;
        try {
          parsedData = JSON.parse(jsonText);
        } catch (_) {}

        if (parsedData) {
          if (parsedData.type === "chunk_result" && parsedData.errors && parsedData.errors.length > 0) {
            setErrors(prev => {
              const existingKeys = new Set(prev.map(e => `${e.text}-${e.error}-${e.suggestion}`));
              const uniqueNew = parsedData.errors.filter((e: any) => !existingKeys.has(`${e.text}-${e.error}-${e.suggestion}`));
              const uniqueNewWithMeta = uniqueNew.map((e: any, index: number) => ({
                ...e,
                id: e.id || `${Math.random().toString(36).substring(2, 9)}-${Date.now()}-${index}`,
                timestamp: e.timestamp || Date.now()
              }));
              return [...prev, ...uniqueNewWithMeta];
            });
          } else if (parsedData.type === "error") {
            throw new Error(parsedData.error);
          }
        }
      }

      showToast("success", "Đã hệ thống hóa và rà soát thành công văn bản hành chính!");
    } catch (error: any) {
      console.error("Error proofreading:", error);
      // Giữ kết quả rà soát nguyên bản cục bộ và thông báo mềm dẻo nếu máy chủ mất kết nối hoặc hết hạn mức API
      showToast("warning", `Hệ thống tự động kích hoạt bộ rà soát quy chuẩn hành chính ngoại tuyến (Local Proofreader) để bảo toàn công việc do giới hạn lưu lượng tài khoản thử nghiệm.`);
      if (localErrors.length > 0) {
        setErrors(localErrors);
      }
    } finally {
      setIsChecking(false);
    }
  };

  const proofreadSelection = () => {
    const selection = window.getSelection();
    if (selection && selection.toString().trim()) {
      showToast("info", "Đang rà soát cho phân đoạn bôi xanh chọn...");
      proofread(selection.toString());
    } else {
      showToast("warning", "Quý khách vui lòng bôi xanh vùng văn bản hành chính cụ thể cần quét rà soát.");
    }
  };

  const fixItem = (errorItem: ErrorItem) => {
    const index = errors.findIndex(e => e.id === errorItem.id || (e.text === errorItem.text && e.error === errorItem.error));
    if (index === -1) return;
    const error = errors[index];
    const escapedText = error.text.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(escapedText, 'g');
    
    const correctedHtml = `<span class="corrected-term bg-green-50 text-emerald-600 font-bold border-b border-solid border-emerald-600" title="Đã sửa từ lỗi '${error.text}': ${error.error}">${error.suggestion}</span>`;
    
    const nextHtml = replaceTextInHtml(htmlContent, error.text, correctedHtml);
    const nextText = originalText.replace(regex, error.suggestion);
    const nextErrors = errors.filter((_, i) => i !== index);

    updateState(nextText, nextHtml, nextErrors);
  };

  const fixAll = () => {
    let newHtml = htmlContent;
    let newText = originalText;
    
    const sortedErrors = [...errors].sort((a, b) => b.text.length - a.text.length);

    sortedErrors.forEach(error => {
      const escapedText = error.text.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(escapedText, 'g');
      const correctedHtml = `<span class="corrected-term bg-green-50 text-emerald-600 font-bold border-b border-solid border-emerald-600" title="Đã sửa từ lỗi '${error.text}': ${error.error}">${error.suggestion}</span>`;
      
      newHtml = replaceTextInHtml(newHtml, error.text, correctedHtml);
      newText = newText.replace(regex, error.suggestion);
    });

    updateState(newText, newHtml, []);
    showToast("success", "Đã sửa đổi áp dụng tự động toàn bộ lỗi được đề xuất!");
  };

  const handleLearn = async (content: string) => {
    try {
      await fetch("/api/learn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      showToast("success", "Đã cập nhật quy định tự học lên hệ thống AI!");
    } catch (error) {
      console.error("Learning failed:", error);
      showToast("error", "Lỗi gửi quy chuẩn học tập.");
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-900 font-sans relative overflow-hidden">
      <Toolbar 
        onUpload={handleUpload} 
        onDownload={handleDownload} 
        onSetMode={setMode} 
        currentMode={mode} 
        onPasteClick={() => setIsPasteModalOpen(true)}
      />
      <div className="flex flex-1 overflow-hidden">
        <TextView 
          htmlContent={htmlContent} 
          errors={errors} 
          highlightedError={highlightedError}
          orientation={orientation}
          onOrientationChange={handleOrientationChange}
          mode={mode}
        />
        <ErrorView 
          errors={errors} 
          onProofread={() => proofread()} 
          onProofreadSelection={proofreadSelection}
          onFixAll={fixAll} 
          onFixItem={fixItem}
          onLinkToItem={(item) => setHighlightedError({ ...item, id: Math.random() })}
          onLearn={handleLearn}
          isChecking={isChecking}
          learnedRules={learnedRules}
          onAddRule={handleAddRule}
          onEditRule={handleEditRule}
          onDeleteRule={handleDeleteRule}
          onAnalyzeSource={handleAnalyzeSource}
        />
      </div>

      {/* Thông báo dạng Toast tinh tế góc dưới cùng tay phải */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-slate-900 text-white px-4 py-3.5 rounded-xl shadow-2xl border border-slate-700/60 max-w-sm animate-fade-in animate-slide-up duration-300">
          <div className="text-base shrink-0 select-none">
            {toast.type === "success" && "🟢"}
            {toast.type === "warning" && "🟡"}
            {toast.type === "error" && "🔴"}
            {toast.type === "info" && "🔵"}
          </div>
          <div className="flex-1 text-[12px] font-medium leading-relaxed">
            {toast.message}
          </div>
          <button 
            onClick={() => setToast(null)} 
            className="text-slate-400 hover:text-white transition-colors text-base font-bold pl-2 outline-none select-none"
          >
            &times;
          </button>
        </div>
      )}

      {/* Modal dán đoạn văn bản trực tiếp từ clipboard */}
      {isPasteModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in animate-duration-200">
          <div className="bg-white rounded-xl shadow-2xl p-6 w-[650px] max-w-[95vw] border border-brand-border flex flex-col max-h-[85vh] transition-all">
            <div className="flex items-center justify-between pb-3 border-b border-brand-border mb-4">
              <h3 className="text-[15px] font-bold text-slate-800 flex items-center gap-2">
                <span className="text-lg">📋</span> Dán văn bản rà soát lỗi
              </h3>
              <button 
                onClick={() => { setIsPasteModalOpen(false); setPastedText(""); }}
                className="text-slate-400 hover:text-slate-600 p-1 text-2xl leading-none transition-all"
              >
                &times;
              </button>
            </div>

            <div className="flex-1 min-h-0 flex flex-col mb-4">
              <p className="text-xs text-slate-500 mb-3 leading-relaxed">
                Nhập văn bản của bạn dưới đây. AI sẽ rà soát và đánh dấu trực quan các lỗi về chính tả, cách viết hoa, văn phong, quy chuẩn Nghị định 30 hoặc Hướng dẫn 05-HD/VPTW ngay lập tức.
              </p>
              
              <div className="flex justify-end mb-2">
                <button
                  type="button"
                  onClick={handlePasteFromClipboard}
                  className="flex items-center text-xs text-brand-primary hover:text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg font-semibold transition-all shadow-sm border border-blue-100"
                >
                  <span className="mr-1.5">📋</span> Dán nhanh từ bộ nhớ tạm
                </button>
              </div>

              <textarea
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder="Dán (Ctrl + V) hoặc nhập nội dung văn bản hành chính cần rà soát tại đây..."
                className="w-full h-80 flex-1 border border-brand-border rounded-lg p-4 font-sans text-[13px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand-primary/25 focus:border-brand-primary resize-none placeholder-slate-400 text-slate-700"
                autoFocus
              />
            </div>

            <div className="flex gap-3 justify-end items-center border-t border-brand-border pt-4">
              <button
                onClick={() => { setIsPasteModalOpen(false); setPastedText(""); }}
                className="px-4 py-2 border border-slate-200 rounded-md hover:bg-slate-50 transition-all text-xs font-semibold text-slate-600"
              >
                Hủy bỏ
              </button>
              <button
                onClick={() => handlePasteConfirm(pastedText)}
                className="px-5 py-2 bg-brand-primary text-white hover:bg-blue-700 rounded-md transition-all text-xs font-semibold shadow-sm"
              >
                Xác nhận rà soát
              </button>
            </div>
          </div>
        </div>
      )}


    </div>
  );
}

