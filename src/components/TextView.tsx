import React, { useRef, useEffect, useMemo, useState } from "react";

interface ErrorItem {
  text: string;
  error: string;
  suggestion: string;
  type: string;
}

// Hàm hỗ trợ loại bỏ hoàn toàn khoảng trắng, tab và dấu xuống dòng dư thừa ở phía cuối của các thẻ phần tử
function trimElement(element: Element) {
  let finished = false;
  while (!finished) {
    const lastChild = element.lastChild;
    if (!lastChild) {
      finished = true;
      break;
    }

    if (lastChild.nodeType === Node.TEXT_NODE) {
      const text = lastChild.textContent || "";
      // Sử dụng regex để bóc tách triệt để các khoảng trắng, tab, và các ký tự đệm chuẩn Unicode cuối dòng
      const trimmed = text.replace(/[\s\xA0\u00A0\u200B\u200C\u200D\ufeff]+$/, "");
      if (trimmed === "") {
        element.removeChild(lastChild);
      } else {
        lastChild.textContent = trimmed;
        finished = true;
      }
    } else if (lastChild.nodeType === Node.ELEMENT_NODE) {
      trimElement(lastChild as Element);
      if (lastChild.textContent === "") {
        element.removeChild(lastChild);
      } else {
        finished = true;
      }
    } else {
      element.removeChild(lastChild);
    }
  }
}

function trimTrailingWhitespacesFromHTML(html: string): string {
  if (typeof window === "undefined" || !html) return html;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    
    // Tìm các thẻ văn bản hành chính, bảng biểu, liên kết và danh sách có khả năng chứa khoảng trắng thừa cuối dòng
    const elements = doc.querySelectorAll("p, td, th, li, h1, h2, h3, h4, h5, h6");
    elements.forEach(element => {
      trimElement(element);
    });

    return doc.body.innerHTML;
  } catch (err) {
    console.error("Lỗi khi dọn dẹp khoảng trắng cuối dòng:", err);
    return html;
  }
}

interface TextViewProps {
  htmlContent: string;
  errors: ErrorItem[];
  highlightedError: ErrorItem | null;
  orientation: "portrait" | "landscape";
  onOrientationChange: (orientation: "portrait" | "landscape") => void;
  mode: string;
}

function removeVietnameseTones(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

function formatSpecialHeadersHTML(html: string, mode: string): string {
  if (typeof window === "undefined" || !html) return html;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    
    const elements = doc.querySelectorAll("p, span, td, th, h1, h2, h3, div, b, strong");
    
    elements.forEach(el => {
      const text = el.textContent || "";
      if (!text.trim()) return;
      
      const norm = text.toLowerCase().trim().replace(/\s+/g, " ");
      const noTone = removeVietnameseTones(norm);
      
      let shouldKeepOnSingleLine = false;
      
      if (mode === "nd30-report" || mode === "nd30-decision") {
        const matchQuocHieu = noTone.includes("cong hoa xa hoi chu nghia viet nam");
        const matchTieuNgu = noTone.includes("doc lap") && noTone.includes("tu do") && noTone.includes("hanh phuc");
        if (matchQuocHieu || matchTieuNgu) {
          shouldKeepOnSingleLine = true;
        }
      } else if (mode === "hd05") {
        const matchDangCS = noTone.includes("dang cong san viet nam");
        const matchCoQuanDang = noTone.startsWith("dang bo") || 
                                noTone.startsWith("chi bo") || 
                                noTone.startsWith("tinh uy") || 
                                noTone.startsWith("thanh uy") || 
                                noTone.startsWith("huyen uy") || 
                                noTone.startsWith("trung uong dang") || 
                                noTone.startsWith("ban chap hanh") || 
                                noTone.startsWith("ban thuong vu");
        if (matchDangCS || matchCoQuanDang) {
          shouldKeepOnSingleLine = true;
        }
      }
      
      if (shouldKeepOnSingleLine) {
        (el as HTMLElement).style.setProperty("white-space", "nowrap", "important");
      }
    });
    
    return doc.body.innerHTML;
  } catch (err) {
    console.error("Lỗi khi định dạng dòng tiêu đề đặc biệt:", err);
    return html;
  }
}

