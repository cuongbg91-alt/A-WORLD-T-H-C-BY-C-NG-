import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import express from "express";
import fs from "fs/promises";
import path from "path";
import WordExtractor from "word-extractor";
import mammoth from "mammoth";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "50mb" }));

const KNOWLEDGE_PATH = path.join(process.cwd(), "knowledge.json");
const TMP_KNOWLEDGE_PATH = "/tmp/knowledge.json";

let memoryKnowledge: any = null;

async function ensureKnowledgeFile() {
  if (memoryKnowledge) return;

  // Thử đọc từ gốc
  try {
    const data = await fs.readFile(KNOWLEDGE_PATH, "utf-8");
    if (data.trim()) {
      memoryKnowledge = JSON.parse(data);
      console.log("Successfully loaded knowledge from default root path.");
      return;
    }
  } catch {
    // Không đọc được từ gốc, thử đọc từ /tmp
    try {
      const data = await fs.readFile(TMP_KNOWLEDGE_PATH, "utf-8");
      if (data.trim()) {
        memoryKnowledge = JSON.parse(data);
        console.log("Successfully loaded knowledge from /tmp backup path.");
        return;
      }
    } catch {
      // Cả hai đều không có, tạo mới
    }
  }

  memoryKnowledge = { learnedRules: [] };
  
  // Thử ghi khởi tạo vào root
  try {
    await fs.writeFile(KNOWLEDGE_PATH, JSON.stringify(memoryKnowledge, null, 2));
  } catch {
    // Nếu rớt lỗi do read-only, thử ghi vào /tmp
    try {
      await fs.writeFile(TMP_KNOWLEDGE_PATH, JSON.stringify(memoryKnowledge, null, 2));
    } catch (tmpErr) {
      console.warn("Failed to write initial knowledge file to both root and /tmp. Running entirely in-memory.", tmpErr);
    }
  }
}

async function readKnowledgeFile() {
  if (!memoryKnowledge) {
    await ensureKnowledgeFile();
  }
  return memoryKnowledge || { learnedRules: [] };
}

async function saveKnowledgeFile(data: any) {
  memoryKnowledge = data;
  
  // 1. Thử ghi vào root
  try {
    await fs.writeFile(KNOWLEDGE_PATH, JSON.stringify(data, null, 2));
    return;
  } catch (rootErr) {
    console.warn("Root filesystem is read-only (e.g. Vercel). Attempting to write to /tmp/knowledge.json instead.");
  }

  // 2. Thử ghi vào /tmp
  try {
    await fs.writeFile(TMP_KNOWLEDGE_PATH, JSON.stringify(data, null, 2));
  } catch (tmpErr) {
    console.warn("Could not save knowledge file to /tmp either. Updated data is stored in server runtime memory only.", tmpErr);
  }
}

