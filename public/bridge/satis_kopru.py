#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
satis_kopru.py - Derimod NEBIM V3 -> Naturel muhasebe (docuflow) perakende satis koprusu.

NEBIM SQL Server'in bulundugu Windows makinesinde calisir (localhost, Windows auth).
Her calismada:
  1. Derimod_V3 veritabanina baglanir (sadece SELECT / salt-okunur),
  2. son N gunun PERAKENDE satis satirlarini ceker (ProcessCode='R'),
  3. JSON olarak {webapp_url}/api/ingest/retail-sales adresine Bearer token ile gonderir.

Eski C:\\DerimodBridge koprusune DOKUNMAZ. Sadece satis; stok yok.

Gereksinimler: pyodbc, requests   (Python 3.9+)
Kurulum:  py -m pip install pyodbc requests

Kullanim:
  python satis_kopru.py                 normal calisma: cek -> gonder
  python satis_kopru.py --dry-run       sadece cek, ozet + magaza kodlarini yaz; GONDERME
  python satis_kopru.py --probe-stores  sadece NEBIM'deki magaza kodlarini + sayilari yaz
                                        (store_map dogru mu kontrol etmek icin)

Cikis kodu: basarili 0, herhangi bir hata 1 (Gorev Zamanlayici kirmizi gostersin diye).
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime, timedelta

try:
    import requests
except Exception as exc:  # pragma: no cover
    print(f"HATA: 'requests' kurulu degil ({exc}). Calistir: py -m pip install requests",
          file=sys.stderr)
    raise

HERE = os.path.dirname(os.path.abspath(__file__))

DEFAULT_CONFIG = {
    "webapp_url": "https://naturel-muhasebe-7emg.vercel.app",
    "ingest_token": "",
    "sql_server": "localhost",
    "database": "Derimod_V3",
    "odbc_driver": None,          # null => otomatik (18 -> 17 -> "SQL Server")
    "trusted_connection": True,   # Windows hesabiyla baglan (sifre gerekmez)
    "company_code": 1,
    "currency": "TRY",
    "sales_lookback_days": 3,     # her calismada son N gunu yeniden gonderir (idempotent)
    "store_map": {                # NEBIM magaza kodu -> gorunen ad (--dry-run ile dogrula!)
        "S01": "Lefkosa Magaza",
        "S02": "Magusa Magaza",
        "S03": "Girne Magaza",
    },
    "request_timeout_seconds": 120,
    "max_retries": 3,
    "post_chunk_size": 2000,
    "log_file": "satis_kopru.log",
}

LOG = logging.getLogger("satis_kopru")


# ────────────────────────────────────────────────────────────────────────────
# CONFIG + LOGGING
# ────────────────────────────────────────────────────────────────────────────

def load_config(path: str | None = None) -> dict:
    cfg = dict(DEFAULT_CONFIG)
    cfg_path = path or os.path.join(HERE, "config.json")
    if os.path.exists(cfg_path):
        with open(cfg_path, "r", encoding="utf-8-sig") as fh:
            user = json.load(fh)
        for k, v in user.items():
            cfg[k] = v
    cfg["_config_path"] = cfg_path
    return cfg


class _SafeStreamHandler(logging.StreamHandler):
    """Windows konsolu (cp1254) Turkce karakterde patlamasin diye guvenli yazar."""
    def emit(self, record):
        try:
            msg = self.format(record)
            enc = getattr(self.stream, "encoding", None) or "utf-8"
            safe = msg.encode(enc, errors="replace").decode(enc, errors="replace")
            self.stream.write(safe + self.terminator)
            self.flush()
        except Exception:
            self.handleError(record)


