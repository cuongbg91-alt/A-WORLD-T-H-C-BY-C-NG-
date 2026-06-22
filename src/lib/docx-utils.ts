import { Document, Packer, Paragraph, TextRun, AlignmentType, Table, TableRow, TableCell, BorderStyle, WidthType, PageOrientation } from "docx";
import { saveAs } from "file-saver";
import mammoth from "mammoth";
import JSZip from "jszip";

export async function parseDocx(file: File): Promise<{ text: string; html: string; orientation: "portrait" | "landscape" }> {
  const arrayBuffer = await file.arrayBuffer();
  
  // Detect document page orientation and borders using JSZip
  let orientation: "portrait" | "landscape" = "portrait";
  let xmlDoc: any = null;
  try {
    const zip = await JSZip.loadAsync(file);
    const docXmlFile = zip.file("word/document.xml");
    if (docXmlFile) {
      const docXmlText = await docXmlFile.async("text");
      if (/w:orient\s*=\s*"landscape"/i.test(docXmlText)) {
        orientation = "landscape";
      }
      const xmlParser = new DOMParser();
      xmlDoc = xmlParser.parseFromString(docXmlText, "text/xml");
    }
  } catch (err) {
    console.warn("Failed to detect page orientation or borders from Docx ZIP metadata, defaulting to portrait:", err);
  }
  
  // Heuristic checking to distinguish layout tables (headers/footers with metadata side-by-side)
  // from standard grid-tables containing structured data
  function checkIsLayoutTable(table: any): boolean {
    if (!table.children || table.children.length === 0 || table.children.length > 3) {
      return false;
    }
    for (const row of table.children) {
      if (row.type !== "tableRow") return false;
      if (!row.children || row.children.length !== 2) {
        return false;
      }
    }
    return true;
  }

  // Recursive document AST traversal to detect paragraph alignment and table structures
  function transformDocument(element: any): any {
    if (element.children) {
      element.children = element.children.map(transformDocument);
    }
    
    if (element.type === "paragraph") {
      const align = element.alignment;
      const originalStyle = element.styleName || "";
      const isHeading = /heading\s*(\d)/i.test(originalStyle);
      
      let baseStyle = "Normal";
      if (isHeading) {
        const hMatch = originalStyle.match(/heading\s*(\d)/i);
        if (hMatch) {
          baseStyle = `Heading ${hMatch[1]}`;
        }
      }
      
      if (align === "center") {
        element.styleName = isHeading ? `${baseStyle} Centered` : "Centered";
      } else if (align === "right") {
        element.styleName = isHeading ? `${baseStyle} Right` : "Right";
      } else if (align === "both" || align === "justify") {
        element.styleName = isHeading ? `${baseStyle} Justify` : "Justify";
      } else if (align === "left") {
        element.styleName = isHeading ? `${baseStyle} Left` : "Left";
      } else {
        // No explicit alignment, preserve clean styled titles or body text
        if (isHeading) {
          element.styleName = baseStyle;
        } else {
          // Keep general style for body paragraphs
        }
      }
    } else if (element.type === "table") {
      const isLayout = checkIsLayoutTable(element);
      element.styleName = isLayout ? "LayoutTable" : "GridTable";
    }
    
    return element;
  }

  // Convert Docx to HTML using precise semantic mappings and alignments
  const result = await mammoth.convertToHtml({ arrayBuffer }, {
    transformDocument: transformDocument,
    styleMap: [
      "p[style-name='Centered'] => p.text-center:fresh",
      "p[style-name='Right'] => p.text-right:fresh",
      "p[style-name='Justify'] => p.text-justify:fresh",
      "p[style-name='Left'] => p.text-left:fresh",
      "p[style-name='Heading 1 Centered'] => h1.text-center:fresh",
      "p[style-name='Heading 1 Right'] => h1.text-right:fresh",
      "p[style-name='Heading 1 Justify'] => h1.text-justify:fresh",
      "p[style-name='Heading 1 Left'] => h1.text-left:fresh",
      "p[style-name='Heading 1'] => h1:fresh",
      "p[style-name='Heading 2 Centered'] => h2.text-center:fresh",
      "p[style-name='Heading 2 Right'] => h2.text-right:fresh",
      "p[style-name='Heading 2 Justify'] => h2.text-justify:fresh",
      "p[style-name='Heading 2 Left'] => h2.text-left:fresh",
      "p[style-name='Heading 2'] => h2:fresh",
      "p[style-name='Heading 3 Centered'] => h3.text-center:fresh",
      "p[style-name='Heading 3 Right'] => h3.text-right:fresh",
      "p[style-name='Heading 3 Justify'] => h3.text-justify:fresh",
      "p[style-name='Heading 3 Left'] => h3.text-left:fresh",
      "p[style-name='Heading 3'] => h3:fresh",
      "table[style-name='LayoutTable'] => table.layout-table:fresh",
      "table[style-name='GridTable'] => table.grid-table:fresh"
    ]
  });
  
  let htmlValue = result.value;

  // Precise Sequential Mapping & Injection of Paragraph & Table Cell Borders directly from Word XML
  if (xmlDoc) {
    try {
      const mainDomParser = new DOMParser();
      const htmlDoc = mainDomParser.parseFromString(htmlValue, "text/html");

      const getElementsByTagNameAny = (parent: any, name: string): Element[] => {
        let elems = parent.getElementsByTagName(`w:${name}`);
        if (elems.length === 0) {
          elems = parent.getElementsByTagName(name);
        }
        if (elems.length === 0 && parent.getElementsByTagNameNS) {
          elems = parent.getElementsByTagNameNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", name);
        }
        return Array.from(elems);
      };

      const getXmlParagraphText = (xmlP: Element): string => {
        const tNodes = getElementsByTagNameAny(xmlP, "t");
        return tNodes.map(t => t.textContent || "").join("").trim().replace(/\s+/g, "");
      };

      const parseColorAttribute = (color: string | null): string => {
        if (!color || color === "auto") return "#111111";
        if (color.startsWith("#")) return color;
        return `#${color}`;
      };

      const getBorderStyle = (wVal: string | null): string => {
        if (!wVal || wVal === "none" || wVal === "nil") return "none";
        wVal = wVal.toLowerCase();
        if (wVal.includes("double") || wVal.includes("triple")) return "double";
        if (wVal.includes("dash")) return "dashed";
        if (wVal.includes("dot")) return "dotted";
        return "solid";
      };

      const mapParagraphBorders = (xmlP: Element, htmlP: HTMLElement) => {
        const pPr = getElementsByTagNameAny(xmlP, "pPr")[0];
        if (pPr) {
          // --- ALIGNMENT MAPPING FROM ORIGINAL FILE ---
          const jc = getElementsByTagNameAny(pPr, "jc")[0];
          if (jc) {
            const val = jc.getAttribute("w:val");
            if (val) {
              if (val === "both" || val === "justify") {
                htmlP.classList.add("text-justify");
                htmlP.style.setProperty("text-align", "justify", "important");
              } else if (val === "center") {
                htmlP.classList.add("text-center");
                htmlP.style.setProperty("text-align", "center", "important");
              } else if (val === "right") {
                htmlP.classList.add("text-right");
                htmlP.style.setProperty("text-align", "right", "important");
              } else if (val === "left") {
                htmlP.classList.add("text-left");
                htmlP.style.setProperty("text-align", "left", "important");
              }
            }
          }

          // --- INDENTATION MAPPING ---
          const ind = getElementsByTagNameAny(pPr, "ind")[0];
          if (ind) {
            const left = ind.getAttribute("w:left");
            const right = ind.getAttribute("w:right");
            const firstLine = ind.getAttribute("w:firstLine");
            if (left) htmlP.style.setProperty("margin-left", `${Math.round(parseFloat(left) / 15)}px`, "important");
            if (right) htmlP.style.setProperty("margin-right", `${Math.round(parseFloat(right) / 15)}px`, "important");
            if (firstLine) htmlP.style.setProperty("text-indent", `${Math.round(parseFloat(firstLine) / 15)}px`, "important");
          }

          // --- SPACING MAPPING ---
          const spacing = getElementsByTagNameAny(pPr, "spacing")[0];
          if (spacing) {
            const before = spacing.getAttribute("w:before");
            const after = spacing.getAttribute("w:after");
            const line = spacing.getAttribute("w:line");
            if (before) htmlP.style.setProperty("margin-top", `${Math.round(parseFloat(before) / 15)}px`, "important");
            if (after) htmlP.style.setProperty("margin-bottom", `${Math.round(parseFloat(after) / 15)}px`, "important");
            if (line) htmlP.style.setProperty("line-height", `${parseFloat(line) / 240}`, "important");
          }

          const pBdr = getElementsByTagNameAny(pPr, "pBdr")[0];
          if (pBdr) {
            const top = getElementsByTagNameAny(pBdr, "top")[0];
            const bottom = getElementsByTagNameAny(pBdr, "bottom")[0];
            const left = getElementsByTagNameAny(pBdr, "left")[0];
            const right = getElementsByTagNameAny(pBdr, "right")[0];

            let borderStyle = "";
            const applyBorder = (node: Element | undefined, side: string, pad: number) => {
              if (node && node.getAttribute("w:val") !== "none" && node.getAttribute("w:val") !== "nil") {
                const sz = node.getAttribute("w:sz") ? parseFloat(node.getAttribute("w:sz") || "4") / 8 : 1;
                const color = parseColorAttribute(node.getAttribute("w:color") || "111111");
                const style = getBorderStyle(node.getAttribute("w:val"));
                borderStyle += `border-${side}: ${Math.max(1, sz)}px ${style} ${color} !important; padding-${side}: ${pad}px; `;
              }
            };
            applyBorder(top, "top", 4);
            applyBorder(bottom, "bottom", 4);
            applyBorder(left, "left", 8);
            applyBorder(right, "right", 8);

            if (borderStyle) {
              htmlP.setAttribute("style", (htmlP.getAttribute("style") || "") + "; " + borderStyle);
            }
          }
        }
      };

      const mapTableBorders = (xmlTbl: Element, htmlTbl: HTMLTableElement) => {
        htmlTbl.style.setProperty("border-collapse", "collapse", "important");
        const xmlRows = getElementsByTagNameAny(xmlTbl, "tr");
        const htmlRows = Array.from(htmlTbl.rows);

        for (let r = 0; r < Math.min(xmlRows.length, htmlRows.length); r++) {
          const xmlRow = xmlRows[r];
          const htmlRow = htmlRows[r];

          const xmlCells = getElementsByTagNameAny(xmlRow, "tc");
          const htmlCells = Array.from(htmlRow.cells);

          for (let c = 0; c < Math.min(xmlCells.length, htmlCells.length); c++) {
            const xmlCell = xmlCells[c];
            const htmlCell = htmlCells[c];

            const tcPr = getElementsByTagNameAny(xmlCell, "tcPr")[0];
            if (tcPr) {
              const tcBorders = getElementsByTagNameAny(tcPr, "tcBorders")[0];
              if (tcBorders) {
                const top = getElementsByTagNameAny(tcBorders, "top")[0];
                const bottom = getElementsByTagNameAny(tcBorders, "bottom")[0];
                const left = getElementsByTagNameAny(tcBorders, "left")[0];
                const right = getElementsByTagNameAny(tcBorders, "right")[0];

                let borderStyle = "";
                const applyTcBorder = (node: Element | undefined, side: string) => {
                  if (node && node.getAttribute("w:val") !== "none" && node.getAttribute("w:val") !== "nil") {
                    const sz = node.getAttribute("w:sz") ? parseFloat(node.getAttribute("w:sz") || "4") / 8 : 1;
                    const color = parseColorAttribute(node.getAttribute("w:color") || "111111");
                    const style = getBorderStyle(node.getAttribute("w:val"));
                    borderStyle += `border-${side}: ${Math.max(1, sz)}px ${style} ${color} !important; `;
                  }
                };
                
                applyTcBorder(top, "top");
                applyTcBorder(bottom, "bottom");
                applyTcBorder(left, "left");
                applyTcBorder(right, "right");

                if (borderStyle) {
                  htmlCell.setAttribute("style", (htmlCell.getAttribute("style") || "") + "; " + borderStyle);
                }
              }
            }
          }
        }
      };

      const xmlList: any[] = [];
      const htmlList: any[] = [];

      const collectXmlNodes = (node: Node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as Element;
          const name = el.localName || el.tagName.replace(/^.*:/, "");
          if (name === "p") {
            xmlList.push({ type: "p", xmlNode: el });
          } else if (name === "tbl") {
            xmlList.push({ type: "tbl", xmlNode: el });
          }
        }
        for (let child = node.firstChild; child; child = child.nextSibling) {
          collectXmlNodes(child);
        }
      };

      const collectHtmlNodes = (node: Node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          const tag = el.tagName.toLowerCase();
          if (["p", "h1", "h2", "h3", "h4", "h5", "h6", "li"].includes(tag)) {
            htmlList.push({ type: "p", htmlNode: el });
          } else if (tag === "table") {
            htmlList.push({ type: "tbl", htmlNode: el });
          }
        }
        for (let child = node.firstChild; child; child = child.nextSibling) {
          collectHtmlNodes(child);
        }
      };

      collectXmlNodes(xmlDoc.documentElement);
      collectHtmlNodes(htmlDoc.body);

      let xmlIdx = 0;
      for (let i = 0; i < htmlList.length; i++) {
        const htmlItem = htmlList[i];
        if (htmlItem.type === "tbl") {
          let foundIndex = -1;
          for (let j = xmlIdx; j < xmlList.length; j++) {
            if (xmlList[j].type === "tbl") {
              foundIndex = j;
              break;
            }
          }
          if (foundIndex !== -1) {
            mapTableBorders(xmlList[foundIndex].xmlNode, htmlItem.htmlNode);
            xmlIdx = foundIndex + 1;
          }
        } else {
          const htmlText = htmlItem.htmlNode.textContent?.trim().replace(/\s+/g, "") || "";
          let foundIndex = -1;
          for (let j = xmlIdx; j < Math.min(xmlList.length, xmlIdx + 20); j++) {
            if (xmlList[j].type === "p") {
              const xmlText = getXmlParagraphText(xmlList[j].xmlNode);
              if (xmlText === htmlText || (htmlText && xmlText.includes(htmlText)) || (xmlText && htmlText.includes(xmlText))) {
                foundIndex = j;
                break;
              }
            }
          }
          if (foundIndex === -1) {
            for (let j = xmlIdx; j < xmlList.length; j++) {
              if (xmlList[j].type === "p") {
                foundIndex = j;
                break;
              }
            }
          }
          if (foundIndex !== -1) {
            mapParagraphBorders(xmlList[foundIndex].xmlNode, htmlItem.htmlNode);
            xmlIdx = foundIndex + 1;
          }
        }
      }

      htmlValue = htmlDoc.body.innerHTML;
    } catch (err) {
      console.warn("Could not match XML and HTML borders sequentially:", err);
    }
  }

  const textResult = await mammoth.extractRawText({ arrayBuffer });
  
  return {
    text: textResult.value,
    html: htmlValue,
    orientation
  };
}