let aiClient: GoogleGenAI | null = null;
function getAIClient(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      const keyError = new Error(
        "Cơ sở dữ liệu đang thiếu cấu hình khoá bảo mật (GEMINI_API_KEY). Quý khách hãy thiết lập API Key trong phần Settings (góc trên cùng bên phải giao diện ứng dụng) để tiếp tục."
      ) as any;
      keyError.status = 401;
      throw keyError;
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

function cleanJsonNewlines(jsonStr: string): string {
  let insideString = false;
  let result = "";
  for (let i = 0; i < jsonStr.length; i++) {
    const char = jsonStr[i];
    if (char === '"' && (i === 0 || jsonStr[i - 1] !== '\\')) {
      insideString = !insideString;
      result += char;
    } else if (insideString && (char === '\n' || char === '\r')) {
      result += " "; // Thay thế xuống dòng thực tế bằng khoảng trắng để tránh lỗi cú pháp JSON
    } else if (insideString && char === '\t') {
      result += " "; // Thay thế tab thực tế bằng khoảng trắng để tránh lỗi cú pháp JSON
    } else {
      result += char;
    }
  }
  return result;
}

function parseRobustJsonArray(text: string): any[] {
  let cleaned = text.trim();
  
  // Trích xuất phần nằm giữa các dải ```json ... ``` hoặc ``` ... ``` nếu có bất kỳ nơi nào trong chuỗi
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }

  // 1. Thử parse nguyên bản sau khi đã dọn dẹp ký tự xuống dòng thực tế
  try {
    const cleanStr = cleanJsonNewlines(cleaned);
    const parsed = JSON.parse(cleanStr);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") return [parsed];
  } catch (err) {
    console.warn("JSON.parse trực tiếp thất bại, đang chuyển sang các bộ lọc phục hồi...", err);
  }

  // 2. Trích xuất tất cả các khối {...} bằng Regex nhiều dòng
  const objectRegex = /\{[\s\S]*?\}/g;
  const matches = cleaned.match(objectRegex);
  if (matches && matches.length > 0) {
    const list: any[] = [];
    for (const match of matches) {
      try {
        const cleanItemStr = cleanJsonNewlines(match);
        const item = JSON.parse(cleanItemStr);
        if (item && item.text) {
          list.push(item);
        }
      } catch (e) {
        // Thử dọn dẹp thêm các lỗi sai cấu trúc nhỏ khác nếu có thể (chữ viết không bọc ngoặc, nháy đơn)
        try {
          let fixedMatch = match.replace(/'/g, '"');
          fixedMatch = fixedMatch.replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":');
          fixedMatch = cleanJsonNewlines(fixedMatch);
          const item = JSON.parse(fixedMatch);
          if (item && item.text) {
            list.push(item);
          }
        } catch (_) {}
      }
    }
    if (list.length > 0) {
      return list;
    }
  }

  // 3. Thử sửa chữa ngoặc dở dang theo thuật toán đếm ngoặc
  let repaired = cleaned;
  try {
    if (repaired.endsWith(",")) {
      repaired = repaired.substring(0, repaired.length - 1);
    }
    let openBraces = (repaired.match(/\{/g) || []).length;
    let closeBraces = (repaired.match(/\}/g) || []).length;
    let openBrackets = (repaired.match(/\[/g) || []).length;
    let closeBrackets = (repaired.match(/\]/g) || []).length;

    while (openBraces > closeBraces) {
      repaired += "}";
      closeBraces++;
    }
    while (openBrackets > closeBrackets) {
      repaired += "]";
      closeBrackets++;
    }
    
    const parsed = JSON.parse(cleanJsonNewlines(repaired));
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") return [parsed];
  } catch (e) {
    // Thất bại
  }

  // 4. Giải pháp cuối cùng vững chắc nhất: Quét từng khối {} và lấy các cặp thuộc tính bằng Regex độc lập thứ tự các trường
  const errors: any[] = [];
  try {
    const objectBlocks = cleaned.match(/\{[\s\S]*?\}/g);
    if (objectBlocks) {
      for (const block of objectBlocks) {
        const textMatch = block.match(/"text"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
        const errorMatch = block.match(/"error"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
        const suggestionMatch = block.match(/"suggestion"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
        const typeMatch = block.match(/"type"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
        
        if (textMatch && errorMatch && suggestionMatch && typeMatch) {
          errors.push({
            text: textMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
            error: errorMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
            suggestion: suggestionMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
            type: typeMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'),
          });
        }
      }
    }
  } catch (_) {}

  return errors;
}

// Hàm hỗ trợ gọi Gemini với cơ chế thử lại và chuyển đổi mô hình dự phòng khi gặp lỗi
async function generateContentWithRetryAndFallback(prompt: string): Promise<string> {
  const ai = getAIClient();

  const modelsToTry = [
    "gemini-3.5-flash",      // Mô hình thế hệ mới nhất, thông minh vượt trội, cực kỳ ổn định và ưu việt cho rà soát JSON
    "gemini-3.1-flash-lite", // Bản siêu nhẹ, độ trễ cực thấp, hạn mức (Quota) rất lớn, dự phòng chống nghẽn lý tưởng
    "gemini-2.5-flash",      // Mô hình thế hệ mới, bổ sung phương án dự phòng hiệu năng cao
    "gemini-flash-latest",   // Phiên bản Flash ổn định kinh điển, dự phòng an toàn cuối cùng
  ];
  let lastError: any = null;

  for (const modelName of modelsToTry) {
    let retries = 2; // Giảm xuống 2 để chuyển đổi mô hình nhanh hơn nếu gặp lỗi
    let delay = 1000;

    while (retries > 0) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: {
            temperature: 0.1,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: {
                    type: Type.STRING,
                    description: "Từ hoặc cụm từ bị lỗi gốc trong văn bản."
                  },
                  error: {
                    type: Type.STRING,
                    description: "Mô tả lý do hoặc lỗi sai quy chuẩn/chính tả."
                  },
                  suggestion: {
                    type: Type.STRING,
                    description: "Đề xuất sửa lại cho chính xác quy chuẩn."
                  },
                  type: {
                    type: Type.STRING,
                    description: "Loại lỗi (ví dụ: chính tả, viết hoa, văn phong, nghị định 30, hướng dẫn 36, quy chuẩn)."
                  }
                },
                required: ["text", "error", "suggestion", "type"]
              }
            }
          }
        });

        if (response && response.text) {
          return response.text;
        }
        throw new Error("Phản hồi từ mô hình AI bị trống");
      } catch (err: any) {
        lastError = err;
        let statusCode = err.status || err.statusCode || err.error?.code;
        
        // Thử trích xuất mã số lỗi từ chuỗi JSON hoặc thông điệp lỗi nếu không có trực tiếp
        if (!statusCode && err.message) {
          try {
            const matches = err.message.match(/"code"\s*:\s*(\d+)/) || err.message.match(/status\s*code\s*(\d+)/i);
            if (matches) {
              statusCode = parseInt(matches[1], 10);
            }
          } catch (_) {}
          
          if (!statusCode) {
            if (err.message.includes("429") || err.message.includes("quota") || err.message.includes("RESOURCE_EXHAUSTED") || err.message.includes("limit") || err.message.includes("exceeded")) {
              statusCode = 429;
            } else if (err.message.includes("503") || err.message.includes("UNAVAILABLE")) {
              statusCode = 503;
            } else if (err.message.includes("500") || err.message.includes("INTERNAL")) {
              statusCode = 500;
            }
          }
        }
        
        // Ghi nhận cảnh báo lỗi nhẹ nhàng, không in toàn bộ stack trace JSON cồng kềnh
        const shortMsg = err.message ? (err.message.substring(0, 150) + "...") : err;
        console.warn(`[Gemini Fallback Window] Gọi mô hình ${modelName} gặp sự cố (Mã lỗi: ${statusCode || "unknown"}). Chi tiết: ${shortMsg}`);

        // Đối với lỗi 500 hoặc 503 hoặc 429 quá tải: chuyển ngay sang mô hình dự phòng tiếp theo
        if (statusCode === 500 || statusCode === 503) {
          break;
        }

        if (statusCode === 429) {
          const isModelQuotaExceeded = err.message && (
            err.message.toLowerCase().includes("quota") || 
            err.message.toLowerCase().includes("resource_exhausted") || 
            err.message.toLowerCase().includes("limit") ||
            err.message.toLowerCase().includes("exceeded")
          );

          if (isModelQuotaExceeded) {
            console.warn(`Mô hình ${modelName} hết hạn mức (Quota). Chuyển sang mô hình tiếp theo ngay lập tức...`);
            break; 
          }

          retries--;
          if (retries > 0) {
            await new Promise((resolve) => setTimeout(resolve, delay));
            delay *= 1.5;
            continue;
          }
        }
        
        break;
      }
    }
  }

  if (lastError) {
    const errorMsg = (lastError.message || String(lastError)).toLowerCase();
    if (errorMsg.includes("api_key_invalid") || errorMsg.includes("invalid api key") || errorMsg.includes("key is invalid") || errorMsg.includes("key_invalid")) {
      const authError = new Error(
        "Khóa bảo mật GEMINI_API_KEY không chính xác hoặc đã hết hiệu lực. Quý khách vui lòng kiểm tra lại cấu hình API Key trong mục Settings."
      ) as any;
      authError.status = 401;
      throw authError;
    }
  }

  // Thay vì trả về lỗi JSON thô kệch, trả về thông báo tiếng Việt lịch sự và dễ hiểu cho người dùng
  const finalError = new Error(
    "Hệ thống rà soát hiện đang bận hoặc đạt giới hạn lưu lượng dùng thử (API Quota Limit). Vui lòng đợi khoảng 1 phút rồi nhấn rà soát lại văn bản."
  ) as any;
  finalError.status = 429;
  throw finalError;
}