def setup_logging(log_file_path: str) -> None:
    LOG.setLevel(logging.DEBUG)
    for h in list(LOG.handlers):
        LOG.removeHandler(h)
    fmt = logging.Formatter("%(asctime)s  %(levelname)-7s %(message)s",
                            datefmt="%Y-%m-%d %H:%M:%S")
    try:
        fh = logging.FileHandler(log_file_path, mode="a", encoding="utf-8")
        fh.setFormatter(fmt)
        LOG.addHandler(fh)
    except Exception as exc:  # pragma: no cover
        print(f"UYARI: log dosyasi acilamadi {log_file_path}: {exc}", file=sys.stderr)
    ch = _SafeStreamHandler(stream=sys.stdout)
    ch.setFormatter(fmt)
    LOG.addHandler(ch)


# ────────────────────────────────────────────────────────────────────────────
# SQL CONNECTION
# ────────────────────────────────────────────────────────────────────────────

def _candidate_drivers(cfg: dict) -> list[tuple[str, bool]]:
    explicit = (cfg.get("odbc_driver") or "").strip()
    if explicit:
        return [(explicit, "18" in explicit)]
    return [
        ("ODBC Driver 18 for SQL Server", True),
        ("ODBC Driver 17 for SQL Server", False),
        ("SQL Server", False),
    ]


def connect(cfg: dict):
    import pyodbc
    server = cfg.get("sql_server", "localhost")
    database = cfg.get("database", "Derimod_V3")
    trusted = bool(cfg.get("trusted_connection", True))

    available = set()
    try:
        available = set(pyodbc.drivers())
        LOG.debug("Mevcut ODBC surucu: %s", sorted(available))
    except Exception as exc:
        LOG.warning("ODBC suruculer listelenemedi: %s", exc)

    last_err = None
    for driver, needs_trust in _candidate_drivers(cfg):
        if available and driver not in available:
            continue
        parts = [f"DRIVER={{{driver}}}", f"SERVER={server}", f"DATABASE={database}"]
        if trusted:
            parts.append("Trusted_Connection=yes")
        if needs_trust:
            parts.append("TrustServerCertificate=yes")
        conn_str = ";".join(parts) + ";"
        try:
            LOG.info("Baglaniliyor: surucu '%s' -> %s/%s", driver, server, database)
            conn = pyodbc.connect(conn_str, timeout=15)
            LOG.info("Baglandi (surucu=%s).", driver)
            return conn
        except Exception as exc:
            last_err = exc
            LOG.warning("Surucu '%s' basarisiz: %s", driver, exc)
    raise RuntimeError(
        f"SQL Server'a baglanilamadi ({server}/{database}). Son hata: {last_err}. "
        f"'ODBC Driver 17 for SQL Server' kurulu mu kontrol et veya config.json'da "
        f"'odbc_driver' belirt.")


# ────────────────────────────────────────────────────────────────────────────
# SALES QUERY  (sadece perakende; renk aciklamasi join'i guvenli fallback'li)
# ────────────────────────────────────────────────────────────────────────────

_LINE_DISC = "+".join(f"c.LDiscountVI{i}" for i in (1, 2, 3, 4, 5))
_DOC_DISC = "+".join(f"c.TDiscountVI{i}" for i in (1, 2, 3, 4, 5))

