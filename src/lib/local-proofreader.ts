/**
 * Local Offline Proofreader & Administrative Advisor
 * Allows the tool to run independently on the browser fallback or assist the AI checks.
 */

interface LocalError {
  id: string;
  text: string;
  error: string;
  suggestion: string;
  type: string;
  timestamp: number;
}

// Map of common administrative orthography typos in Vietnamese documents
const COMMON_TYPOS: { pattern: RegExp; error: string; suggestion: string; type: string }[] = [
  {
    pattern: /uỷ\s+ban\s+nhân\s+dân/gi,
    error: "Sử dụng 'uỷ' trái với chuẩn chính tả hiện hành ('ủy')",
    suggestion: "Ủy ban nhân dân",
    type: "Chính tả"
  },
  {
    pattern: /uỷ\s+viên/gi,
    error: "Chữ viết 'uỷ' không đồng bộ chuẩn chính tả Việt Nam hiện đại",
    suggestion: "ủy viên",
    type: "Chính tả"
  },
  {
    pattern: /độc\s+lập\s*-\s*tự\s+do\s*-\s*hạnh\s+phúc/gi,
    error: "Tiêu ngữ quốc gia viết thường hoặc sai quy cách viết hoa",
    suggestion: "Độc lập - Tự do - Hạnh phúc",
    type: "Tiêu chuẩn NĐ 30"
  },
  {
    pattern: /độc\s+lập\s*-\s*tự\s+do\s*-\s*hạnh\s+phuc/gi,
    error: "Cụm tiêu ngữ quốc gia viết thiếu dấu tiếng Việt",
    suggestion: "Độc lập - Tự do - Hạnh phúc",
    type: "Chính tả"
  },
  {
    pattern: /độc\s+lập\s+tự\s+do\s+hạnh\s+phúc/gi,
    error: "Cụm tiêu ngữ thiếu dấu gạch nối giữa các phân đoạn",
    suggestion: "Độc lập - Tự do - Hạnh phúc",
    type: "Tiêu chuẩn NĐ 30"
  },
  {
    pattern: /Độc\s+lập\s*-\s*Tự\s+Do\s*-\s*Hạnh\s+Phúc/g,
    error: "Sai tiêu chuẩn NĐ 30: Viết hoa chữ 'D' trong 'do' và 'P' trong 'phúc' (Độc lập - Tự do - Hạnh phúc)",
    suggestion: "Độc lập - Tự do - Hạnh phúc",
    type: "Tiêu chuẩn NĐ 30"
  },
  {
    pattern: /cộng\s+hoà\s+xã\s+hội\s+chủ\s+nghĩa\s+việt\s+nam/gi,
    error: "Quốc hiệu quốc gia viết thường hoặc viết sai vị trí dấu thanh ('hoà' thay vì 'hòa')",
    suggestion: "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM",
    type: "Tiêu chuẩn NĐ 30"
  },
  {
    pattern: /CỘNG HOÀ XÃ HỘI CHỦ NGHĨA VIỆT NAM/g,
    error: "Dấu thanh đặt sai vị trí ở từ 'HOÀ' (theo NĐ 30 chữ chuẩn bộ gõ Unicode là 'HÒA')",
    suggestion: "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM",
    type: "Chính tả"
  },
  {
    pattern: /Đảng\s+cộng\s+sản\s+Việt\s+Nam/g,
    error: "Tên Đảng viết thường chữ 'cộng sản' chưa tôn vinh trang trọng",
    suggestion: "Đảng Cộng sản Việt Nam",
    type: "Văn phong"
  },
  {
    pattern: /đảng\s+cộng\s+sản\s+việt\s+nam/g,
    error: "Tên Đảng toàn bộ viết viết thường",
    suggestion: "Đảng Cộng sản Việt Nam",
    type: "Văn phong"
  },
  {
    pattern: /hội\s+đồng\s+nhân\s+dân/g,
    error: "Viết thường cơ quan quyền lực nhà nước ở địa phương",
    suggestion: "Hội đồng nhân dân",
    type: "Văn phong"
  },
  {
    pattern: /ubnd\s+tỉnh/gi,
    error: "Viết tắt cơ quan hành chính chính trong khối văn bản trang trọng",
    suggestion: "Ủy ban nhân dân tỉnh",
    type: "Văn phong"
  },
  {
    pattern: /hđnd\s+tỉnh/gi,
    error: "Nên viết đầy đủ cơ quan dân cử thay vì sử dụng tên viết tắt 'hđnd'",
    suggestion: "Hội đồng nhân dân tỉnh",
    type: "Văn phong"
  },
  {
    pattern: /Số\s*:\s*\d+\s*\\\s*[a-zA-ZĐđ]+/g,
    error: "Sử dụng dấu gạch chéo ngược '\\' không có trong chuẩn ký hiệu số văn bản chính thống",
    suggestion: "Số: .../... ",
    type: "Định dạng"
  }
];