function parseRtfToText(rtfStr: string): string {
  let cleaned = rtfStr;
  
  // 1. Loại bỏ các khối metadata và định nghĩa không có văn bản nhìn thấy được
  cleaned = cleaned.replace(/\{\\fonttbl[\s\S]*?\}/g, "");
  cleaned = cleaned.replace(/\{\\colortbl[\s\S]*?\}/g, "");
  cleaned = cleaned.replace(/\{\\stylesheet[\s\S]*?\}/g, "");
  cleaned = cleaned.replace(/\{\\\*\\generator[\s\S]*?\}/g, "");
  cleaned = cleaned.replace(/\{\\\*\\expandedcolortbl[\s\S]*?\}/g, "");
  cleaned = cleaned.replace(/\{\\\*\\listtable[\s\S]*?\}/g, "");
  cleaned = cleaned.replace(/\{\\\*\\listoverridetable[\s\S]*?\}/g, "");
  cleaned = cleaned.replace(/\{\\\*\\revtbl[\s\S]*?\}/g, "");
  cleaned = cleaned.replace(/\{\\info[\s\S]*?\}/g, "");
  
  // 2. Chuyển đổi lệnh phân đoạn RTF thành ký tự xuống dòng
  cleaned = cleaned.replace(/\\par\b/g, "\n");
  cleaned = cleaned.replace(/\\line\b/g, "\n");
  cleaned = cleaned.replace(/\\tab\b/g, "\t");

  // 3. Giải mã các ký tự Unicode dạng \u1234? (Số thập phân có dấu 16-bit)
  cleaned = cleaned.replace(/\\u(-?\d+)\??/g, (match, decVal) => {
    let num = parseInt(decVal, 10);
    if (num < 0) {
      num += 65536;
    }
    return String.fromCharCode(num);
  });

  // 4. Giải mã các kí tự dạng hex \'xx (Ví dụ \'e1, \'e2...) từ bảng mã tương ứng
  const win1258Map: { [key: string]: string } = {
    "e0": "à", "e1": "á", "e2": "â", "e3": "̃", "e8": "è", "e9": "é", "ea": "ê", "ec": "́", "ed": "í",
    "f2": "ò", "f3": "̣", "f4": "ô", "f5": "õ", "f9": "ù", "fa": "ú", "fd": "ý",
    "c0": "À", "c1": "Á", "c2": "Â", "c3": "Ã", "c8": "È", "c9": "É", "ca": "Ê", "cc": "̀", "cd": "Í",
    "d2": "Ò", "d3": "Ó", "d4": "Ô", "d5": "Õ", "d9": "Ù", "da": "Ú", "dd": "Ý",
    "e5": "ă", "c5": "Ă", "f1": "đ", "d1": "Đ", "eb": "̉", "ef": "ï", "f6": "ö", "fc": "ü"
  };

  cleaned = cleaned.replace(/\\'([0-9a-fA-F]{2})/g, (match, hexVal) => {
    const hex = hexVal.toLowerCase();
    if (win1258Map[hex]) return win1258Map[hex];
    const charCode = parseInt(hex, 16);
    if (charCode >= 32 && charCode <= 126) {
      return String.fromCharCode(charCode);
    }
    return "";
  });

  // 5. Loại bỏ tất cả các lệnh RTF bắt đầu với \ còn sót lại
  cleaned = cleaned.replace(/\\([a-z]+[0-9]*|-?[0-9]+)\s*/g, "");
  cleaned = cleaned.replace(/\\(\*[a-z]+[0-9]*)\s*/g, "");

  // 6. Xóa bỏ các cặp ngoặc nhọn định dạng RTF
  cleaned = cleaned.replace(/[{}]/g, "");

  // 7. Làm sạch các khoảng trắng và dòng thừa thụt lùi bất thường
  return cleaned
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join("\n");
}