_SALES_SQL = """
SELECT
    h.InvoiceNumber        AS invoice_ref,
    h.InvoiceDate          AS invoice_date,
    h.CreatedDate          AS created_date,
    h.IsReturn             AS is_return,
    h.OfficeCode           AS office,
    h.StoreCode            AS store_code,
    l.SortOrder            AS sort_order,
    l.ItemCode             AS item_code,
    id.ItemDescription     AS item_desc,
    l.ColorCode            AS color_code,
    {color_select}
    l.ItemDim1Code         AS size,
    l.SalespersonCode      AS salesperson_code,
    sp.FirstLastName       AS salesperson_name,
    h.CurrAccCode          AS customer_code,
    ca.FirstLastName       AS customer_name,
    h.Description           AS invoice_note,
    drd.DiscountReasonDescription AS discount_reason,
    STUFF((SELECT DISTINCT ' | ' + COALESCE(od.DiscountOfferDescription,
                                            CAST(o.DiscountOfferCode AS varchar(40)))
           FROM tpInvoiceDiscountOffer o
           LEFT JOIN cdDiscountOfferDesc od ON od.DiscountOfferCode = o.DiscountOfferCode
                AND od.LangCode = 'TR'
           WHERE o.InvoiceHeaderID = h.InvoiceHeaderID
             AND (o.InvoiceLineID = l.InvoiceLineID OR o.InvoiceLineID IS NULL)
           FOR XML PATH('')), 1, 3, '')               AS campaign,
    l.Qty1                 AS qty,
    c.PriceVI              AS price,
    l.VatRate              AS vat_rate,
    c.AmountVI             AS amount_vi,
    ({line_disc})          AS line_disc,
    ({doc_disc})           AS doc_disc,
    c.TaxBase              AS tax_base,
    c.Vat                  AS vat,
    c.NetAmount            AS net_amount,
    STUFF((SELECT DISTINCT ',' + CAST(pl.PaymentTypeCode AS varchar(3))
           FROM trPaymentHeader ph
           JOIN trPaymentLine pl ON pl.PaymentHeaderID = ph.PaymentHeaderID
           WHERE ph.DocumentNumber = h.InvoiceNumber AND ph.CompanyCode = h.CompanyCode
           FOR XML PATH('')), 1, 1, '')                AS payment_type_codes,
    STUFF((SELECT DISTINCT ', ' + ccd.CreditCardTypeDescription
           FROM trPaymentHeader ph
           JOIN trPaymentLine pl ON pl.PaymentHeaderID = ph.PaymentHeaderID
           JOIN trCreditCardPaymentLine ccl ON ccl.CreditCardPaymentLineID = pl.CreditCardPaymentLineID
           LEFT JOIN cdCreditCardTypeDesc ccd ON ccd.CreditCardTypeCode = ccl.CreditCardTypeCode AND ccd.LangCode = 'TR'
           WHERE ph.DocumentNumber = h.InvoiceNumber AND ph.CompanyCode = h.CompanyCode
           FOR XML PATH('')), 1, 2, '')                AS credit_card_types
FROM trInvoiceHeader h
JOIN trInvoiceLine l
    ON  l.InvoiceHeaderID = h.InvoiceHeaderID
JOIN trInvoiceLineCurrency c
    ON  c.InvoiceLineID  = l.InvoiceLineID
    AND c.CurrencyCode   = h.LocalCurrencyCode
LEFT JOIN cdItemDesc id
    ON  id.ItemTypeCode = l.ItemTypeCode
    AND id.ItemCode     = l.ItemCode
    AND id.LangCode     = 'TR'
LEFT JOIN cdSalesperson sp
    ON  sp.SalespersonCode = l.SalespersonCode
LEFT JOIN cdCurrAcc ca
    ON  ca.CurrAccCode = h.CurrAccCode
LEFT JOIN cdDiscountReasonDesc drd
    ON  drd.DiscountReasonCode = h.DiscountReasonCode
    AND drd.LangCode = 'TR'
{color_join}
WHERE h.ProcessCode = 'R'
    AND h.CompanyCode = ?
    AND h.InvoiceDate >= ?
ORDER BY h.InvoiceDate, h.InvoiceNumber, l.SortOrder
"""

_COLOR_SELECT = "cd.ColorDescription   AS color_desc,"
_COLOR_JOIN = ("LEFT JOIN cdColorDesc cd\n"
               "    ON  cd.ColorCode = l.ColorCode\n"
               "    AND cd.LangCode  = 'TR'")


def _rows_to_dicts(cursor) -> list[dict]:
    cols = [d[0] for d in cursor.description]
    return [{col: row[i] for i, col in enumerate(cols)} for row in cursor.fetchall()]


def _invalid_object(exc: Exception) -> bool:
    m = str(exc).lower()
    return ("invalid object name" in m or "invalid column name" in m
            or "207" in m or "208" in m)