export function runLocalProofreader(text: string, mode: string, learnedRules: any[] = []): LocalError[] {
  const errors: LocalError[] = [];
  if (!text) return errors;

  const addError = (badText: string, desc: string, sugg: string, type: string) => {
    // Tránh trùng lặp
    const exists = errors.some(e => e.text === badText && e.error === desc);
    if (!exists) {
      errors.push({
        id: `local-${Math.random().toString(36).substring(2, 9)}-${Date.now()}`,
        text: badText,
        error: desc,
        suggestion: sugg,
        type: type,
        timestamp: Date.now()
      });
    }
  };

  // 1. Kiểm tra lặp khoảng trắng (Double spaces / Multiple spaces)
  // Quét dòng để tìm khoảng trắng thừa liên tiếp ngoài vị trí lùi dòng tab
  const lines = text.split("\n");
  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed) return;
    
    // Tìm phím khoảng trắng kép ở giữa từ
    const doubleSpaceMatch = line.match(/[^\s]{1}(\s{2,})[^\s]{1}/);
    if (doubleSpaceMatch) {
      const badFragment = doubleSpaceMatch[0];
      const fixedFragment = badFragment.replace(/\s+/g, " ");
      addError(
        badFragment,
        "Lỗi khoảng trắng kép liên tiếp chèn thừa giữa các từ",
        fixedFragment,
        "Định dạng"
      );
    }
  });

  // 2. Chạy từ điển lỗi chính tả cố định thường trực (Static Common Typos)
  COMMON_TYPOS.forEach(typo => {
    typo.pattern.lastIndex = 0;
    
    // Quét toàn văn bản để tìm lỗi hành chính
    const matches = text.match(typo.pattern);
    if (matches) {
      matches.slice(0, 15).forEach(m => {
        // Tạo đề xuất phù hợp với viết hoa hiện tại của lỗi để thẩm mỹ hơn
        let suggestion = typo.suggestion;
        if (m === m.toUpperCase() && m.length > 5) {
          suggestion = typo.suggestion.toUpperCase();
        }
        addError(m, typo.error, suggestion, typo.type);
      });
    }
  });

  // 3. Quy chuẩn ngày tháng năm cực kỳ khắt khe của Nghị định 30/2020/NĐ-CP:
  const daySingleDigitMatch = text.match(/ngày\s+([1-9])\s+tháng/gi);
  if (daySingleDigitMatch) {
    daySingleDigitMatch.forEach(m => {
      const numMatch = m.match(/\d+/);
      if (numMatch) {
        const num = numMatch[0];
        addError(m, `Theo NĐ 30, ngày nhỏ hơn 10 phải ghi dạng 2 chữ số (ngày 0${num})`, `ngày 0${num} tháng`, "Tiêu chuẩn NĐ 30");
      }
    });
  }

  const month12SingleDigitMatch = text.match(/tháng\s+([1-2])\s+năm/gi);
  if (month12SingleDigitMatch) {
    month12SingleDigitMatch.forEach(m => {
      const numMatch = m.match(/\d+/);
      if (numMatch) {
        const num = numMatch[0];
        addError(m, `Theo NĐ 30, tháng 1 và 2 phải viết dạng 2 chữ số (tháng 0${num})`, `tháng 0${num} năm`, "Tiêu chuẩn NĐ 30");
      }
    });
  }

  const monthZeroPrefixMatch = text.match(/tháng\s+0([3-9])\s+năm/gi);
  if (monthZeroPrefixMatch) {
    monthZeroPrefixMatch.forEach(m => {
      const digitMatch = m.match(/tháng\s+0([3-9])\s+năm/i);
      if (digitMatch && digitMatch[1]) {
        const digit = digitMatch[1];
        addError(m, `Theo NĐ 30, tháng từ tháng 3 trở lên KHÔNG được thêm số 0 ở trước (tháng ${digit})`, `tháng ${digit} năm`, "Tiêu chuẩn NĐ 30");
      }
    });
  }

  // 4. Kiểm tra chấm câu viết hoa
  const lowercaseAfterPeriod = text.match(/[\.\?\!]\s+([a-zđàáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ])/g);
  if (lowercaseAfterPeriod) {
    lowercaseAfterPeriod.forEach(m => {
      const charMatch = m.match(/[a-zđàáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]$/);
      if (charMatch) {
        const c = charMatch[0];
        const upper = c === "đ" ? "Đ" : c.toUpperCase();
        const sugg = m.substring(0, m.length - 1) + upper;
        addError(m, "Thiếu chuẩn viết hoa chữ cái đầu tiên của câu sau dấu kết thúc", sugg, "Chính tả");
      }
    });
  }

  // 5. Kiểm tra ký hiệu số văn bản viết hoa sai quy cách
  const lowercaseCodeMatch = text.match(/Số\s*:\s*\d+\s*\/[a-z0-9đ\-]+/gi);
  if (lowercaseCodeMatch) {
    lowercaseCodeMatch.forEach(m => {
      const parts = m.split("/");
      if (parts.length === 2 && parts[1] !== parts[1].toUpperCase()) {
        const codePart = parts[1].toUpperCase()
          .replace("QD", "QĐ")
          .replace("TTG", "TTg")
          .replace("UB", "UBND");
        
        addError(m, "Ký hiệu thể loại và cơ quan ban hành viết thường không đúng chuẩn pháp lý", `${parts[0]}/${codePart}`, "Tiêu chuẩn NĐ 30");
      }
    });
  }

  // 6. Quy chuẩn riêng biệt cho khối Văn Ban Đảng (Chế độ Hướng dẫn 05 - thay thế HD 36)
  if (mode === "hd05") {
    const lowercaseDangCS = text.match(/đảng\s+cộng\s+sản\s+việt\s+nam/gi);
    if (lowercaseDangCS) {
      lowercaseDangCS.forEach(m => {
        if (m !== "ĐẢNG CỘNG SẢN VIỆT NAM") {
          addError(m, "Theo HD 05/2026/VPTW, tên dòng Quốc hiệu danh Đảng phải viết hoa toàn bộ và in đậm dứt khoát", "ĐẢNG CỘNG SẢN VIỆT NAM", "Tiêu chuẩn Đảng");
        }
      });
    }

    const bchTrungUong = text.match(/ban\s+chấp\s+hành\s+trung\s+ương/gi);
    if (bchTrungUong) {
      bchTrungUong.forEach(m => {
        if (m !== "Ban Chấp hành Trung ương") {
          addError(m, "Viết sai chuẩn Hướng dẫn 05 về Ban Chấp hành Trung ương (chữ 'hành' viết thường theo chuẩn đặc hữu hành chính Đảng)", "Ban Chấp hành Trung ương", "Tiêu chuẩn Đảng");
        }
      });
    }
  }

  // 7. ÁP DỤNG DÂN DỰNG TỪ KHÔNG GIAN BỘ QUY TẮC TỰ HỌC (learnedRules)
  // Thực hiện phân tích các chỉ thị tự học của người dùng và rà soát thông thái cục bộ!
  if (Array.isArray(learnedRules) && learnedRules.length > 0) {
    learnedRules.forEach(rule => {
      const content = (rule.content || "").toLowerCase();
      
      // A. Nếu là quy luật viết hoa 'uỷ viên' -> 'ủy viên'
      if (content.includes("ủy viên") && content.includes("uỷ")) {
        const uYVienMatch = text.match(/uỷ\s+viên/gi);
        if (uYVienMatch) {
          uYVienMatch.forEach(m => {
            addError(m, "Sai quy chuẩn viết hoa/viết thường ủy viên theo quy định tự học", "ủy viên", rule.category || "Học tập");
          });
        }
      }

      // B. Nếu quy luật yêu cầu bắt buộc thời gian ngày tháng số không thụt trống
      if (content.includes("ngày") && content.includes("tháng") && content.includes("hai chữ số")) {
        const dayMatch = text.match(/ngày\s+([1-9])\s+tháng/gi);
        if (dayMatch) {
          dayMatch.forEach(m => {
            const digit = m.match(/\d+/)?.[0];
            if (digit) addError(m, "Sai quy tắc đúc kết tự học về ngày tháng định dạng số 0", `ngày 0${digit} tháng`, rule.category || "Học tập");
          });
        }
      }

      // C. Quy tắc viết thường từ viết tắt sai
      if (content.includes("không viết tắt") || content.includes("viết đầy đủ")) {
        // Tìm kiếm các từ viết tắt phổ biến trong văn bản như ubnd, hđnd
        const ubndMatch = text.match(/\bubnd\b/gi);
        if (ubndMatch) {
          ubndMatch.forEach(m => {
            addError(m, "Theo quy chuẩn tự học, không nên lạm dụng viết tắt ubnd", "Ủy ban nhân dân", rule.category || "Học tập");
          });
        }
        const hdndMatch = text.match(/\bhđnd\b/gi);
        if (hdndMatch) {
          hdndMatch.forEach(m => {
            addError(m, "Theo quy chuẩn tự học, không nên lạm dụng viết tắt hđnd", "Hội đồng nhân dân", rule.category || "Học tập");
          });
        }
      }

      // D. Quy tắc về Times New Roman
      if (content.includes("times new roman") && content.includes("phông")) {
        // Rà soát chung
        const matchArial = text.match(/Arial|Calibri/gi);
        if (matchArial) {
          addError(matchArial[0], "Cảnh báo tự học: Khuyên nghị dùng phông chữ chuẩn Times New Roman", "Times New Roman", rule.category || "Học tập");
        }
      }
    });
  }

  return errors;
}