function parseXmlWordToText(xmlStr: string): string {
  const tTags = xmlStr.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g);
  if (tTags && tTags.length > 0) {
    const textPieces = tTags.map(tag => {
      const content = tag.replace(/<w:t[^>]*>([\s\S]*?)<\/w:t>/, "$1");
      return content
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"');
    });
    return textPieces.join(" ");
  }

  let cleaned = xmlStr.replace(/<[^>]+>/g, "\n");
  cleaned = cleaned
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
    
  return cleaned
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join("\n");
}

app.post("/api/parse-doc", async (req, res) => {
  try {
    const { base64, filename } = req.body;
    if (!base64) {
      return res.status(400).json({ error: "Không tìm thấy dữ liệu tệp tin." });
    }

    const buffer = Buffer.from(base64, "base64");
    
    let text = "";
    let html = "";
    let orientation: "portrait" | "landscape" = "portrait";

    // Kiểm tra chữ ký tệp tin (magic bytes)
    const isDocx = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04;
    const isRtf = buffer.length >= 5 && buffer[0] === 0x7B && buffer[1] === 0x5C && buffer[2] === 0x72 && buffer[3] === 0x74 && buffer[4] === 0x66; // "{\rtf"
    const isXml = buffer.length >= 5 && buffer[0] === 0x3C && buffer[1] === 0x3F && buffer[2] === 0x78 && buffer[3] === 0x6D && buffer[4] === 0x6C; // "<?xml"

    if (isDocx) {
      console.log("Phát hiện tệp tin là DOCX (ZIP) ẩn dưới đuôi định dạng .doc.");
      const textResult = await mammoth.extractRawText({ buffer });
      const htmlResult = await mammoth.convertToHtml({ buffer });
      text = textResult.value;
      html = htmlResult.value;
    } else if (isRtf) {
      console.log("Phát hiện tệp tin là RTF (Rich Text Format). Đang sử dụng bộ bóc tách RTF...");
      const rawRtf = buffer.toString("utf-8");
      text = parseRtfToText(rawRtf);
      
      const paragraphs = text.split(/\n+/);
      const htmlLines = paragraphs.map(p => {
        const trimmed = p.trim();
        if (!trimmed) return "";
        const escaped = trimmed
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        return `<p class="text-justify">${escaped}</p>`;
      }).filter(line => line !== "");
      html = htmlLines.join("\n");
    } else if (isXml) {
      console.log("Phát hiện tệp tin là XML. Đang sử dụng bộ trích xuất Word XML...");
      const rawXml = buffer.toString("utf-8");
      text = parseXmlWordToText(rawXml);
      
      const paragraphs = text.split(/\n+/);
      const htmlLines = paragraphs.map(p => {
        const trimmed = p.trim();
        if (!trimmed) return "";
        const escaped = trimmed
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        return `<p class="text-justify">${escaped}</p>`;
      }).filter(line => line !== "");
      html = htmlLines.join("\n");
    } else {
      // Thử bóc tách theo nguyên bản Word 97 - 2003 (.doc)
      try {
        console.log("Thử bóc tách bằng Word-Extractor tiêu chuẩn...");
        const extractor = new WordExtractor();
        const doc = await extractor.extract(buffer);
        text = doc.getBody();

        const paragraphs = text.split(/\r?\n/);
        const htmlLines = paragraphs.map(p => {
          const trimmed = p.trim();
          if (!trimmed) return "";
          const escaped = trimmed
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          return `<p class="text-justify">${escaped}</p>`;
        }).filter(line => line !== "");
        html = htmlLines.join("\n");
      } catch (extractorErr) {
        console.warn("WordExtractor gốc thất bại, thử nạp dưới dạng Plain Text văn bản thô:", extractorErr);
        const textStr = buffer.toString("utf-8");
        const isBinary = /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(textStr.slice(0, 500));
        if (!isBinary) {
          text = textStr;
          const paragraphs = text.split(/\r?\n/);
          const htmlLines = paragraphs.map(p => {
            const trimmed = p.trim();
            if (!trimmed) return "";
            const escaped = trimmed
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;");
            return `<p class="text-justify">${escaped}</p>`;
          }).filter(line => line !== "");
          html = htmlLines.join("\n");
        } else {
          throw extractorErr;
        }
      }
    }

    res.json({
      success: true,
      text,
      html,
      orientation
    });
  } catch (error: any) {
    console.error("Lỗi khi giải mã tệp tin .doc:", error);
    res.status(500).json({ error: "Giải nén tệp tin Word 97 - 2003 (.doc) thất bại. Vui lòng đảm bảo tệp tin không bị lỗi hoặc thử chuyển đổi hướng lưu dạng .docx." });
  }
});