def fetch_sales(conn, cfg: dict, since_override=None) -> list[dict]:
    lookback = int(cfg.get("sales_lookback_days", 3))
    company = cfg.get("company_code", 1)
    since = since_override or (datetime.now() - timedelta(days=lookback)).date()
    LOG.info("Satis sorgusu: ProcessCode='R', CompanyCode=%s, InvoiceDate >= %s",
             company, since)

    sql = _SALES_SQL.format(color_select=_COLOR_SELECT, color_join=_COLOR_JOIN,
                            line_disc=_LINE_DISC, doc_disc=_DOC_DISC)
    try:
        cur = conn.cursor()
        cur.execute(sql, company, since)
        rows = _rows_to_dicts(cur)
        LOG.info("Satis sorgusu OK (renk join'li): %d satir.", len(rows))
        return rows
    except Exception as exc:
        if not _invalid_object(exc):
            raise
        LOG.warning("Renk join basarisiz (%s). Renksiz sorguya geciliyor.", exc)

    sql = _SALES_SQL.format(color_select="", color_join="",
                            line_disc=_LINE_DISC, doc_disc=_DOC_DISC)
    cur = conn.cursor()
    cur.execute(sql, company, since)
    rows = _rows_to_dicts(cur)
    LOG.info("Satis sorgusu OK (renksiz): %d satir.", len(rows))
    return rows


# ────────────────────────────────────────────────────────────────────────────
# ROW -> JSON
# ────────────────────────────────────────────────────────────────────────────

def _num(v):
    from decimal import Decimal
    if isinstance(v, Decimal):
        return float(v)
    return v


def _date_str(v):
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date().isoformat()
    return str(v)[:10]


def _dt_str(v):
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.isoformat()
    return str(v)


# Ödeme tipi kodu -> okunur etiket (bsPaymentType: 1=Nakit, 2=Kredi Karti, ...)
_PAYMENT_KOD = {
    "1": "Nakit", "2": "Kredi Kartı", "3": "Hediye Kartı", "4": "Havale/EFT",
    "5": "İade", "6": "Nakit Fazlası", "7": "Puan", "8": "Personel Borç",
}


def _payment_label(codes) -> str | None:
    """'1' / '2' / '1,2' kod listesini 'Nakit' / 'Kredi Kartı' / 'Nakit + Kredi Kartı' yapar."""
    if codes in (None, ""):
        return None
    seen: list[str] = []
    for c in str(codes).split(","):
        c = c.strip()
        if not c:
            continue
        label = _PAYMENT_KOD.get(c, c)
        if label not in seen:
            seen.append(label)
    return " + ".join(seen) if seen else None


def build_lines(rows: list[dict], cfg: dict) -> list[dict]:
    store_map = cfg.get("store_map", {})
    out = []
    for r in rows:
        code = r.get("store_code")
        code_key = "" if code is None else str(code).strip()
        out.append({
            "invoice_ref": str(r.get("invoice_ref")),
            "sort_order": int(r.get("sort_order") or 0),
            "store_code": code_key or None,
            "store_name": store_map.get(code_key) or code_key or None,
            "invoice_date": _date_str(r.get("invoice_date")),
            "created_date": _dt_str(r.get("created_date")),
            "is_return": bool(r.get("is_return")),
            "office": (str(r["office"]).strip() if r.get("office") is not None else None),
            "item_code": r.get("item_code"),
            "item_desc": r.get("item_desc"),
            "color_code": r.get("color_code"),
            "color_desc": r.get("color_desc"),
            "size": (str(r["size"]) if r.get("size") is not None else None),
            "salesperson_code": (str(r["salesperson_code"]) if r.get("salesperson_code") is not None else None),
            "salesperson_name": r.get("salesperson_name"),
            "customer_code": (str(r["customer_code"]).strip() if r.get("customer_code") is not None else None),
            "customer_name": (str(r["customer_name"]).strip() if r.get("customer_name") not in (None, "") else None),
            "invoice_note": (str(r["invoice_note"]).strip() if r.get("invoice_note") not in (None, "") and str(r["invoice_note"]).strip() else None),
            "discount_reason": (str(r["discount_reason"]).strip() if r.get("discount_reason") not in (None, "") else None),
            "campaign": (str(r["campaign"]).strip() if r.get("campaign") not in (None, "") else None),
            "payment_type": _payment_label(r.get("payment_type_codes")),
            "card_type": (str(r["credit_card_types"]).strip() if r.get("credit_card_types") not in (None, "") else None),
            "qty": _num(r.get("qty")),
            "price": _num(r.get("price")),
            "vat_rate": _num(r.get("vat_rate")),
            "amount_vi": _num(r.get("amount_vi")),
            "line_disc": _num(r.get("line_disc")),
            "doc_disc": _num(r.get("doc_disc")),
            "tax_base": _num(r.get("tax_base")),
            "vat": _num(r.get("vat")),
            "net_amount": _num(r.get("net_amount")),
        })
    return out


