-- tests/fixtures/sample.sql
-- Realistic PostgreSQL schema with intentional performance problems
-- 5 tables: users, orders, order_items, products, audit_logs

-- -----------------------------------------------------------------------
-- users
-- -----------------------------------------------------------------------
CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username    VARCHAR(100) NOT NULL,
    email       VARCHAR(255) NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_login  TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_users_email ON users (email);
CREATE UNIQUE INDEX idx_users_username ON users (username);

-- -----------------------------------------------------------------------
-- products
-- -----------------------------------------------------------------------
CREATE TABLE products (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    category    VARCHAR(100) NOT NULL,
    price       NUMERIC(10, 2) NOT NULL,
    stock_count INTEGER NOT NULL DEFAULT 0,
    description TEXT
);

-- Suboptimal: single-column index on name — could be a covering index (name, category)
CREATE INDEX idx_products_name ON products (name);

-- -----------------------------------------------------------------------
-- orders
-- -----------------------------------------------------------------------
CREATE TABLE orders (
    id          SERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    status      VARCHAR(50) NOT NULL DEFAULT 'pending',
    total       NUMERIC(10, 2) NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- PROBLEM: no index on status — filter queries scan entire table
-- CREATE INDEX idx_orders_status ON orders (status);

CREATE INDEX idx_orders_user_id ON orders (user_id);

-- Suboptimal: index on created_at is rarely used alone
CREATE INDEX idx_orders_created_at ON orders (created_at);

-- -----------------------------------------------------------------------
-- order_items
-- -----------------------------------------------------------------------
CREATE TABLE order_items (
    id          SERIAL PRIMARY KEY,
    order_id    INTEGER NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    product_id  INTEGER NOT NULL REFERENCES products (id),
    quantity    INTEGER NOT NULL DEFAULT 1,
    price       NUMERIC(10, 2) NOT NULL
);

-- PROBLEM: no index on order_id FK — joining items to orders causes seq scan
-- CREATE INDEX idx_order_items_order_id ON order_items (order_id);

-- PROBLEM: no index on product_id FK — joining items to products causes seq scan
-- CREATE INDEX idx_order_items_product_id ON order_items (product_id);

-- -----------------------------------------------------------------------
-- audit_logs — very large, append-heavy table
-- -----------------------------------------------------------------------
CREATE TABLE audit_logs (
    id          BIGSERIAL PRIMARY KEY,
    entity_type VARCHAR(100) NOT NULL,
    entity_id   INTEGER NOT NULL,
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload     JSONB
);

CREATE INDEX idx_audit_logs_entity ON audit_logs (entity_type, entity_id);

-- PROBLEM: no indexes at all on a very large table
-- Queries on entity_type + entity_id and changed_at will be seq scans
-- No partitioning on this append-only table