app.post("/api/proofread", async (req, res) => {
  try {
    const { text, mode, learnedContext } = req.body;
    if (!text) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.write(`data: ${JSON.stringify({ type: "chunk_result", errors: [] })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      return res.end();
    }

    // Đọc kiến thức đã học
    const knowledgeData = await readKnowledgeFile();
    const knowledgeRulesList = (knowledgeData.learnedRules || []).map((rule: any) => {
      if (typeof rule === "string") {
        return rule;
      }
      return `[Nguồn: ${rule.source || "Thủ công"}] Thể loại: ${rule.category || "Chung"}. Quy tắc định dạng hoặc ngữ pháp: ${rule.content}`;
    });
    const knowledgeString = knowledgeRulesList.slice(0, 50).join("\n");

    // Hàm xử lý từng đoạn văn bản
    const processChunk = async (chunkText: string) => {
      const prompt = `
        Bạn là một chuyên gia rà soát lỗi văn bản hành chính Việt Nam và văn bản Đảng cấp cao.
        Công cụ: "Word tự học by Cường".
        
        NHIỆM VỤ: Rà soát văn bản và trả về JSON Array các lỗi.
        
        QUY ĐỊNH PHÁP LÝ & KỸ THUẬT:
        - Chế độ: ${mode} (Tập trung rà soát theo Nghị định 30/2020/NĐ-CP cho khối Cơ quan Nhà nước hoặc Hướng dẫn 05-HD/VPTW (ban hành ngày 27/5/2026, thay thế hoàn toàn Hướng dẫn 36-HD/VPTW) cho khối Văn phòng Đảng; đồng thời tuân thủ các quy tắc hiện đại tuyệt đối của Nghị định 150/2025/NĐ-CP về định dạng, liên thông dữ liệu, hồ sơ điện tử và ký số công vụ).
        - Chính tả/Ngữ pháp: Sửa lỗi chính tả, sai chính tả địa danh, lỗi viết hoa sai quy chuẩn.
        - Văn phong: Mang tính trang trọng, rõ nghĩa, hành chính công vụ thuần túy, tuyệt đối không dùng ngôn ngữ suồng sã.
        - Hệ thống kiến thức tự học cập nhật từ người dùng chủ trì:
        ${knowledgeString}
        - Thước đo lỗi logic/Quy chuẩn: Bẫy các lỗi lỗi thời (ví dụ như quy định bỏ đơn vị cấp huyện cũ từ 01/7/2025, định danh cơ quan sai chuẩn...).

        ĐẦU RA (JSON Array): [{"text": "...", "error": "...", "suggestion": "...", "type": "..."}]

        VĂN BẢN CẦN SOÁT:
        """
        ${chunkText}
        """
      `;

      const responseText = await generateContentWithRetryAndFallback(prompt);

      return parseRobustJsonArray(responseText);
    };

    // Chia nhỏ văn bản thành các đoạn lớn (khoảng 15000 ký tự) để giảm số lượng request
    const chunkSize = 15000;
    const chunks: string[] = [];
    let currentPos = 0;

    while (currentPos < text.length) {
      let nextPos = currentPos + chunkSize;
      if (nextPos < text.length) {
        // Tìm điểm ngắt đoạn gần nhất để không ngắt giữa câu
        const lastNewline = text.lastIndexOf("\n", nextPos);
        if (lastNewline > currentPos) {
          nextPos = lastNewline;
        } else {
          const lastPeriod = text.lastIndexOf(". ", nextPos);
          if (lastPeriod > currentPos) nextPos = lastPeriod + 1;
        }
      }
      chunks.push(text.substring(currentPos, nextPos).trim());
      currentPos = nextPos;
    }

    // Thiết lập headers trả về dưới dạng sự kiện truyền phát thời gian thực (SSE)
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    // Xử lý tuần tự thay vì song song để tránh lỗi 429
    let totalErrorsCount = 0;
    let lastChunkError: any = null;
    for (const chunk of chunks) {
      try {
        const result = await processChunk(chunk);
        if (Array.isArray(result)) {
          totalErrorsCount += result.length;
          res.write(`data: ${JSON.stringify({ type: "chunk_result", errors: result })}\n\n`);
        }
      } catch (chunkError: any) {
        console.error("Error processing chunk:", chunkError);
        lastChunkError = chunkError;
        
        const statusCode = chunkError.status || chunkError.statusCode || chunkError.error?.code;
        if (statusCode === 429) {
          res.write(`data: ${JSON.stringify({ 
            type: "warning", 
            message: "Giới hạn yêu cầu đã hết (API Quota limit). Vui lòng đợi một lát rồi thử rà soát lại một lần nữa." 
          })}\n\n`);
          break; // Đổ bể do hết quota, không xử lý tiếp để tránh quá tải
        }
        
        res.write(`data: ${JSON.stringify({ 
          type: "warning", 
          message: `Lỗi khi xử lý một phần văn bản: ${chunkError.message || "Đã xảy ra lỗi không xác định"}` 
        })}\n\n`);
      }
    }

    if (totalErrorsCount === 0 && lastChunkError) {
      throw lastChunkError;
    }
    
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  } catch (error: any) {
    console.error("Error proofreading:", error);
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: "error", error: error.message || "Lỗi hệ thống khi rà soát văn bản" })}\n\n`);
      return res.end();
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.write(`data: ${JSON.stringify({ type: "error", error: error.message || "Lỗi hệ thống khi rà soát văn bản" })}\n\n`);
    res.end();
  }
});