# ────────────────────────────────────────────────────────────────────────────
# POST
# ────────────────────────────────────────────────────────────────────────────

def post_ingest(cfg: dict, lines: list[dict]) -> None:
    base = (cfg.get("webapp_url") or "").rstrip("/")
    token = cfg.get("ingest_token") or ""
    if not base:
        raise RuntimeError("config.json'da webapp_url bos.")
    if not token:
        raise RuntimeError("config.json'da ingest_token bos.")
    url = f"{base}/api/ingest/retail-sales"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    timeout = int(cfg.get("request_timeout_seconds", 120))
    max_retries = int(cfg.get("max_retries", 3))
    chunk = int(cfg.get("post_chunk_size", 2000)) or len(lines) or 1

    total = len(lines)
    sent = 0
    for start in range(0, total, chunk):
        part = lines[start:start + chunk]
        payload = {
            "company_code": cfg.get("company_code", 1),
            "currency": cfg.get("currency", "TRY"),
            "lines": part,
        }
        last_err = None
        for attempt in range(1, max_retries + 1):
            try:
                LOG.info("POST %s  (%d-%d / %d satir) deneme %d/%d",
                         url, start + 1, start + len(part), total, attempt, max_retries)
                resp = requests.post(url, headers=headers, json=payload, timeout=timeout)
                if 200 <= resp.status_code < 300:
                    LOG.info("Kabul edildi (HTTP %d): %s", resp.status_code, (resp.text or "")[:300])
                    sent += len(part)
                    break
                body = (resp.text or "")[:300]
                if 400 <= resp.status_code < 500:
                    raise RuntimeError(f"Reddedildi (HTTP {resp.status_code}) - token/format kontrol et. {body}")
                last_err = RuntimeError(f"Sunucu hatasi HTTP {resp.status_code}: {body}")
                LOG.warning("Deneme %d/%d basarisiz: %s", attempt, max_retries, last_err)
            except RuntimeError:
                raise
            except Exception as exc:
                last_err = exc
                LOG.warning("Deneme %d/%d POST hatasi: %s", attempt, max_retries, exc)
            if attempt < max_retries:
                wait = 2 ** attempt
                LOG.info("%d sn sonra tekrar...", wait)
                time.sleep(wait)
        else:
            raise RuntimeError(f"Tum denemeler basarisiz. Son hata: {last_err}")
    LOG.info("Gonderim tamam: %d/%d satir.", sent, total)


# ────────────────────────────────────────────────────────────────────────────
# DRY-RUN / PROBE helpers
# ────────────────────────────────────────────────────────────────────────────

