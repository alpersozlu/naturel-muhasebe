import { z } from "zod";

export const userRoleEnum = z.enum(["admin", "store_manager", "cashier", "sales_rep"]);

/** Mağaza ataması olmadan çalışamayan roller. */
export const STORE_SCOPED_ROLES = ["store_manager", "cashier"] as const;

export const userCreateSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("Geçerli bir e-posta gir"),
    password: z.string().min(6, "En az 6 karakter"),
    full_name: z
      .string()
      .trim()
      .max(80)
      .optional()
      .transform((v) => (v === "" ? undefined : v)),
    role: userRoleEnum,
    // Mağaza müdürü / kasiyer için ZORUNLU (aşağıdaki refine)
    store_id: z.string().uuid().optional(),
  })
  .superRefine((v, ctx) => {
    // Mağaza seçilmezse UserStoreAccess kaydı oluşmaz; kullanıcı giriş yapar
    // ama hiçbir mağaza göremez ve hiçbir şey yükleyemez. Sessiz bir çıkmaz
    // yerine oluşturma anında engelle.
    if (
      (STORE_SCOPED_ROLES as readonly string[]).includes(v.role) &&
      !v.store_id
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["store_id"],
        message:
          "Mağaza müdürü ve kasiyer için mağaza seçilmeli — aksi halde kullanıcı hiçbir mağazaya erişemez",
      });
    }
  });

export const userSetPasswordSchema = z.object({
  id: z.string().uuid(),
  password: z.string().min(6, "En az 6 karakter"),
});

/** Admin sends the invitation e-mail: the temporary password is set at the same time. */
export const userSendInviteSchema = z.object({
  id: z.string().uuid(),
  /** Optional: when given it is set on the account and written in the mail; otherwise the mail carries no password. */
  password: z.string().min(6, "En az 6 karakter").optional(),
  /** Where to send; defaults to the account's e-mail. */
  to: z.string().trim().toLowerCase().email("Geçerli bir e-posta gir").optional(),
  login_url: z.string().url().max(300),
  /** How to address the person: "Döne Hanım", "Ali Bey" or the full name. The admin picks; never inferred. */
  salutation: z.enum(["none", "hanim", "bey"]).default("none"),
});

export const userSetActiveSchema = z.object({
  id: z.string().uuid(),
  is_active: z.boolean(),
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