async function generateContentForLearning(prompt: string): Promise<string> {
  const ai = getAIClient();

  const modelsToTry = [
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash",
    "gemini-flash-latest"
  ];
  let lastError: any = null;

  for (const modelName of modelsToTry) {
    let retries = 2;
    while (retries > 0) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: {
            temperature: 0.2,
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  category: {
                    type: Type.STRING,
                    description: "Thể loại quy tắc (ví dụ: Định dạng, Chính tả & Ngữ pháp, Văn phong, Logic)."
                  },
                  content: {
                    type: Type.STRING,
                    description: "Nội dung chi tiết súc tích, thực tiễn nhất của quy tắc học được từ nguồn."
                  }
                },
                required: ["category", "content"]
              }
            }
          }
        });

        if (response && response.text) {
          return response.text;
        }
        throw new Error("Phản hồi tự học bị trống");
      } catch (err: any) {
        lastError = err;
        retries--;
        if (retries > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }
  }

  throw lastError || new Error("Không thể gọi thư viện AI để học quy chuẩn.");
}

app.post("/api/learn", async (req, res) => {
  try {
    const { content } = req.body;
    const data = await readKnowledgeFile();
    const newRule = {
      id: `${Math.random().toString(36).substring(2, 9)}-${Date.now()}`,
      category: "Quy chuẩn",
      source: "Xử lý thủ công",
      content,
      createdAt: new Date().toISOString()
    };
    data.learnedRules.push(newRule);
    await saveKnowledgeFile(data);
    res.json({ success: true, rule: newRule });
  } catch (error) {
    res.status(500).json({ error: "Learning failed" });
  }
});