export async function generateDocx(html: string, fileName: string, orientation: "portrait" | "landscape" = "portrait") {
  if (typeof window === "undefined" || !html) return;

  const parser = new DOMParser();
  const docElement = parser.parseFromString(html, "text/html");
  
  // Tổng hợp toàn bộ các node con nằm trong tất cả các trang văn bản (đối tượng có class là .word-render)
  const wordRenders = docElement.querySelectorAll(".word-render");
  let rootChildren: Node[] = [];
  
  if (wordRenders.length > 0) {
    wordRenders.forEach(renderNode => {
      rootChildren.push(...Array.from(renderNode.childNodes));
    });
  } else {
    const contentNode = docElement.querySelector("#word-content") || docElement.body;
    rootChildren = Array.from(contentNode.childNodes);
  }
  
  const docxChildren: any[] = [];
  
  // Helper to parse alignment from styles/classes
  function getAlignment(element: HTMLElement): any {
    const className = element.className || "";
    if (className.includes("text-center")) {
      return AlignmentType.CENTER;
    } else if (className.includes("text-right")) {
      return AlignmentType.RIGHT;
    } else if (className.includes("text-justify")) {
      return AlignmentType.JUSTIFIED;
    } else if (className.includes("text-left")) {
      return AlignmentType.LEFT;
    }
    
    const styleAlign = element.style.textAlign;
    if (styleAlign === "center") return AlignmentType.CENTER;
    if (styleAlign === "right") return AlignmentType.RIGHT;
    if (styleAlign === "justify") return AlignmentType.JUSTIFIED;
    if (styleAlign === "left") return AlignmentType.LEFT;

    // Check ancestor td or th cell elements to support inline cell alignment inheritance
    const parentCell = element.closest("td, th") as HTMLElement | null;
    if (parentCell) {
      const parentClass = parentCell.className || "";
      if (parentClass.includes("text-center")) {
        return AlignmentType.CENTER;
      } else if (parentClass.includes("text-right")) {
        return AlignmentType.RIGHT;
      } else if (parentClass.includes("text-justify")) {
        return AlignmentType.JUSTIFIED;
      } else if (parentClass.includes("text-left")) {
        return AlignmentType.LEFT;
      }
      const parentStyleAlign = parentCell.style.textAlign;
      if (parentStyleAlign === "center") return AlignmentType.CENTER;
      if (parentStyleAlign === "right") return AlignmentType.RIGHT;
      if (parentStyleAlign === "justify") return AlignmentType.JUSTIFIED;
      if (parentStyleAlign === "left") return AlignmentType.LEFT;
    }

    return AlignmentType.LEFT;
  }

  // Helper to convert colors to hex
  function parseColorToHex(colorStr: string): string | undefined {
    if (!colorStr) return undefined;
    const col = colorStr.trim().toLowerCase();
    if (col.startsWith("#")) {
      return col.replace("#", "").toUpperCase();
    }
    if (col.startsWith("rgb")) {
      const match = col.match(/\d+/g);
      if (match && match.length >= 3) {
        const r = parseInt(match[0], 10).toString(16).padStart(2, "0");
        const g = parseInt(match[1], 10).toString(16).padStart(2, "0");
        const b = parseInt(match[2], 10).toString(16).padStart(2, "0");
        return `${r}${g}${b}`.toUpperCase();
      }
    }
    return undefined;
  }

  // Helper to parse HTML inlined borders style attribute
  function getBorderStyleEnum(styleString: string) {
    if (styleString.includes("double") || styleString.includes("triple")) return BorderStyle.DOUBLE;
    if (styleString.includes("dashed")) return BorderStyle.DASHED;
    if (styleString.includes("dotted")) return BorderStyle.DOTTED;
    return BorderStyle.SINGLE;
  }

  function parseHtmlBorders(styleStr: string): any {
    if (!styleStr) return undefined;
    const borders: any = {};
    
    if (styleStr.toLowerCase().includes("border-top")) {
      const match = styleStr.match(/border-top\s*:\s*([^;!]+)/i);
      if (match && !match[1].includes("none")) {
        const parts = match[1].trim().split(/\s+/);
        const szVal = parts.find(p => p.includes("px") || p.includes("pt")) || "1px";
        const px = parseFloat(szVal);
        borders.top = {
          style: getBorderStyleEnum(match[1]),
          size: isNaN(px) ? 4 : Math.round(px * 8),
          color: parseColorToHex(parts.find(p => p.startsWith("#") || p.startsWith("rgb")) || "111111") || "111111",
          space: 1,
        };
      }
    }
    if (styleStr.toLowerCase().includes("border-bottom")) {
      const match = styleStr.match(/border-bottom\s*:\s*([^;!]+)/i);
      if (match && !match[1].includes("none")) {
        const parts = match[1].trim().split(/\s+/);
        const szVal = parts.find(p => p.includes("px") || p.includes("pt")) || "1px";
        const px = parseFloat(szVal);
        borders.bottom = {
          style: getBorderStyleEnum(match[1]),
          size: isNaN(px) ? 4 : Math.round(px * 8),
          color: parseColorToHex(parts.find(p => p.startsWith("#") || p.startsWith("rgb")) || "111111") || "111111",
          space: 1,
        };
      }
    }
    if (styleStr.toLowerCase().includes("border-left")) {
      const match = styleStr.match(/border-left\s*:\s*([^;!]+)/i);
      if (match && !match[1].includes("none")) {
        const parts = match[1].trim().split(/\s+/);
        const szVal = parts.find(p => p.includes("px") || p.includes("pt")) || "1px";
        const px = parseFloat(szVal);
        borders.left = {
          style: getBorderStyleEnum(match[1]),
          size: isNaN(px) ? 4 : Math.round(px * 8),
          color: parseColorToHex(parts.find(p => p.startsWith("#") || p.startsWith("rgb")) || "111111") || "111111",
          space: 1,
        };
      }
    }
    if (styleStr.toLowerCase().includes("border-right")) {
      const match = styleStr.match(/border-right\s*:\s*([^;!]+)/i);
      if (match && !match[1].includes("none")) {
        const parts = match[1].trim().split(/\s+/);
        const szVal = parts.find(p => p.includes("px") || p.includes("pt")) || "1px";
        const px = parseFloat(szVal);
        borders.right = {
          style: getBorderStyleEnum(match[1]),
          size: isNaN(px) ? 4 : Math.round(px * 8),
          color: parseColorToHex(parts.find(p => p.startsWith("#") || p.startsWith("rgb")) || "111111") || "111111",
          space: 1,
        };
      }
    }
    return Object.keys(borders).length > 0 ? borders : undefined;
  }

  function parseHtmlSpacing(styleStr: string): any {
    if (!styleStr) return { line: 396, lineRule: "auto", before: 0, after: 120 };
    const spacing: any = {};
    const marginMatchTop = styleStr.match(/margin-top\s*:\s*([^;!]+)/i);
    const marginMatchBottom = styleStr.match(/margin-bottom\s*:\s*([^;!]+)/i);
    const lineMatch = styleStr.match(/line-height\s*:\s*([^;!]+)/i);

    if (marginMatchTop) {
      const px = parseFloat(marginMatchTop[1]);
      if (!isNaN(px)) spacing.before = Math.round(px * 15);
    }
    if (marginMatchBottom) {
      const px = parseFloat(marginMatchBottom[1]);
      if (!isNaN(px)) spacing.after = Math.round(px * 15);
    }
    if (lineMatch) {
      const ln = parseFloat(lineMatch[1]);
      if (!isNaN(ln)) {
        spacing.line = Math.round(ln * 240);
        spacing.lineRule = "auto";
      }
    }
    
    if (Object.keys(spacing).length === 0) {
      return { line: 396, lineRule: "auto", before: 0, after: 120 };
    }
    return spacing;
  }

  function parseHtmlIndent(styleStr: string): any {
    if (!styleStr) return undefined;
    const indent: any = {};
    const marginLeftMatch = styleStr.match(/margin-left\s*:\s*([^;!]+)/i);
    const marginRightMatch = styleStr.match(/margin-right\s*:\s*([^;!]+)/i);
    const textIndentMatch = styleStr.match(/text-indent\s*:\s*([^;!]+)/i);

    if (marginLeftMatch) {
      const px = parseFloat(marginLeftMatch[1]);
      if (!isNaN(px)) indent.left = Math.round(px * 15);
    }
    if (marginRightMatch) {
      const px = parseFloat(marginRightMatch[1]);
      if (!isNaN(px)) indent.right = Math.round(px * 15);
    }
    if (textIndentMatch) {
      const px = parseFloat(textIndentMatch[1]);
      if (!isNaN(px)) indent.firstLine = Math.round(px * 15);
    }
    
    return Object.keys(indent).length > 0 ? indent : undefined;
  }

  interface StyleState {
    bold?: boolean;
    italics?: boolean;
    underline?: boolean;
    strike?: boolean;
    color?: string;
    highlight?: string;
  }

  // Recursive inline processor
  function processInlineNode(node: Node, style: StyleState, runs: TextRun[], fontSize?: number) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      if (text) {
        runs.push(new TextRun({
          text: text,
          bold: style.bold,
          italics: style.italics,
          underline: style.underline ? {} : undefined,
          strike: style.strike,
          color: style.color,
          highlight: style.highlight as any,
          font: "Times New Roman",
          size: fontSize || 28, // 14.5pt is approx size 29, but let's use standard default size 28 (14pt)
        }));
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tagName = el.tagName.toLowerCase();
      const localStyle: StyleState = { ...style };
      
      if (tagName === "b" || tagName === "strong") {
        localStyle.bold = true;
      } else if (tagName === "i" || tagName === "em") {
        localStyle.italics = true;
      } else if (tagName === "u" || tagName === "ins") {
        localStyle.underline = true;
      } else if (tagName === "s" || tagName === "strike" || tagName === "del") {
        localStyle.strike = true;
      }
      
      const classList = el.className || "";
      if (classList.includes("solid-horizontal-line-inline")) {
        const widthStyle = el.style.width || "";
        const chMatch = widthStyle.match(/([\d.]+)ch/);
        const nakedLen = chMatch ? Math.round(parseFloat(chMatch[1]) / 1.15) : 12;
        runs.push(new TextRun({
          text: "_".repeat(Math.max(3, nakedLen)),
          bold: true,
          font: "Times New Roman",
          size: fontSize || 28,
        }));
        return;
      }
      if (classList.includes("bg-red-50") || classList.includes("text-brand-accent") || classList.includes("border-dashed")) {
        localStyle.color = "DC2626"; // Màu đỏ cho lỗi phát hiện
        localStyle.bold = true;
        localStyle.underline = true;
      } else if (classList.includes("bg-green-50") || classList.includes("corrected-term") || classList.includes("text-emerald-600")) {
        localStyle.color = "16A34A"; // Màu xanh cho lỗi đã sửa
        localStyle.bold = true;
      } else if (classList.includes("bg-yellow-100")) {
        localStyle.highlight = "yellow";
      }
      
      if (el.style.color) {
        const hex = parseColorToHex(el.style.color);
        if (hex) localStyle.color = hex;
      }
      
      if (tagName === "br") {
        runs.push(new TextRun({ text: "", break: 1 }));
      } else {
        const childNodes = Array.from(el.childNodes);
        for (const child of childNodes) {
          processInlineNode(child, localStyle, runs, fontSize);
        }
      }
    }
  }

  // Paragraph parser
  function parseParagraph(element: HTMLElement): Paragraph | null {
    const runs: TextRun[] = [];
    const tagName = element.tagName.toLowerCase();
    
    let defaultSize = 28; // 14pt (size in half-points is 28)
    if (tagName === "h1") defaultSize = 38; // 19pt
    else if (tagName === "h2") defaultSize = 34; // 17pt
    else if (tagName === "h3") defaultSize = 31; // 15.5pt
    
    for (const child of Array.from(element.childNodes)) {
      processInlineNode(child, {}, runs, defaultSize);
    }
    
    if (runs.length === 0) {
      runs.push(new TextRun(""));
    }

    const alignment = getAlignment(element);
    
    const styleAttr = element.getAttribute("style") || "";
    const pBorders = parseHtmlBorders(styleAttr);
    const pSpacing = parseHtmlSpacing(styleAttr);
    let pIndent = parseHtmlIndent(styleAttr);

    // Thụt lề đầu dòng (first-line indent) 1.25cm tương đương 720 dxa trong Word
    // Áp dụng nếu KHÔNG có indent xác định bằng CSS inline
    if (!pIndent && tagName === "p" && 
                    !element.className.includes("text-center") && 
                    !element.className.includes("text-right") && 
                    !element.className.includes("text-left") &&
                    !element.closest("table") && 
                    !element.closest("li")) {
      pIndent = { firstLine: 720 };
    }

    return new Paragraph({
      children: runs,
      alignment: alignment,
      indent: pIndent,
      border: pBorders,
      spacing: pSpacing
    });
  }

  // List parser (ul, ol)
  function parseList(listElement: HTMLElement): Paragraph[] {
    const paragraphs: Paragraph[] = [];
    const items = Array.from(listElement.querySelectorAll("li"));
    const tagName = listElement.tagName.toLowerCase();
    
    let index = 1;
    for (const item of items) {
      const runs: TextRun[] = [];
      const prefix = tagName === "ul" ? "•  " : `${index}.  `;
      
      runs.push(new TextRun({
        text: prefix,
        bold: true,
        font: "Times New Roman",
        size: 28,
      }));
      
      for (const child of Array.from(item.childNodes)) {
        processInlineNode(child, {}, runs);
      }
      
      paragraphs.push(new Paragraph({
        children: runs,
        alignment: AlignmentType.LEFT,
        spacing: {
          after: 100,
          line: 396,
          lineRule: "auto",
        }
      }));
      index++;
    }
    return paragraphs;
  }

  // Table parser
  function parseTable(tableElement: HTMLElement): Table | null {
    const isLayout = tableElement.className.includes("layout-table") || tableElement.getAttribute("style-name") === "LayoutTable";
    
    const borders = isLayout ? {
      top: { style: BorderStyle.NONE, size: 0, color: "auto" },
      bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
      left: { style: BorderStyle.NONE, size: 0, color: "auto" },
      right: { style: BorderStyle.NONE, size: 0, color: "auto" },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "auto" },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: "auto" },
    } : {
      top: { style: BorderStyle.SINGLE, size: 12, color: "111111" },
      bottom: { style: BorderStyle.SINGLE, size: 12, color: "111111" },
      left: { style: BorderStyle.SINGLE, size: 12, color: "111111" },
      right: { style: BorderStyle.SINGLE, size: 12, color: "111111" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 6, color: "222222" },
      insideVertical: { style: BorderStyle.SINGLE, size: 6, color: "222222" },
    };
    
    const rows: TableRow[] = [];
    const trElements = Array.from(tableElement.querySelectorAll("tr"));
    
    for (const trEl of trElements) {
      const cells: TableCell[] = [];
      const tdElements = Array.from(trEl.childNodes).filter(node => node.nodeName.toLowerCase() === "td" || node.nodeName.toLowerCase() === "th") as HTMLElement[];
      
      for (const tdEl of tdElements) {
        const cellParagraphs: Paragraph[] = [];
        const childNodes = Array.from(tdEl.childNodes);
        let pendingRuns: TextRun[] = [];
        
        for (const node of childNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent;
            if (text) {
              pendingRuns.push(new TextRun({ text, font: "Times New Roman", size: 27 }));
            }
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;
            const subTagName = el.tagName.toLowerCase();
            
            if (subTagName === "p") {
              if (pendingRuns.length > 0) {
                cellParagraphs.push(new Paragraph({
                  children: pendingRuns,
                  alignment: getAlignment(tdEl),
                  spacing: { line: 360, after: 0 },
                }));
                pendingRuns = [];
              }
              const pParsed = parseParagraph(el);
              if (pParsed) cellParagraphs.push(pParsed);
            } else {
              const subRuns: TextRun[] = [];
              processInlineNode(el, {}, subRuns);
              pendingRuns.push(...subRuns);
            }
          }
        }
        
        if (pendingRuns.length > 0 || cellParagraphs.length === 0) {
          cellParagraphs.push(new Paragraph({
            children: pendingRuns.length > 0 ? pendingRuns : [new TextRun("")],
            alignment: getAlignment(tdEl),
            spacing: { line: 360, after: 0, before: 0 },
          }));
        }
        
        // Calculate cell widths (percentage or direct dxa value mapping)
        let cellWidth = undefined;
        const widthAttr = tdEl.getAttribute("width") || tdEl.style.width;
        if (widthAttr) {
          const numeric = parseInt(widthAttr, 10);
          if (!isNaN(numeric)) {
            cellWidth = {
              size: widthAttr.includes("%") ? numeric : numeric * 15, // Simple dxa mapping
              type: widthAttr.includes("%") ? WidthType.PERCENTAGE : WidthType.DXA,
            };
          }
        }
        
        const tdStyleAttr = tdEl.getAttribute("style") || "";
        const tcBorders = parseHtmlBorders(tdStyleAttr);

        cells.push(new TableCell({
          children: cellParagraphs,
          verticalAlign: "center",
          width: cellWidth,
          borders: tcBorders,
        }));
      }
      
      if (cells.length > 0) {
        rows.push(new TableRow({ children: cells }));
      }
    }
    
    if (rows.length === 0) return null;
    
    return new Table({
      rows: rows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: borders,
    });
  }

  // Parse direct structural nodes
  for (const node of rootChildren) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || "";
      if (text.trim() !== "") {
        docxChildren.push(new Paragraph({
          children: [new TextRun({ text, font: "Times New Roman", size: 28 })],
          alignment: AlignmentType.LEFT,
        }));
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const tagName = el.tagName.toLowerCase();
      
      if (tagName === "p" || tagName === "h1" || tagName === "h2" || tagName === "h3" || tagName === "h4" || tagName === "h5" || tagName === "h6") {
        const paragraph = parseParagraph(el);
        if (paragraph) docxChildren.push(paragraph);
      } else if (tagName === "table") {
        const table = parseTable(el);
        if (table) docxChildren.push(table);
      } else if (tagName === "ul" || tagName === "ol") {
        const pList = parseList(el);
        docxChildren.push(...pList);
      } else if (tagName === "hr") {
        // Line separator helper
        docxChildren.push(new Paragraph({
          children: [new TextRun({ text: "____________________________________________________", font: "Times New Roman", color: "222222" })],
          alignment: AlignmentType.CENTER,
        }));
      }
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              orientation: orientation === "landscape" ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
              width: orientation === "landscape" ? 16838 : 11906, // A4 dimensions in twentieths of a point (dxa)
              height: orientation === "landscape" ? 11906 : 16838,
            },
            margin: {
              top: 1134,    // 2cm = 1134 dxa
              bottom: 1134, // 2cm = 1134 dxa
              left: 1701,   // 3cm = 1701 dxa
              right: 1134,  // 2cm = 1134 dxa
            },
          },
        },
        children: docxChildren,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, fileName || "van-ban-da-suat.docx");
}
