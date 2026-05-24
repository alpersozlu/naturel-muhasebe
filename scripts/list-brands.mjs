import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const brands = await prisma.brand.findMany({ where: { deleted_at: null }, select: { name: true } });
console.log(brands.map((b) => `"${b.name}"`).join("\n"));
await prisma.$disconnect();