function formatHorizontalLinesInHTML(html: string): string {
  if (typeof window === "undefined" || !html) return html;
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

    const regex = /[_\-\u2013\u2014\u2015\u2500\u2501](?:\s?[_\-\u2013\u2014\u2015\u2500\u2501]){2,}/g;

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
          const before = text.substring(lastIndex, match.index);
          if (before) {
            fragment.appendChild(document.createTextNode(before));
          }

          const matchedStr = match[0];
          const nakedLength = matchedStr.replace(/\s+/g, "").length;

          const lineSpan = document.createElement("span");
          lineSpan.className = "solid-horizontal-line-inline";
          lineSpan.setAttribute(
            "style",
            `display: inline-block !important; border-top: 1.5px solid #111111 !important; height: 0 !important; vertical-align: middle !important; width: ${nakedLength * 1.15}ch !important; max-width: 100% !important; margin: 4px 0 !important;`
          );

          fragment.appendChild(lineSpan);
          lastIndex = regex.lastIndex;
        }

        const after = text.substring(lastIndex);
        if (after) {
          fragment.appendChild(document.createTextNode(after));
        }

        parent.replaceChild(fragment, node);
      }
    }

    return container.innerHTML;
  } catch (err) {
    console.error("Lỗi khi định dạng đường kẻ ngang nét liền:", err);
    return html;
  }
}

