import { z } from "zod";

export const userRoleEnum = z.enum(["admin", "store_manager", "cashier", "sales_rep"]);

export const userCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email("Geçerli bir e-posta gir"),
  password: z.string().min(8, "En az 8 karakter"),
  full_name: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
  role: userRoleEnum,
});

export const userUpdateRoleSchema = z.object({
  id: z.string().uuid(),
  role: userRoleEnum,
  full_name: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});

export const userIdSchema = z.object({
  id: z.string().uuid(),
});

export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateRoleInput = z.infer<typeof userUpdateRoleSchema>;
