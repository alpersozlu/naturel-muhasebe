import "server-only";
import JSZip from "jszip";

/**
 * Where an .xlsx came from, read from its own document properties.
 *
 * A file exported by SAP carries Application "SAP UI5" and is last modified
 * by "SAP UI5". Opening it in Excel and saving it — the only practical way to
 * change a figure or a salesperson in it — rewrites both. Measured on the 66
 * bayi gün sonu exports on file (October 2026): 63 untouched, 3 re-saved in
 * Excel by the owner himself.
 *
 * This is a hint, not proof: a careful forger can edit the XML. It is one of
 * several independent checks, never the only one.
 */
export type XlsxOrigin = {
  application: string | null;
  creator: string | null;
  last_modified_by: string | null;
  created: string | null;
  modified: string | null;
};

export async function xlsxOrigin(buf: Buffer): Promise<XlsxOrigin> {
  const meta: XlsxOrigin = { application: null, creator: null, last_modified_by: null, created: null, modified: null };
  try {
    const zip = await JSZip.loadAsync(buf);
    const app = await zip.file("docProps/app.xml")?.async("string");
    const core = await zip.file("docProps/core.xml")?.async("string");
    const tag = (xml: string | undefined, name: string) => xml?.match(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`))?.[1] ?? null;
    meta.application = tag(app, "Application");
    meta.creator = tag(core, "dc:creator");
    meta.last_modified_by = tag(core, "cp:lastModifiedBy");
    meta.created = tag(core, "dcterms:created");
    meta.modified = tag(core, "dcterms:modified");
  } catch {
    /* no readable properties — the caller treats that as "unknown" */
  }
  return meta;
}

/** true = SAP's own export · false = re-saved in another program · null = unknown */
export function isSapOriginal(o: XlsxOrigin): boolean | null {
  if (o.application == null) return null;
  return o.application === "SAP UI5" && (o.last_modified_by ?? "SAP UI5") === "SAP UI5";
}
