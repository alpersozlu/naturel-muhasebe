import { z } from "zod";
import { userRoleEnum } from "./user";

export const assignSchema = z.object({
  user_id: z.string().uuid(),
  store_id: z.string().uuid(),
  role: userRoleEnum, // bu mağazadaki rolü (store_manager/cashier/sales_rep)
});

export const unassignSchema = z.object({
  user_id: z.string().uuid(),
  store_id: z.string().uuid(),
});

export const listForStoreSchema = z.object({
  store_id: z.string().uuid(),
});

export type AssignInput = z.infer<typeof assignSchema>;
