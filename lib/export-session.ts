import type { MeetingSession } from "@/lib/types";

function escapePdfText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapText(value: string, maxLength = 88) {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;

    if (nextLine.length > maxLength && currentLine) {
      lines.push(currentLine);
      currentLine = word;
      continue;
    }

    currentLine = nextLine;
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length ? lines : [""];
}

function buildSummaryText(session: MeetingSession) {
  const title = session.title || "Untitled meeting";
  const summary = session.summary;
  const sections = [
    `Meeting Title: ${title}`,
    `Created: ${new Date(session.createdAt).toLocaleString("en-IN")}`,
    `Meet URL: ${session.meetUrl}`,
    "",
    "Overview",
    summary?.overview ?? "No summary available yet.",
    "",
    "Key Points",
    ...(summary?.keyPoints.length ? summary.keyPoints.map((item) => `- ${item}`) : ["- None"]),
    "",
    "Action Items",
    ...(summary?.actionItems.length
      ? summary.actionItems.map((item) => `- ${item}`)
      : ["- None"]),
    "",
    "Decisions",
    ...(summary?.decisions.length ? summary.decisions.map((item) => `- ${item}`) : ["- None"]),
    "",
    "Manual Notes",
    session.notes.trim() || "No notes added.",
  ];

  return sections.join("\n");
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function exportSessionAsText(session: MeetingSession) {
  const blob = new Blob([buildSummaryText(session)], {
    type: "text/plain;charset=utf-8",
  });

  downloadBlob(blob, `${session.title || "meeting-summary"}.txt`);
}

export function exportSessionAsPdf(session: MeetingSession) {
  const lines = buildSummaryText(session)
    .split("\n")
    .flatMap((line) => (line ? wrapText(line) : [""]));

  const pageHeight = 792;
  const startY = 760;
  const lineHeight = 16;
  const pages: string[][] = [[]];
  let currentY = startY;
  let pageIndex = 0;

  for (const line of lines) {
    if (currentY < 48) {
      pages.push([]);
      pageIndex += 1;
      currentY = startY;
    }

    pages[pageIndex].push(
      `BT /F1 12 Tf 50 ${currentY} Td (${escapePdfText(line)}) Tj ET`,
    );
    currentY -= lineHeight;
  }

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  const pageObjectNumbers = pages.map((_, index) => 4 + index * 2);
  const contentObjectNumbers = pages.map((_, index) => 5 + index * 2);

  const orderedObjects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    `2 0 obj << /Type /Pages /Count ${pageObjectNumbers.length} /Kids [${pageObjectNumbers
      .map((number) => `${number} 0 R`)
      .join(" ")}] >> endobj\n`,
    "3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
  ];

  pages.forEach((pageContent, index) => {
    const pageObjectNumber = pageObjectNumbers[index];
    const contentObjectNumber = contentObjectNumbers[index];
    const contentStream = `${pageContent.join("\n")}\n`;

    orderedObjects.push(
      `${pageObjectNumber} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 ${pageHeight}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectNumber} 0 R >> endobj\n`,
    );
    orderedObjects.push(
      `${contentObjectNumber} 0 obj << /Length ${contentStream.length} >> stream\n${contentStream}endstream\nendobj\n`,
    );
  });

  for (const object of orderedObjects) {
    offsets.push(pdf.length);
    pdf += object;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${orderedObjects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";

  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }

  pdf += `trailer << /Size ${orderedObjects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  const blob = new Blob([pdf], { type: "application/pdf" });
  downloadBlob(blob, `${session.title || "meeting-summary"}.pdf`);
}
