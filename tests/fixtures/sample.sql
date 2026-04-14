-- tests/fixtures/sample.sql
-- Realistic PostgreSQL schema with 5 tables, indexes, and FK constraints

CREATE TABLE users (
    id          SERIAL PRIMARY KEY,
    email       VARCHAR(255) NOT NULL,
    username    VARCHAR(100) NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_users_email    ON users (email);
CREATE UNIQUE INDEX idx_users_username ON users (username);

-- -----------------------------------------------------------------------

CREATE TABLE products (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    price       NUMERIC(10, 2) NOT NULL,
    stock_count INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_products_name ON products (name);

-- -----------------------------------------------------------------------

CREATE TABLE orders (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    status      VARCHAR(50) NOT NULL DEFAULT 'pending',
    total       NUMERIC(10, 2) NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Missing index on orders.user_id — intentional optimisation opportunity
-- CREATE INDEX idx_orders_user_id ON orders (user_id);

CREATE INDEX idx_orders_status ON orders (status);

-- -----------------------------------------------------------------------

CREATE TABLE order_items (
    id          SERIAL PRIMARY KEY,
    order_id    INTEGER NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    product_id  INTEGER NOT NULL REFERENCES products (id),
    quantity    INTEGER NOT NULL DEFAULT 1,
    unit_price  NUMERIC(10, 2) NOT NULL
);

-- Missing index on order_items.order_id — intentional optimisation opportunity
-- CREATE INDEX idx_order_items_order_id ON order_items (order_id);
CREATE INDEX idx_order_items_product_id ON order_items (product_id);

-- -----------------------------------------------------------------------

CREATE TABLE audit_logs (
    id          BIGSERIAL PRIMARY KEY,
    user_id     INTEGER REFERENCES users (id),
    action      VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100),
    entity_id   INTEGER,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- audit_logs grows fast — no partitioning defined (intentional opportunity)
CREATE INDEX idx_audit_logs_user_id    ON audit_logs (user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs (created_at);
