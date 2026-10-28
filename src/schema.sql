CREATE TABLE IF NOT EXISTS payment_references (
  reference      text PRIMARY KEY,
  label          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_signature text,
  last_slot      bigint
);

CREATE TABLE IF NOT EXISTS transfers (
  signature         text    NOT NULL,
  instruction_index text    NOT NULL,
  reference         text    NOT NULL REFERENCES payment_references (reference),
  slot              bigint  NOT NULL,
  block_time        timestamptz,
  mint              text    NOT NULL,
  source            text    NOT NULL,
  destination       text    NOT NULL,
  destination_owner text    NOT NULL,
  amount            numeric(39, 0) NOT NULL CHECK (amount >= 0),
  PRIMARY KEY (signature, instruction_index)
);

CREATE INDEX IF NOT EXISTS transfers_reference_idx ON transfers (reference);

CREATE TABLE IF NOT EXISTS orders (
  order_id   text PRIMARY KEY CHECK (length(order_id) BETWEEN 1 AND 64),
  reference  text NOT NULL UNIQUE REFERENCES payment_references (reference),
  expected   numeric(39, 0) NOT NULL CHECK (expected > 0),
  label      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
