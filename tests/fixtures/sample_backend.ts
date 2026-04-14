// tests/fixtures/sample_backend.ts
// Realistic TypeScript service with intentional performance problems
// Used as a fixture for code parser and integration tests

import { Repository, Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany } from 'typeorm';

// ── Entities ──────────────────────────────────────────────────────────────────

@Entity()
class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  email!: string;

  @OneToMany(() => Order, (order) => order.user, { lazy: true })
  orders!: Promise<Order[]>;
}

@Entity()
class Order {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => User, (user) => user.orders)
  user!: User;

  @Column()
  status!: string;

  @Column('decimal')
  total!: number;

  @OneToMany(() => OrderItem, (item) => item.order, { lazy: true })
  items!: Promise<OrderItem[]>;
}

@Entity()
class OrderItem {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => Order, (order) => order.items)
  order!: Order;

  @ManyToOne(() => Product)
  product!: Product;

  @Column()
  quantity!: number;

  @Column('decimal')
  price!: number;
}

@Entity()
class Product {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column()
  category!: string;

  @Column('decimal')
  price!: number;

  @Column()
  stockCount!: number;

  @Column('text')
  description!: string;
}

// ── Repositories (injected) ───────────────────────────────────────────────────

let orderRepo: Repository<Order>;
let orderItemRepo: Repository<OrderItem>;
let productRepo: Repository<Product>;
let userRepo: Repository<User>;

// ── OrderService ──────────────────────────────────────────────────────────────

export class OrderService {
  /**
   * PROBLEM: N+1 query pattern.
   * Fetches all orders, then loops and calls productRepo.findOneBy() for each item.
   */
  async getOrdersForUser(userId: string): Promise<any[]> {
    const orders = await orderRepo.find({ where: { user: { id: userId } } });

    const result = [];
    for (const order of orders) {
      const items = await orderItemRepo.find({ where: { order: { id: order.id } } });
      const enrichedItems = [];
      for (const item of items) {
        // N+1: one query per item to fetch the product
        const product = await productRepo.findOneBy({ id: item.product.id });
        enrichedItems.push({ ...item, product });
      }
      result.push({ ...order, items: enrichedItems });
    }
    return result;
  }

  /**
   * PROBLEM: No pagination — returns unbounded result set.
   */
  async getProductsByCategory(category: string): Promise<Product[]> {
    // PROBLEM: raw SELECT * with no LIMIT
    return productRepo.query(`SELECT * FROM products WHERE category = $1`, [category]);
  }

  /**
   * PROBLEM: await inside forEach — should use Promise.all or batch insert.
   */
  async processAuditLog(entries: Array<{ entityType: string; entityId: number; payload: any }>): Promise<void> {
    entries.forEach(async (entry) => {
      await orderRepo.query(
        'INSERT INTO audit_log (entity_type, entity_id, changed_at, payload) VALUES ($1, $2, NOW(), $3)',
        [entry.entityType, entry.entityId, JSON.stringify(entry.payload)],
      );
    });
  }

  /**
   * PROBLEM: Accesses lazy-loaded relationship in a loop — hidden N+1.
   */
  async getUserWithOrders(userId: string): Promise<{ user: User; orderCount: number }> {
    const user = await userRepo.findOneBy({ id: userId });
    if (!user) throw new Error('User not found');

    // Lazy load triggers a separate query
    const orders = await user.orders;
    return { user, orderCount: orders.length };
  }

  // ── Clean methods (should NOT trigger false positives) ──────────────────

  /**
   * Clean: single query, no loop, no anti-pattern.
   */
  async getOrderById(orderId: number): Promise<Order | null> {
    return orderRepo.findOneBy({ id: orderId });
  }

  /**
   * Clean: properly paginated query.
   */
  async getRecentOrders(page: number, pageSize: number): Promise<Order[]> {
    return orderRepo.find({
      order: { id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
  }
}