def _discount_meta_preview(lines: list[dict]) -> None:
    """Yeni alanlarin (not/neden/kampanya) gerçekten geldigini dogrula."""
    n_note = sum(1 for l in lines if l.get("invoice_note"))
    n_reason = sum(1 for l in lines if l.get("discount_reason"))
    n_camp = sum(1 for l in lines if l.get("campaign"))
    print("\n=== INDIRIM META (yeni alanlar) ===")
    print(f"  not (invoice_note) dolu : {n_note}")
    print(f"  iskonto nedeni dolu     : {n_reason}")
    print(f"  kampanya dolu           : {n_camp}")
    if n_note == 0 and n_camp == 0 and n_reason == 0:
        print("  !!! UYARI: hicbiri gelmedi -> ESKI satis_kopru.py calisiyor olabilir.")
        return
    print("  --- ornek (ilk 8 dolu satir) ---")
    shown = 0
    for l in lines:
        if shown >= 8:
            break
        if not (l.get("invoice_note") or l.get("campaign") or l.get("discount_reason")):
            continue
        note = (l.get("invoice_note") or "").replace("\n", " ").replace("\r", " ")[:45]
        print(f"  {l.get('invoice_ref')}: kamp='{(l.get('campaign') or '')[:30]}'"
              f" neden='{l.get('discount_reason') or ''}' not='{note}'")
        shown += 1


def _store_summary(lines: list[dict], cfg: dict) -> None:
    from collections import Counter
    by_code = Counter(l.get("store_code") or "(bos)" for l in lines)
    store_map = cfg.get("store_map", {})
    print("\n=== NEBIM magaza kodlari (store_map dogrulamasi) ===")
    print(f"{'Kod':<10}{'Satir':>8}  Eslesen ad (store_map)")
    print("-" * 50)
    for code, n in by_code.most_common():
        name = store_map.get(code, "")
        flag = "" if name else "  <-- store_map'te YOK"
        print(f"{code:<10}{n:>8}  {name}{flag}")
    print()


# ────────────────────────────────────────────────────────────────────────────
# MAIN
# ────────────────────────────────────────────────────────────────────────────

def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Derimod NEBIM -> muhasebe perakende satis koprusu.")
    p.add_argument("--config", default=None)
    p.add_argument("--since", default=None,
                   help="YYYY-MM-DD; bu tarihten itibaren cek (lookback yerine).")
    p.add_argument("--days", type=int, default=None,
                   help="Son N gunu cek (lookback yerine).")
    g = p.add_mutually_exclusive_group()
    g.add_argument("--dry-run", action="store_true", help="Sadece cek + ozet; GONDERME.")
    g.add_argument("--probe-stores", action="store_true", help="Sadece magaza kodlarini yaz.")
    args = p.parse_args(argv)

    cfg = load_config(args.config)
    log_path = cfg.get("log_file", "satis_kopru.log")
    if not os.path.isabs(log_path):
        log_path = os.path.join(HERE, log_path)
    setup_logging(log_path)

    LOG.info("=" * 60)
    mode = "probe-stores" if args.probe_stores else ("dry-run" if args.dry_run else "normal")
    LOG.info("Satis koprusu basliyor (mod=%s, config=%s)", mode, cfg.get("_config_path"))

    since_override = None
    if args.since:
        since_override = datetime.strptime(args.since, "%Y-%m-%d").date()
    elif args.days is not None:
        since_override = (datetime.now() - timedelta(days=args.days)).date()

    try:
        conn = connect(cfg)
        try:
            rows = fetch_sales(conn, cfg, since_override)
        finally:
            try:
                conn.close()
            except Exception:
                pass

        lines = build_lines(rows, cfg)

        if args.probe_stores or args.dry_run:
            _store_summary(lines, cfg)
            if args.dry_run:
                _discount_meta_preview(lines)
            net = sum((l["net_amount"] or 0) for l in lines)
            print(f"Toplam {len(lines)} satir, net toplam ~ {net:,.2f}")
            if args.dry_run:
                print("(--dry-run: hicbir sey GONDERILMEDI)")
            return 0

        post_ingest(cfg, lines)
        LOG.info("Kopru calismasi tamamlandi.")
        return 0
    except Exception as exc:
        LOG.exception("KOPRU BASARISIZ: %s", exc)
        print(f"KOPRU BASARISIZ: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
