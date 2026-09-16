/**
 * The MIME type of a picked file, with the extension as the fallback.
 * Chrome (Windows and iPhone) often hands a HEIC over with an EMPTY
 * `File.type`; the server converts HEIC itself, it only needs to be told.
 */
export function inferFileMime(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const byExt: Record<string, string> = {
    heic: "image/heic",
    heif: "image/heif",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    pdf: "application/pdf",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
  };
  return byExt[ext] ?? "";
}