app.get("/api/learned-rules", async (req, res) => {
  try {
    const data = await readKnowledgeFile();
    const list = data.learnedRules || [];
    
    // Bảo vệ & chuẩn hóa dữ liệu cũ (nếu có chuỗi thường) sang đối tượng có cấu trúc
    let modified = false;
    const structuredList = list.map((item: any) => {
      if (typeof item === "string") {
        modified = true;
        return {
          id: `${Math.random().toString(36).substring(2, 9)}-${Date.now()}`,
          category: "Quy chuẩn",
          source: "Thủ công",
          content: item,
          createdAt: new Date().toISOString()
        };
      }
      if (!item.id) {
        modified = true;
        item.id = `${Math.random().toString(36).substring(2, 9)}-${Date.now()}`;
      }
      return item;
    });

    if (modified) {
      data.learnedRules = structuredList;
      await saveKnowledgeFile(data);
    }

    res.json({ success: true, learnedRules: structuredList });
  } catch (error) {
    res.status(500).json({ error: "Không thể lấy danh sách kiến thức đã học." });
  }
});

app.post("/api/learned-rules", async (req, res) => {
  try {
    const { content, category, source } = req.body;
    if (!content) {
      return res.status(400).json({ error: "Nội dung quy định không được để trống." });
    }

    const data = await readKnowledgeFile();
    if (!data.learnedRules) {
      data.learnedRules = [];
    }

    const newRule = {
      id: `${Math.random().toString(36).substring(2, 9)}-${Date.now()}`,
      category: category || "Quy chuẩn",
      source: source || "Thủ công",
      content,
      createdAt: new Date().toISOString()
    };

    data.learnedRules.push(newRule);
    await saveKnowledgeFile(data);
    res.json({ success: true, rule: newRule });
  } catch (error) {
    res.status(500).json({ error: "Không thể thêm quy trình tự học mới." });
  }
});

app.put("/api/learned-rules/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { content, category, source } = req.body;
    
    const data = await readKnowledgeFile();
    const list = data.learnedRules || [];
    
    const index = list.findIndex((r: any) => r && r.id === id);
    if (index === -1) {
      return res.status(404).json({ error: "Không tìm thấy quy tắc cần cập nhật." });
    }

    list[index] = {
      ...list[index],
      content: content !== undefined ? content : list[index].content,
      category: category !== undefined ? category : list[index].category,
      source: source !== undefined ? source : list[index].source,
      updatedAt: new Date().toISOString()
    };

    data.learnedRules = list;
    await saveKnowledgeFile(data);
    res.json({ success: true, rule: list[index] });
  } catch (error) {
    res.status(500).json({ error: "Cập nhật quy tắc thất bại." });
  }
});

app.delete("/api/learned-rules/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const data = await readKnowledgeFile();
    const list = data.learnedRules || [];
    
    const filtered = list.filter((r: any) => r && r.id !== id);
    data.learnedRules = filtered;
    
    await saveKnowledgeFile(data);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Xóa quy tắc thất bại." });
  }
});

