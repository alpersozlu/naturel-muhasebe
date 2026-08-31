"use client";

import { forwardRef, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * Türkçe biçimli tutar alanı: yazarken binlik ayracı kendiliğinden koyar
 * (11000 → 11.000), ondalık için virgül kabul eder (11000,50 → 11.000,50).
 *
 * `type="number"` ile binlik ayraç GÖSTERİLEMEZ (tarayıcı kısıtı), bu yüzden
 * metin girişi + inputMode="decimal" kullanılır: mobilde yine sayı klavyesi
 * açılır, masaüstünde biçimlendirme çalışır.
 *
 * Dışarıya her zaman `number | undefined` verir — form şemaları sayı bekler.
 */

/** "11.000,50" → 11000.5 · boş/geçersiz → undefined */
export function parseTrMoney(display: string): number | undefined {
  const s = display.replace(/\./g, "").replace(",", ".").trim();
  if (s === "") return undefined;
  const v = Number(s);
  return Number.isFinite(v) ? v : undefined;
}

/** Yazım sırasında biçimlendirir; ondalık virgülü ve son sıfırları korur. */
export function formatTrMoneyInput(raw: string): string {
  const cleaned = raw.replace(/[^\d,]/g, "");
  const [intRaw = "", ...rest] = cleaned.split(",");
  const intFmt = intRaw.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  if (rest.length === 0) return intFmt;
  return `${intFmt},${rest.join("").slice(0, 2)}`;
}

/** number → "11.000,50" (alan odakta değilken gösterilen hal) */
export function formatTrMoneyValue(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "";
  return new Intl.NumberFormat("tr-TR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(v);
}

type Props = Omit<
  React.ComponentPropsWithoutRef<typeof Input>,
  "value" | "onChange" | "type"
> & {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
};

export const MoneyInput = forwardRef<HTMLInputElement, Props>(
  function MoneyInput({ value, onChange, ...rest }, ref) {
    // Ham metni içeride tutarız: değeri her render'da sayıdan üretirsek
    // kullanıcı "11.000," yazarken virgül anında silinir.
    const [display, setDisplay] = useState(() =>
      value ? formatTrMoneyValue(value) : ""
    );

    // Dışarıdan gelen değişiklik (form reset) ekrana yansısın — ama yalnız
    // SAYISAL fark varsa, yoksa yazım sırasındaki virgülü bozar.
    useEffect(() => {
      if ((parseTrMoney(display) ?? 0) !== (value ?? 0)) {
        setDisplay(value ? formatTrMoneyValue(value) : "");
      }
      // display kasten bağımlılık değil — yazarken kendini ezmesin.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    return (
      <Input
        {...rest}
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={display}
        onChange={(e) => {
          const next = formatTrMoneyInput(e.target.value);
          setDisplay(next);
          onChange(parseTrMoney(next));
        }}
      />
    );
  }
);