export default function TextView({ htmlContent, errors, highlightedError, orientation, onOrientationChange, mode }: TextViewProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<string[]>([]);

  const processedHtml = useMemo(() => {
    if (!htmlContent) return "";
    
    // Loại bỏ triệt để khoảng trắng hoặc tab ở cuối các đoạn văn bản, bảng biểu, danh sách trước khi hiển thị/đánh dấu lỗi
    const cleanHtml = trimTrailingWhitespacesFromHTML(htmlContent);
    let processed = cleanHtml;
    
    // Định danh và dựng các nét vẽ kẻ ngang nét liền thay thế dãy ký báo gạch dưới
    processed = formatHorizontalLinesInHTML(processed);
    
    // Sắp xếp lỗi theo độ dài giảm dần để tránh việc lỗi ngắn ghi đè lên lỗi dài chứa nó
    const sortedErrors = [...errors].sort((a, b) => b.text.length - a.text.length);

    sortedErrors.forEach(err => {
      // Escape ký tự đặc biệt và xử lý khoảng trắng linh hoạt
      const safeText = err.text.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&').replace(/\s+/g, '\\s+');
      
      try {
        // Sử dụng regex để chỉ tìm văn bản nằm ngoài các thẻ HTML
        const regex = new RegExp(`(?![^<]*>)(${safeText})`, 'g');
        processed = processed.replace(regex, `<span class="bg-red-50 text-brand-accent border-b border-dashed border-brand-accent cursor-help" title="${err.error}">$1</span>`);
      } catch (e) {
        console.error("Highlight error:", err.text, e);
      }
    });

    return formatSpecialHeadersHTML(processed, mode);
  }, [htmlContent, errors, mode]);

  // Thuật toán tự động phân trang A4 đứng/ngang dựa trên môi trường đo lường thực tế
  useEffect(() => {
    if (!processedHtml) {
      setPages([]);
      return;
    }

    try {
      // Tạo một container ảo nằm ẩn để tính toán chiều cao pixel thực của các thẻ con dưới zoom màn hình hiện hành
      const measureContainer = document.createElement("div");
      measureContainer.setAttribute("id", "pagination-measure-container");
      measureContainer.style.position = "absolute";
      measureContainer.style.left = "-9999px";
      measureContainer.style.top = "-9999px";
      measureContainer.style.width = "0";
      measureContainer.style.height = "0";
      measureContainer.style.overflow = "hidden";
      measureContainer.style.visibility = "hidden";
      
      // Áp dụng đúng bề rộng cùng font chữ tương đồng trang Word chuẩn
      const widthClass = orientation === "landscape" ? "w-[297mm]" : "w-[210mm]"; 
      const paddingLeft = "30mm";
      const paddingRight = "20mm";
      
      // Tạo một mốc đo lường chiều cao chuẩn
      const targetHeightMeasure = document.createElement("div");
      targetHeightMeasure.style.height = orientation === "landscape" ? "170mm" : "257mm"; 
      measureContainer.appendChild(targetHeightMeasure);
      document.body.appendChild(measureContainer);
      
      // Chuyển đổi mm sang pixel thực tế của trình duyệt tại Zoom hiện tại
      const maxPageHeightPx = targetHeightMeasure.clientHeight || (orientation === "landscape" ? 642 : 971); 
      measureContainer.removeChild(targetHeightMeasure);
      
      const pageClone = document.createElement("div");
      pageClone.className = `${widthClass} font-['Times_New_Roman',serif] text-[#111111] leading-[1.6] word-render`;
      pageClone.style.paddingLeft = paddingLeft;
      pageClone.style.paddingRight = paddingRight;
      pageClone.style.boxSizing = "border-box";
      measureContainer.appendChild(pageClone);

      // Parse cấu trúc HTML đã highlight lỗi
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = processedHtml;
      const elements = Array.from(tempDiv.children);

      const paginatedPages: string[] = [];
      let currentPageDiv = document.createElement("div");
      pageClone.appendChild(currentPageDiv);

      elements.forEach((el) => {
        const cloneEl = el.cloneNode(true) as HTMLElement;
        currentPageDiv.appendChild(cloneEl);

        // Đẩy sang trang mới khi nội dung vách trang vượt chiều cao in khả dụng
        if (currentPageDiv.clientHeight > maxPageHeightPx) {
          if (currentPageDiv.children.length > 1) {
            currentPageDiv.removeChild(cloneEl);
            paginatedPages.push(currentPageDiv.innerHTML);
            
            currentPageDiv = document.createElement("div");
            pageClone.innerHTML = ""; 
            pageClone.appendChild(currentPageDiv);
            currentPageDiv.appendChild(cloneEl);
          } else {
            // Phần tử đầu tiên của trang nhưng vượt quá chiều cao lớn nhất (bảng biểu dài chẳng hạn), chấp nhận giữ lại
            paginatedPages.push(currentPageDiv.innerHTML);
            
            currentPageDiv = document.createElement("div");
            pageClone.innerHTML = "";
            pageClone.appendChild(currentPageDiv);
          }
        }
      });

      if (currentPageDiv.children.length > 0) {
        paginatedPages.push(currentPageDiv.innerHTML);
      }

      document.body.removeChild(measureContainer);
      setPages(paginatedPages.length > 0 ? paginatedPages : [processedHtml]);
    } catch (err) {
      console.error("Lỗi khi tính toán phân trang tự động:", err);
      setPages([processedHtml]);
    }
  }, [processedHtml, orientation]);

  // Cuộn mượt mà đưa lỗi tới tầm nhìn người dùng
  useEffect(() => {
    if (highlightedError && contentRef.current) {
      const walker = document.createTreeWalker(contentRef.current, NodeFilter.SHOW_TEXT, null);
      let node;
      while ((node = walker.nextNode())) {
        if (node.textContent?.includes(highlightedError.text)) {
          const parent = node.parentElement as HTMLElement;
          if (parent) {
            parent.scrollIntoView({ behavior: 'smooth', block: 'center' });
            parent.classList.add('bg-yellow-100', 'ring-4', 'ring-yellow-400/30', 'transition-all');
            setTimeout(() => {
               parent.classList.remove('bg-yellow-100', 'ring-4', 'ring-yellow-400/30', 'transition-all');
            }, 2000);
          }
          break;
        }
      }
    }
  }, [highlightedError]);

  return (
    <div className="flex-1 flex flex-col bg-[#cbd5e1] overflow-hidden">
      <div className="flex-1 overflow-auto p-12 flex justify-center shadow-inner animate-fade-in">
        {!htmlContent ? (
          <div 
            className={`${
              orientation === "landscape" ? "w-[297mm] min-h-[210mm]" : "w-[210mm] min-h-[297mm]"
            } bg-white shadow-2xl pt-[20mm] pb-[20mm] pl-[30mm] pr-[20mm] font-['Times_New_Roman',serif] text-[#111111] leading-[1.6] relative transition-all flex flex-col items-center justify-center`} 
            id="word-content"
          >
            <div className="flex flex-col items-center justify-center text-slate-400">
              <div className="w-24 h-24 border-2 border-dashed border-slate-300 rounded-2xl flex items-center justify-center mb-6 bg-slate-50">
                <span className="text-5xl opacity-40">📄</span>
              </div>
              <p className="text-sm font-medium">Tải tệp tin DOCX hoặc dán văn bản để rà soát</p>
            </div>
          </div>
        ) : (
          <div ref={contentRef} id="word-content" className="flex flex-col gap-8 w-full items-center select-text pb-12">
            {pages.map((pageHtml, index) => (
              <div
                key={index}
                className={`${
                  orientation === "landscape" ? "w-[297mm] h-[210mm]" : "w-[210mm] h-[297mm]"
                } bg-white shadow-2xl pt-[20mm] pb-[15mm] pl-[30mm] pr-[20mm] font-['Times_New_Roman',serif] text-[#111111] leading-[1.6] relative transition-all duration-300 border border-slate-200/50 hover:shadow-emerald-100 hover:shadow-3xl flex flex-col justify-between`}
              >
                <div 
                  dangerouslySetInnerHTML={{ __html: pageHtml }} 
                  className="word-render w-full flex-1 overflow-hidden"
                />
                
                {/* Phần số trang biểu diễn tinh tế chìm ở cuối trang in */}
                <div className="text-center text-xs text-slate-400 font-mono select-none pt-2 border-t border-slate-100/60 mt-4">
                  Trang {index + 1} / {pages.length}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      
      <style>{`
        /* Đồng nhất màu sắc, định dạng, tab size và font chữ cho toàn bộ văn bản */
        .word-render, .word-render * {
          font-family: 'Times New Roman', Times, serif !important;
          color: #111111 !important;
          tab-size: 4 !important;
          -moz-tab-size: 4 !important;
        }
        
        /* Đảm bảo giữ nguyên các khoảng trắng phức tạp, dấu cách kề nhau, tab từ Word */
        .word-render p, 
        .word-render span, 
        .word-render td, 
        .word-render th, 
        .word-render li,
        .word-render h1,
        .word-render h2,
        .word-render h3,
        .word-render h4,
        .word-render h5,
        .word-render h6,
        .word-render b,
        .word-render strong,
        .word-render i,
        .word-render em,
        .word-render u,
        .word-render s {
          white-space: pre-wrap !important;
          word-break: break-word !important;
        }

        /* Định dạng đường kẻ ngang (nếu xuất hiện từ Word) */
        .word-render hr {
          border: 0 !important;
          border-top: 1.5px solid #111111 !important;
          margin: 1.25rem 0 !important;
          height: 0 !important;
          width: 100% !important;
          display: block !important;
        }

        /* Thể hiện rõ ràng gạch chân, giữ đúng độ dày và cách giãn cho u/ins/text-decoration */
        .word-render u, 
        .word-render ins,
        .word-render [style*="underline"] {
          text-decoration: underline !important;
          text-decoration-style: solid !important;
          text-underline-offset: 2.5px !important;
          text-decoration-thickness: auto !important;
          display: inline !important;
        }

        /* Bảo toàn định dạng gạch ngang cho tất cả các đối tượng */
        .word-render s,
        .word-render strike,
        .word-render del,
        .word-render [style*="line-through"] {
          text-decoration: line-through !important;
          display: inline !important;
        }
        
        /* Cấu hình đoạn văn bản mặc định (văn bản hành chính) */
        .word-render p {
          text-align: justify;
          margin-bottom: 0.85rem;
          font-size: 14.5px;
          line-height: 1.65 !important;
          text-indent: 1.25cm; /* Thụt lề đầu dòng chuẩn văn bản hành chính */
        }
        
        /* Đối với các đoạn văn bản chứa bảng biểu hoặc danh sách, bỏ thụt lề để tránh lệch dòng */
        .word-render table p, .word-render li p {
          text-indent: 0 !important;
          margin-bottom: 0 !important;
          font-size: inherit !important;
        }

        /* Định nghĩa chi tiết các kiểu căn lề, đảm bảo ghi đè chính xác và xoá thụt lề khi không cần thiết */
        .word-render .text-center, .word-render .text-center * {
          text-align: center !important;
          text-indent: 0 !important;
        }
        
        .word-render .text-right, .word-render .text-right * {
          text-align: right !important;
          text-indent: 0 !important;
        }
        
        .word-render .text-justify, .word-render .text-justify * {
          text-align: justify !important;
        }
        
        .word-render .text-left, .word-render .text-left * {
          text-align: left !important;
          text-indent: 0 !important;
        }
        
        .word-render h1, .word-render h2, .word-render h3, .word-render h4, .word-render h5, .word-render h6 {
          font-weight: bold !important;
          margin-top: 1.25rem;
          margin-bottom: 0.5rem;
          line-height: 1.4 !important;
          text-align: left;
          text-indent: 0 !important;
        }
        
        /* Hỗ trợ trường hợp tiêu đề được căn giữa */
        .word-render h1.text-center, .word-render h2.text-center, .word-render h3.text-center {
          text-align: center !important;
          text-indent: 0 !important;
        }
        
        .word-render h1 { font-size: 19px !important; }
        .word-render h2 { font-size: 17px !important; }
        .word-render h3 { font-size: 15.5px !important; }
        
        .word-render b, .word-render strong {
          font-weight: bold !important;
        }
        
        /* Bảng hiển thị thông tin dạng Grid chuẩn */
        .word-render table.grid-table {
          width: 100% !important;
          border-collapse: collapse !important;
          margin: 1.5rem 0 !important;
        }
        
        .word-render table.grid-table td, .word-render table.grid-table th {
          border: 1px solid #111111 !important; /* Đường viền grid rõ ràng như bản gốc */
          padding: 8px 12px !important;
          font-size: 13.5px !important;
          vertical-align: middle !important;
          text-indent: 0 !important;
        }

        /* Bảng căn lề vị trí layout (Không viền mặc định rộng rãi, giữ nguyên các nét kẻ viền chi tiết nếu có) */
        .word-render table.layout-table {
          width: 100% !important;
          border-collapse: collapse !important;
          margin: 1rem 0 !important;
          border: none !important;
        }
        
        .word-render table.layout-table td, .word-render table.layout-table th {
          border: none; /* Tháo bỏ !important để bảo lưu mọi đường kẻ viền tuỳ biến */
          padding: 4px 12px !important;
          font-size: 14px !important;
          vertical-align: top !important;
          text-indent: 0 !important;
        }
        
        /* Dự phòng cho các bảng chưa được phân loại, hiển thị đúng các đường kẻ */
        .word-render table {
          width: 100%;
          border-collapse: collapse;
          margin: 1.25rem 0;
        }
        
        .word-render table:not(.layout-table) td, 
        .word-render table:not(.layout-table) th {
          border: 1px solid #111111 !important;
        }
        
        .word-render td, .word-render th {
          padding: 6px 10px;
          vertical-align: middle;
          text-indent: 0 !important;
        }
        
        .word-render ul, .word-render ol {
          padding-left: 2.5rem;
          margin-bottom: 0.85rem;
          text-indent: 0 !important;
        }
        
        .word-render ul {
          list-style-type: disc !important;
        }
        
        .word-render ol {
          list-style-type: decimal !important;
        }
        
        .word-render li {
          margin-bottom: 0.35rem;
          font-size: 14px;
          line-height: 1.6 !important;
          text-indent: 0 !important;
        }

        /* Định dạng đồng nhất cho vùng hiển thị lỗi rà soát */
        .word-render .bg-red-50 {
          background-color: #fef2f2 !important; /* Màu đỏ nhạt nền tương thích */
          color: #dc2626 !important; /* Chữ đỏ cảnh báo rõ ràng */
          border-bottom: 2px dashed #dc2626 !important; /* Gạch chân lượn sóng/đứt quãng */
          border-radius: 2px;
          padding: 1px 3px !important;
          cursor: help !important;
          display: inline !important;
          font-weight: inherit !important;
        }

        .word-render .bg-green-50, .word-render .corrected-term {
          background-color: #f0fdf4 !important; /* Màu xanh lá nhạt dịu mát */
          color: #16a34a !important; /* Chữ màu ngọc lục bảo bền bỉ, uy tín */
          border-bottom: 2px solid #16a34a !important; /* Nét liền màu xanh vững chãi */
          border-radius: 2px;
          padding: 1px 3px !important;
          cursor: help !important;
          display: inline !important;
          font-weight: bold !important;
        }
        
        .word-render .bg-yellow-100 {
          background-color: #fef08a !important; /* Màu highlight vàng */
          color: #1a1a1a !important;
          border-radius: 2px;
          padding: 1px 3px !important;
          display: inline !important;
        }
      `}</style>
    </div>
  );
}