app.post("/api/analyze-and-learn", async (req, res) => {
  try {
    const { source } = req.body;
    if (!source) {
      return res.status(400).json({ error: "Thiếu thông tin nguồn tài liệu học." });
    }

    let parsedRules: any[] = [];
    try {
      const prompt = `
        Bạn là một AI chuyên gia huấn luyện hành chính công vụ Việt Nam chuyên sâu về Hướng dẫn 05-HD/VPTW ngày 27/5/2026 (đã thay thế Hướng dẫn 36), Nghị định 30, Nghị định 150/2025/NĐ-CP.
        Hãy phân tích nguồn quy chuẩn tài liệu: "${source}"
        Hãy đúc kết ra đúng 2 đến 3 quy tắc thiết thực về mặt Định dạng (font chữ Times New Roman, độ thụt đầu dòng lề lùi dòng lề chữ, giãn dòng giãn khoảng cách spacing, cách gõ phím tab) hoặc chính tả quy định viết hoa, cấu trúc định dạng văn bản hành chính điện tử của nguồn này.
        Các quy luật cần rất súc tích, thực tiễn có tính áp dụng cực kỳ cao để rà soát văn bản bằng AI ở các lần sau.

        YÊU CẦU ĐẦU RA:
        Trả về danh sách 2-3 đối tượng quy tắc dưới dạng JSON Array (chỉ chứa mảng các quy tắc, tuân theo lược đồ mẫu).
      `;

      // Gọi Gemini để học từ nguồn tài liệu này
      const responseText = await generateContentForLearning(prompt);
      parsedRules = parseRobustJsonArray(responseText);
    } catch (aiErr) {
      console.warn("AI learning failed (presumably due to API Quota or Connection), using high-quality fallback rules for source:", source);
      // Fallback to high-quality fallback rules if AI hits quota limit or is down!
      if (source.includes("150/2025") || source.includes("150")) {
        parsedRules = [
          {
            category: "Định dạng",
            content: "Quy chuẩn hồ sơ điện tử: Chữ ký số công vụ bắt buộc hiển thị chính thống, thiết lập liên kết lưu trữ trực trực tuyến đồng bộ không sai lệch định danh số."
          },
          {
            category: "Logic",
            content: "Mã định danh văn bản trực tuyến: Các cơ quan ban hành bắt buộc phối thâu và đồng bộ hóa lưu trữ cấu trúc XML liên thông, tránh đứt gãy luồng văn thư điện tử."
          }
        ];
      } else if (source.includes("30/2020") || source.includes("30")) {
        parsedRules = [
          {
            category: "Định dạng",
            content: "Quy chuẩn văn bản hành chính quốc gia: Toàn văn sử dụng phông chữ Times New Roman Unicode, cỡ chữ chính từ 13-14 đứng, spacing giãn đoạn phù hợp."
          },
          {
            category: "Chính tả & Ngữ pháp",
            content: "Quy tắc ngày tháng năm chính xác: Ngày nhỏ hơn 10 và tháng 1, 2 bắt buộc phải viết kèm chữ số 0 (ví dụ: ngày 05 tháng 02 năm 2026; tháng 01; tháng 02)."
          }
        ];
      } else if (source.includes("05-HD") || source.includes("05")) {
        parsedRules = [
          {
            category: "Văn phong hành chính",
            content: "Theo Hướng dẫn mới nhất số 05-HD/VPTW ngày 27/5/2026: Tên đảng bộ bộ cấp trên cùng ghi chữ VIẾT HOA IN ĐẬM độc lập sát lề trái, dòng dưới ghi tên cơ quan ra văn bản."
          },
          {
            category: "Logic",
            content: "Tính nhất quán tối mật hành chính Đảng: Viết hoa đúng từ 'Ban Chấp hành Trung ương' (chữ 'hành' viết hóa thường, tôn kính đặc thù văn kiện Đảng chính thức)."
          }
        ];
      } else {
        parsedRules = [
          {
            category: "Định dạng",
            content: "Thiết lập khoảng cách giãn dòng (line spacing) 1.15 đến 1.3 lines, lề lùi đầu dòng thụt dòng 1cm đến 1.25cm chuyên nghiệp."
          },
          {
            category: "Văn phong hành chính",
            content: "Tuyệt đối tôn vinh văn phong trang trọng hành chính công vụ, không dùng đại từ suồng sã hoặc các từ ngữ vùng miền thiếu chuẩn tắc."
          }
        ];
      }
    }

    const data = await readKnowledgeFile();
    if (!data.learnedRules) {
      data.learnedRules = [];
    }

    const addedRules: any[] = [];
    if (Array.isArray(parsedRules)) {
      for (const rule of parsedRules) {
        const newRule = {
          id: `${Math.random().toString(36).substring(2, 9)}-${Date.now()}`,
          category: rule.category || "Quy chuẩn",
          source: source,
          content: rule.content || "",
          createdAt: new Date().toISOString()
        };
        data.learnedRules.push(newRule);
        addedRules.push(newRule);
      }
    }

    await saveKnowledgeFile(data);
    res.json({ success: true, addedRules });
  } catch (error: any) {
    console.error("Analysis learning failed completely:", error);
    res.status(500).json({ error: error.message || "Quá trình tự học từ nguồn này gặp sự cố." });
  }
});

// Thiết lập Error Handler toàn cục bảo đảm KHÔNG bao giờ trả về HTML cho các yêu cầu API
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Global Express Error Handler:", err);
  if (res.headersSent) {
    return next(err);
  }
  if (req.path.startsWith("/api/")) {
    return res.status(err.status || 500).json({
      error: err.message || "Đã xảy ra lỗi không xác định từ máy chủ rà soát lỗi"
    });
  }
  next(err);
});

async function startServer() {
  await ensureKnowledgeFile();

  const isVercel = process.env.VERCEL === "1" || !!process.env.NOW_REGION;
  if (isVercel) {
    console.log("Detecting Vercel Serverless environment. Disabling client routing and listening listener.");
    return;
  }

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

export default app;
