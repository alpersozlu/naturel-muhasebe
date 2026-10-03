-- Denim tahmini (ürün adından) — yalnız akla yatkınlık kontrolü; prim bu rakamla ödenmez.
ALTER TABLE "DealerDailyRep"
  ADD COLUMN "denim_est" DECIMAL(16,4),
  ADD COLUMN "denim_units_est" DECIMAL(12,2);
