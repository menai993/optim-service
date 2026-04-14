// tests/fixtures/sample_backend.ts
// Realistic TypeScript service file with intentional N+1, missing cache,
// and ORM issues — used as a fixture for parser tests

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ---- N+1 issue: fetching order items inside a loop ----
export async function getOrdersWithItems(userId: number) {
  const orders = await prisma.orders.findMany({
    where: { user_id: userId },
  });

  // N+1: one DB call per order
  for (const order of orders) {
    const items = await prisma.order_items.findMany({
      where: { order_id: order.id },
    });
    (order as typeof order & { items: typeof items }).items = items;
  }

  return orders;
}

// ---- Missing cache: product catalogue fetched on every request ----
export async function getProductCatalogue() {
  // No caching — this runs a full table scan on every call
  const products = await prisma.products.findMany();
  return products;
}

// ---- Unbounded query: no limit or pagination ----
export async function getAllAuditLogs(userId: number) {
  return prisma.audit_logs.findMany({
    where: { user_id: userId },
    // Missing: take / skip pagination
  });
}

// ---- Raw query with string interpolation ----
export async function searchProducts(keyword: string) {
  const raw = await prisma.$queryRawUnsafe(
    `SELECT * FROM products WHERE name ILIKE '%${keyword}%'`,
  );
  return raw;
}

// ---- Missing eager loading: N+1 for user lookups ----
export async function getRecentOrders(limit: number = 50) {
  const orders = await prisma.orders.findMany({
    take: limit,
    orderBy: { created_at: 'desc' },
  });

  return orders.map(async (order) => {
    const user = await prisma.users.findFirst({ where: { id: order.user_id } });
    return { ...order, user };
  });
}
