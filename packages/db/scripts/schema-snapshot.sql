-- gestion-pagos -- snapshot canonico del esquema (drift guard del CI)
--
-- Generado por `packages/db/scripts/dump-schema.mjs` leyendo el catalogo de una base
-- MIGRADA (no los archivos .sql). Es lo que la base realmente tiene.
--
-- Regenerar despues de agregar o cambiar una migracion:
--   export DATABASE_URL=postgresql://<user>:<password>@127.0.0.1:5434/gestion_pagos_dev
--   node packages/db/scripts/dump-schema.mjs > packages/db/scripts/schema-snapshot.sql
--
-- Verificar (lo que corre el CI):
--   pnpm --filter @gestion/db db:dump --check
--
-- Reglas del formato: solo esquema (ningun dato), una linea por objeto, secciones en orden
-- fijo y lineas ordenadas. El dueno se emite como OWNER y el grantor se omite, porque cambian
-- con el rol que despliega (S16) y no son parte del contrato. NO editar a mano.
--
-- Exclusiones (a proposito, para que el guard mida el contrato y no como se inicializo la
-- base): el pseudo-rol `pg_database_owner` se emite como OWNER, y
-- `GRANT USAGE ON SCHEMA public TO PUBLIC` (default de initdb desde PostgreSQL 15) no se emite.
-- El resto de los privilegios se compara tal cual, incluidos los de columna del hardening
-- 20261012221550. Detalle y justificacion: comentario de cabecera de dump-schema.mjs.
--
-- Secciones: ROLES, SCHEMAS, RELATIONS, COLUMNS, ENUMS, CONSTRAINTS, INDEXES, FUNCTIONS,
-- TRIGGERS, POLICIES, PRIVILEGES.

ROLES
ROLE anon login=false inherit=false bypassrls=false super=false createrole=false
ROLE authenticated login=false inherit=false bypassrls=false super=false createrole=false
ROLE service_role login=false inherit=false bypassrls=true super=false createrole=false

SCHEMAS
SCHEMA auth acl=explicit
SCHEMA private acl=default
SCHEMA public acl=explicit

RELATIONS
RELATION table auth.account rls=false force_rls=false acl=default
RELATION table auth.session rls=false force_rls=false acl=default
RELATION table auth.users rls=false force_rls=false acl=default
RELATION table auth.verification rls=false force_rls=false acl=default
RELATION table public.__sql_migrations rls=false force_rls=false acl=explicit
RELATION table public.app_setting rls=true force_rls=false acl=explicit
RELATION table public.bank_reconciliation rls=true force_rls=false acl=explicit
RELATION table public.bank_reconciliation_item rls=true force_rls=false acl=explicit
RELATION table public.cash_account rls=true force_rls=false acl=explicit
RELATION table public.cash_close rls=true force_rls=false acl=explicit
RELATION table public.cash_close_denomination rls=true force_rls=false acl=explicit
RELATION table public.cash_count rls=true force_rls=false acl=explicit
RELATION table public.cash_count_denomination rls=true force_rls=false acl=explicit
RELATION table public.cash_receipt_category rls=true force_rls=false acl=explicit
RELATION table public.cash_transfer rls=true force_rls=false acl=explicit
RELATION table public.comprobante rls=true force_rls=false acl=explicit
RELATION table public.entidad rls=true force_rls=false acl=explicit
RELATION table public.payment rls=true force_rls=false acl=explicit
RELATION table public.payment_allocation rls=true force_rls=false acl=explicit
RELATION table public.payment_method rls=true force_rls=false acl=explicit
RELATION table public.petty_cash_vale rls=true force_rls=false acl=explicit
RELATION table public.receipt_sequence rls=true force_rls=false acl=explicit
RELATION table public.voucher_series rls=true force_rls=false acl=explicit
RELATION view public.payment_balance rls=false force_rls=false acl=explicit
RELATION view public.voucher_balance rls=false force_rls=false acl=explicit

COLUMNS
COLUMN auth.account.access_token type=text not_null=false default=- identity=- generated=-
COLUMN auth.account.access_token_expires_at type=timestamp with time zone not_null=false default=- identity=- generated=-
COLUMN auth.account.account_id type=text not_null=true default=- identity=- generated=-
COLUMN auth.account.created_at type=timestamp with time zone not_null=true default=now() identity=- generated=-
COLUMN auth.account.id type=text not_null=true default=- identity=- generated=-
COLUMN auth.account.id_token type=text not_null=false default=- identity=- generated=-
COLUMN auth.account.password type=text not_null=false default=- identity=- generated=-
COLUMN auth.account.provider_id type=text not_null=true default=- identity=- generated=-
COLUMN auth.account.refresh_token type=text not_null=false default=- identity=- generated=-
COLUMN auth.account.refresh_token_expires_at type=timestamp with time zone not_null=false default=- identity=- generated=-
COLUMN auth.account.scope type=text not_null=false default=- identity=- generated=-
COLUMN auth.account.updated_at type=timestamp with time zone not_null=true default=now() identity=- generated=-
COLUMN auth.account.user_id type=uuid not_null=true default=- identity=- generated=-
COLUMN auth.session.created_at type=timestamp with time zone not_null=true default=now() identity=- generated=-
COLUMN auth.session.expires_at type=timestamp with time zone not_null=true default=- identity=- generated=-
COLUMN auth.session.id type=text not_null=true default=- identity=- generated=-
COLUMN auth.session.ip_address type=text not_null=false default=- identity=- generated=-
COLUMN auth.session.token type=text not_null=true default=- identity=- generated=-
COLUMN auth.session.updated_at type=timestamp with time zone not_null=true default=now() identity=- generated=-
COLUMN auth.session.user_agent type=text not_null=false default=- identity=- generated=-
COLUMN auth.session.user_id type=uuid not_null=true default=- identity=- generated=-
COLUMN auth.users.created_at type=timestamp with time zone not_null=true default=now() identity=- generated=-
COLUMN auth.users.email type=text not_null=true default=- identity=- generated=-
COLUMN auth.users.email_verified type=boolean not_null=true default=false identity=- generated=-
COLUMN auth.users.id type=uuid not_null=true default=gen_random_uuid() identity=- generated=-
COLUMN auth.users.image type=text not_null=false default=- identity=- generated=-
COLUMN auth.users.name type=text not_null=false default=- identity=- generated=-
COLUMN auth.users.updated_at type=timestamp with time zone not_null=true default=now() identity=- generated=-
COLUMN auth.verification.created_at type=timestamp with time zone not_null=true default=now() identity=- generated=-
COLUMN auth.verification.expires_at type=timestamp with time zone not_null=true default=- identity=- generated=-
COLUMN auth.verification.id type=text not_null=true default=- identity=- generated=-
COLUMN auth.verification.identifier type=text not_null=true default=- identity=- generated=-
COLUMN auth.verification.updated_at type=timestamp with time zone not_null=true default=now() identity=- generated=-
COLUMN auth.verification.value type=text not_null=true default=- identity=- generated=-
COLUMN public.__sql_migrations.applied_at type=timestamp with time zone not_null=true default=now() identity=- generated=-
COLUMN public.__sql_migrations.name type=text not_null=true default=- identity=- generated=-
COLUMN public.app_setting.key type=text not_null=true default=- identity=- generated=-
COLUMN public.app_setting.owner_id type=uuid not_null=true default=auth.uid() identity=- generated=-
COLUMN public.app_setting.updated_at type=timestamp with time zone not_null=true default=now() identity=- generated=-
COLUMN public.app_setting.value type=text not_null=true default=- identity=- generated=-
COLUMN public.bank_reconciliation.books_balance type=numeric(12,2) not_null=true default=- identity=- generated=-
COLUMN public.bank_reconciliation.cash_account_id type=uuid not_null=true default=- identity=- generated=-
COLUMN public.bank_reconciliation.created_at type=timestamp with time zone not_null=true default=now() identity=- generated=-
COLUMN public.bank_reconciliation.id type=uuid not_null=true default=gen_random_uuid() identity=- generated=-
COLUMN public.bank_reconciliation.notes type=text not_null=false default=- identity=- generated=-
COLUMN public.bank_reconciliation.owner_id type=uuid not_null=true default=auth.uid() identity=- generated=-
COLUMN public.bank_reconciliation.period_end type=date not_null=true default=- identity=- generated=-
COLUMN public.bank_reconciliation.period_start type=date not_null=true default=- identity=- generated=-
COLUMN public.bank_reconciliation.prepared_by type=character varying(100) not_null=false default=- identity=- generated=-
COLUMN public.bank_reconciliation.reviewed_by type=character varying(100) not_null=false default=- identity=- generated=-
COLUMN public.bank_reconciliation.statement_balance type=numeric(12,2) not_null=true default=- identity=- generated=-
COLUMN public.bank_reconciliation.updated_at type=timestamp with time zone not_null=true default=now() identity=- generated=-
COLUMN public.bank_reconciliation_item.amount type=numeric(12,2) not_null=true default=- identity=- generated=-
COLUMN public.bank_reconciliation_item.created_at type=timestamp with time zone not_null=true default=now() identity=- generated=-
COLUMN public.bank_reconciliation_item.description type=text not_null=true default=- identity=- generated=-
COLUMN public.bank_reconciliation_item.id type=uuid not_null=true default=gen_random_uuid() identity=- generated=-
COLUMN public.bank_reconciliation_item.kind type=public.reconciliation_item_kind not_null=true default=- identity=- generated=-
COLUMN public.bank_reconciliation_item.reconciliation_id type=uuid not_null=true default=- identity=- generated=-
COLUMN public.cash_account.account_number type=text not_null=false default=- identity=- generated=-
COLUMN public.cash_account.bank_name type=text not_null=false default=- identity=- generated=-
COLUMN public.cash_account.cci type=text not_null=false default=- identity=- generated=-
COLUMN public.cash_account.change_fund type=numeric(12,2) not_null=true default=0 identity=- generated=-
COLUMN public.cash_account.closing_periodicity type=public.closing_periodicity not_null=false default=- identity=- generated=-
COLUMN public.cash_account.created_at type=timestamp with time zone not_null=true default=now() identity=- generated=-
COLUMN public.cash_account.currency type=text not_null=true default='PEN'::text identity=- generated=-
COLUMN public.cash_account.custodian_name type=character varying(100) not_null=false default=- identity=- generated=-
COLUMN public.cash_account.deleted_at type=timestamp with time zone not_null=false default=- identity=- generated=-
COLUMN public.cash_account.id type=uuid not_null=true default=gen_random_uuid() identity=- generated=-
COLUMN public.cash_account.is_active type=boolean not_null=true default=true identity=- generated=-
COLUMN public.cash_account.is_petty_cash type=boolean not_null=true default=false identity=- generated=-
COLUMN public.cash_account.name type=text not_null=true default=- identity=- generated=-
COLUMN public.cash_account.notes type=text not_null=false default=- identity=- generated=-
COLUMN public.cash_account.opening_balance type=numeric(12,2) not_null=true default=0 identity=- generated=-
COLUMN public.cash_account.opening_balance_date type=date not_null=true default=CURRENT_DATE identity=- generated=-
COLUMN public.cash_account.owner_id type=uuid not_null=true default=auth.uid() identity=- generated=-
COLUMN public.cash_account.petty_expense_limit type=numeric(12,2) not_null=false default=- identity=- generated=-
COLUMN public.cash_account.type type=public.cash_account_type not_null=true default=- identity=- generated=-
COLUMN public.cash_account.updated_at type=timestamp with time zone not_null=true default=now() identity=- generated=-
COLUMN public.cash_close.cash_account_id type=uuid not_null=true default=- identity=- generated=-
COLUMN public.cash_close.change_fund type=numeric(12,2) not_null=false default=- identity=- generated=-
COLUMN public.cash_close.counted_balance type=numeric(12,2) not_null=false default=- identity=- generated=-
COLUMN public.cash_close.counted_by type=character varying(100) not_null=false default=- identity=- generated=-
COLUMN public.cash_close.created_at type=timestamp with time zone not_null=true default=now() identity=- generated=-
COLUMN public.cash_close.difference type=numeric(12,2) not_null=false default=- identity=- generated=-
COLUMN public.cash_close.difference_reason type=text not_null=false default=- identity=- generated=-
COLUMN public.cash_close.difference_tolerance type=numeric(12,2) not_null=false default=- identity=- generated=-
COLUMN public.cash_close.expected_balance type=numeric(12,2) not_null=true default=- identity=- generated=-
COLUMN public.cash_close.expense_total type=numeric(12,2) not_null=true default=0 identity=- generated=-
COLUMN public.cash_close.id type=uuid not_null=true default=gen_random_uuid() identity=- generated=-
COLUMN public.cash_close.income_total type=numeric(12,2) not_null=true default=0 identity=- generated=-
COLUMN public.cash_close.notes type=text not_null=false default=- identity=- generated=-
COLUMN public.cash_close.opening_balance type=numeric(12,2) not_null=true default=- identity=- generated=-
COLUMN public.cash_close.owner_id type=uuid not_null=true default=auth.uid() identity=- generated=-
COLUMN public.cash_close.pen_usd_rate type=numeric(10,4) not_null=false default=- identity=- generated=-
COLUMN public.cash_close.period_end type=date not_null=true default=- identity=- generated=-
COLUMN public.cash_close.period_start type=date not_null=true default=- identity=- generated=-
COLUMN public.cash_close.periodicity type=public.closing_periodicity not_null=true default=- identity=- generated=-
COLUMN public.cash_close.transfer_in_total type=numeric(12,2) not_null=true default=0 identity=- generated=-
COLUMN public.cash_close.transfer_out_total type=numeric(12,2) not_null=true default=0 identity=- generated=-
COLUMN public.cash_close.verified_by type=character varying(100) not_null=false default=- identity=- generated=-
COLUMN public.cash_close_denomination.cash_close_id type=uuid not_null=true default=- identity=- generated=-
COLUMN public.cash_close_denomination.denomination type=numeric(5,2) not_null=true default=- identity=- generated=-
COLUMN public.cash_close_denomination.id type=uuid not_null=true default=gen_random_uuid() identity=- generated=-
COLUMN public.cash_close_denomination.quantity type=integer not_null=true default=- identity=- generated=-
COLUMN public.cash_count.cash_account_id type=uuid not_null=true default=- identity=- generated=-
COLUMN public.cash_count.change_fund type=numeric(12,2) not_null=false default=- identity=- generated=-
COLUMN public.cash_count.count_date type=date not_null=true default=CURRENT_DATE identity=- generated=-
COLUMN public.cash_count.counted_balance type=numeric(12,2) not_null=true default=- identity=- generated=-
COLUMN public.cash_count.counted_by type=character varying(100) not_null=false default=- identity=- generated=-
COLUMN public.cash_count.created_at type=timestamp with time zone not_null=true default=now() identity=- generated=-
COLUMN public.cash_count.difference type=numeric(12,2) not_null=true default=- identity=- generated=-
COLUMN public.cash_count.expected_balance type=numeric(12,2) not_null=true default=- identity=- generated=-
COLUMN public.cash_count.id type=uuid not_null=true default=gen_random_uuid() identity=- generated=-
COLUMN public.cash_count.is_surprise type=boolean not_null=true default=true identity=- generated=-
COLUMN public.cash_count.notes type=text not_null=false default=- identity=- generated=-
COLUMN public.cash_count.owner_id type=uuid not_null=true default=auth.uid() identity=- generated=-
COLUMN public.cash_count_denomination.cash_count_id type=uuid not_null=true default=- identity=- generated=-
COLUMN public.cash_count_denomination.denomination type=numeric(5,2) not_null=true default=- identity=- generated=-
COLUMN public.cash_count_denomination.id type=uuid not_null=true default=gen_random_uuid() identity=- generated=-
COLUMN public.cash_count_denomination.quantity type=integer not_null=true default=- identity=- generated=-
COLUMN public.cash_receipt_category.code type=text not_null=true default=- identity=- generated=-
COLUMN public.cash_receipt_category.created_at type=timestamp with time zone not_null=true default=now() identity=- generated=-
COLUMN public.cash_receipt_category.direction type=public.payment_direction not_null=true default=- identity=- generated=-
COLUMN public.cash_receipt_category.id type=uuid not_null=true default=gen_random_uuid() identity=- generated=-
COLUMN public.cash_receipt_category.is_active type=boolean not_null=true default=true identity=- generated=-
COLUMN public.cash_receipt_category.name type=text not_null=true default=- identity=- generated=-
COLUMN public.cash_receipt_category.owner_id type=uuid not_null=true default=auth.uid() identity=- generated=-
COLUMN public.cash_transfer.amount type=numeric(12,2) not_null=true default=- identity=- generated=-
COLUMN public.cash_transfer.created_at type=timestamp with time zone not_null=true default=now() identity=- generated=-
COLUMN public.cash_transfer.id type=uuid not_null=true default=gen_random_uuid() identity=- generated=-
COLUMN public.cash_transfer.notes type=text not_null=false default=- identity=- generated=-
COLUMN public.cash_transfer.owner_id type=uuid not_null=true default=auth.uid() identity=- generated=-
COLUMN public.cash_transfer.source_account_id type=uuid not_null=true default=- identity=- generated=-
COLUMN public.cash_transfer.target_account_id type=uuid not_null=true default=- identity=- generated=-
COLUMN public.cash_transfer.transfer_date type=date not_null=true default=CURRENT_DATE identity=- generated=-
COLUMN public.comprobante.created_at type=timestamp with time zone not_null=true default=now() identity=- generated=-
COLUMN public.comprobante.credit_days type=integer not_null=false default=- identity=- generated=-
COLUMN public.comprobante.deleted_at type=timestamp with time zone not_null=false default=- identity=- generated=-
COLUMN public.comprobante.due_date type=date not_null=false default=CASE WHEN (payment_type = 'CREDITO'::public.payment_type) THEN (issue_date + credit_days) ELSE NULL::date END identity=- generated=s
COLUMN public.comprobante.entity_id type=uuid not_null=true default=- identity=- generated=-
COLUMN public.comprobante.id type=uuid not_null=true default=gen_random_uuid() identity=- generated=-
COLUMN public.comprobante.igv type=numeric(12,2) not_null=true default=- identity=- generated=-
COLUMN public.comprobante.issue_date type=date not_null=true default=- identity=- generated=-
COLUMN public.comprobante.motive_code type=text not_null=false default=- identity=- generated=-
COLUMN public.comprobante.owner_id type=uuid not_null=true default=auth.uid() identity=- generated=-
COLUMN public.comprobante.payment_type type=public.payment_type not_null=true default=- identity=- generated=-
COLUMN public.comprobante.referenced_comprobante_id type=uuid not_null=false default=- identity=- generated=-
COLUMN public.comprobante.registration_date type=date not_null=true default=CURRENT_DATE identity=- generated=-
COLUMN public.comprobante.status type=public.comprobante_status not_null=true default='PENDIENTE'::public.comprobante_status identity=- generated=-
COLUMN public.comprobante.subtotal type=numeric(12,2) not_null=true default=- identity=- generated=-
COLUMN public.comprobante.total type=numeric(12,2) not_null=true default=- identity=- generated=-
COLUMN public.comprobante.updated_at type=timestamp with time zone not_null=true default=now() identity=- generated=-
COLUMN public.comprobante.voucher_kind type=public.voucher_kind not_null=true default=- identity=- generated=-
COLUMN public.comprobante.voucher_number type=text not_null=true default=- identity=- generated=-
COLUMN public.comprobante.voucher_type type=public.voucher_type not_null=true default=- identity=- generated=-
COLUMN public.entidad.address type=text not_null=true default=''::text identity=- generated=-
COLUMN public.entidad.billing_email type=text not_null=true default=- identity=- generated=-
COLUMN public.entidad.contact_name type=text not_null=true default=''::text identity=- generated=-
COLUMN public.entidad.created_at type=timestamp with time zone not_null=true default=now() identity=- generated=-
COLUMN public.entidad.deleted_at type=timestamp with time zone not_null=false default=- identity=- generated=-
COLUMN public.entidad.document_number type=text not_null=true default=''::text identity=- generated=-
COLUMN public.entidad.document_type type=public.document_type not_null=true default='SIN_DOCUMENTO'::public.document_type identity=- generated=-
COLUMN public.entidad.id type=uuid not_null=true default=gen_random_uuid() identity=- generated=-
COLUMN public.entidad.is_client type=boolean not_null=true default=false identity=- generated=-
COLUMN public.entidad.is_supplier type=boolean not_null=true default=false identity=- generated=-
COLUMN public.entidad.management_email type=text not_null=true default=''::text identity=- generated=-
COLUMN public.entidad.name type=text not_null=true default=- identity=- generated=-
COLUMN public.entidad.owner_id type=uuid not_null=true default=auth.uid() identity=- generated=-
COLUMN public.entidad.phone type=text not_null=true default=''::text identity=- generated=-
COLUMN public.entidad.updated_at type=timestamp with time zone not_null=true default=now() identity=- generated=-
COLUMN public.payment.amount type=numeric(12,2) not_null=true default=- identity=- generated=-
COLUMN public.payment.cash_account_id type=uuid not_null=true default=- identity=- generated=-
COLUMN public.payment.category_id type=uuid not_null=true default=- identity=- generated=-
COLUMN public.payment.created_at type=timestamp with time zone not_null=true default=now() identity=- generated=-
COLUMN public.payment.direction type=public.payment_direction not_null=true default=- identity=- generated=-
COLUMN public.payment.entity_id type=uuid not_null=false default=- identity=- generated=-
COLUMN public.payment.id type=uuid not_null=true default=gen_random_uuid() identity=- generated=-
COLUMN public.payment.is_cash_movement type=boolean not_null=true default=false identity=- generated=-
COLUMN public.payment.method_id type=uuid not_null=true default=- identity=- generated=-
COLUMN public.payment.notes type=text not_null=false default=- identity=- generated=-
COLUMN public.payment.owner_id type=uuid not_null=true default=auth.uid() identity=- generated=-
COLUMN public.payment.payment_date type=date not_null=true default=- identity=- generated=-
COLUMN public.payment.receipt_number type=text not_null=false default=(( CASE WHEN (direction = 'INGRESO'::public.payment_direction) THEN 'RI'::text ELSE 'RE'::text END || '-'::text) || lpad((receipt_serial)::text, 6, '0'::text)) identity=- generated=s
COLUMN public.payment.receipt_serial type=integer not_null=true default=- identity=- generated=-
COLUMN public.payment.reference type=text not_null=false default=- identity=- generated=-
COLUMN public.payment.status type=public.payment_status not_null=true default='EN_REVISION'::public.payment_status identity=- generated=-
COLUMN public.payment.updated_at type=timestamp with time zone not_null=true default=now() identity=- generated=-
COLUMN public.payment.void_reason type=text not_null=false default=- identity=- generated=-
COLUMN public.payment.voided_at type=timestamp with time zone not_null=false default=- identity=- generated=-
COLUMN public.payment_allocation.amount type=numeric(12,2) not_null=true default=- identity=- generated=-
COLUMN public.payment_allocation.comprobante_id type=uuid not_null=true default=- identity=- generated=-
COLUMN public.payment_allocation.created_at type=timestamp with time zone not_null=true default=now() identity=- generated=-
COLUMN public.payment_allocation.id type=uuid not_null=true default=gen_random_uuid() identity=- generated=-
COLUMN public.payment_allocation.owner_id type=uuid not_null=true default=auth.uid() identity=- generated=-
COLUMN public.payment_allocation.payment_id type=uuid not_null=true default=- identity=- generated=-
COLUMN public.payment_balance.amount type=numeric(12,2) not_null=false default=- identity=- generated=-
COLUMN public.payment_balance.assigned_amount type=numeric(12,2) not_null=false default=- identity=- generated=-
COLUMN public.payment_balance.direction type=public.payment_direction not_null=false default=- identity=- generated=-
COLUMN public.payment_balance.entity_id type=uuid not_null=false default=- identity=- generated=-
COLUMN public.payment_balance.payment_id type=uuid not_null=false default=- identity=- generated=-
COLUMN public.payment_balance.status type=public.payment_status not_null=false default=- identity=- generated=-
COLUMN public.payment_balance.unassigned_amount type=numeric(12,2) not_null=false default=- identity=- generated=-
COLUMN public.payment_method.code type=text not_null=true default=- identity=- generated=-
COLUMN public.payment_method.created_at type=timestamp with time zone not_null=true default=now() identity=- generated=-
COLUMN public.payment_method.id type=uuid not_null=true default=gen_random_uuid() identity=- generated=-
COLUMN public.payment_method.is_active type=boolean not_null=true default=true identity=- generated=-
COLUMN public.payment_method.name type=text not_null=true default=- identity=- generated=-
COLUMN public.payment_method.owner_id type=uuid not_null=true default=auth.uid() identity=- generated=-
COLUMN public.petty_cash_vale.account_id type=uuid not_null=true default=- identity=- generated=-
COLUMN public.petty_cash_vale.amount type=numeric(12,2) not_null=true default=- identity=- generated=-
COLUMN public.petty_cash_vale.concept type=character varying(300) not_null=true default=- identity=- generated=-
COLUMN public.petty_cash_vale.created_at type=timestamp with time zone not_null=true default=now() identity=- generated=-
COLUMN public.petty_cash_vale.has_receipt type=boolean not_null=true default=false identity=- generated=-
COLUMN public.petty_cash_vale.id type=uuid not_null=true default=gen_random_uuid() identity=- generated=-
COLUMN public.petty_cash_vale.owner_id type=uuid not_null=true default=auth.uid() identity=- generated=-
COLUMN public.petty_cash_vale.paid_to type=character varying(200) not_null=true default=- identity=- generated=-
COLUMN public.petty_cash_vale.payment_id type=uuid not_null=false default=- identity=- generated=-
COLUMN public.petty_cash_vale.serial type=integer not_null=true default=- identity=- generated=-
COLUMN public.petty_cash_vale.status type=public.vale_status not_null=true default='PENDIENTE'::public.vale_status identity=- generated=-
COLUMN public.petty_cash_vale.vale_date type=date not_null=true default=CURRENT_DATE identity=- generated=-
COLUMN public.receipt_sequence.direction type=public.payment_direction not_null=true default=- identity=- generated=-
COLUMN public.receipt_sequence.last_serial type=integer not_null=true default=0 identity=- generated=-
COLUMN public.voucher_balance.balance type=numeric(12,2) not_null=false default=- identity=- generated=-
COLUMN public.voucher_balance.comprobante_id type=uuid not_null=false default=- identity=- generated=-
COLUMN public.voucher_balance.credit_amount type=numeric(12,2) not_null=false default=- identity=- generated=-
COLUMN public.voucher_balance.debit_amount type=numeric(12,2) not_null=false default=- identity=- generated=-
COLUMN public.voucher_balance.effective_due_date type=date not_null=false default=- identity=- generated=-
COLUMN public.voucher_balance.entity_id type=uuid not_null=false default=- identity=- generated=-
COLUMN public.voucher_balance.issue_date type=date not_null=false default=- identity=- generated=-
COLUMN public.voucher_balance.paid_amount type=numeric(12,2) not_null=false default=- identity=- generated=-
COLUMN public.voucher_balance.payment_type type=public.payment_type not_null=false default=- identity=- generated=-
COLUMN public.voucher_balance.status type=public.comprobante_status not_null=false default=- identity=- generated=-
COLUMN public.voucher_balance.total type=numeric(12,2) not_null=false default=- identity=- generated=-
COLUMN public.voucher_balance.voucher_kind type=public.voucher_kind not_null=false default=- identity=- generated=-
COLUMN public.voucher_balance.voucher_number type=text not_null=false default=- identity=- generated=-
COLUMN public.voucher_balance.voucher_type type=public.voucher_type not_null=false default=- identity=- generated=-
COLUMN public.voucher_series.code type=text not_null=true default=- identity=- generated=-
COLUMN public.voucher_series.created_at type=timestamp with time zone not_null=true default=now() identity=- generated=-
COLUMN public.voucher_series.deleted_at type=timestamp with time zone not_null=false default=- identity=- generated=-
COLUMN public.voucher_series.id type=uuid not_null=true default=gen_random_uuid() identity=- generated=-
COLUMN public.voucher_series.is_default type=boolean not_null=true default=false identity=- generated=-
COLUMN public.voucher_series.last_number type=integer not_null=true default=0 identity=- generated=-
COLUMN public.voucher_series.owner_id type=uuid not_null=true default=auth.uid() identity=- generated=-
COLUMN public.voucher_series.updated_at type=timestamp with time zone not_null=true default=now() identity=- generated=-
COLUMN public.voucher_series.voucher_type type=public.voucher_type not_null=true default=- identity=- generated=-

ENUMS
ENUM public.cash_account_type definition=CASH_BOX,BANK_ACCOUNT
ENUM public.closing_periodicity definition=DAILY,WEEKLY,MONTHLY
ENUM public.comprobante_status definition=PAGADO,PENDIENTE
ENUM public.document_type definition=SIN_DOCUMENTO,RUC,DNI,CARNET_EXTRANJERIA
ENUM public.payment_direction definition=INGRESO,EGRESO
ENUM public.payment_status definition=EN_REVISION,PROCESADO,ANULADO
ENUM public.payment_type definition=CONTADO,CREDITO
ENUM public.reconciliation_item_kind definition=DEPOSITO_EN_TRANSITO,PAGO_NO_DEBITADO,CARGO_NO_REGISTRADO,ABONO_NO_REGISTRADO
ENUM public.vale_status definition=PENDIENTE,REPUESTO,ANULADO
ENUM public.voucher_kind definition=COMPRA,VENTA
ENUM public.voucher_type definition=FACTURA,BOLETA,NOTA_VENTA,NOTA_CREDITO,NOTA_DEBITO,COMPROBANTE_RETENCION

CONSTRAINTS
CONSTRAINT auth.account account_account_id_not_null type=n validated=true definition=NOT NULL account_id
CONSTRAINT auth.account account_created_at_not_null type=n validated=true definition=NOT NULL created_at
CONSTRAINT auth.account account_id_not_null type=n validated=true definition=NOT NULL id
CONSTRAINT auth.account account_pkey type=p validated=true definition=PRIMARY KEY (id)
CONSTRAINT auth.account account_provider_id_not_null type=n validated=true definition=NOT NULL provider_id
CONSTRAINT auth.account account_updated_at_not_null type=n validated=true definition=NOT NULL updated_at
CONSTRAINT auth.account account_user_id_fkey type=f validated=true definition=FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
CONSTRAINT auth.account account_user_id_not_null type=n validated=true definition=NOT NULL user_id
CONSTRAINT auth.session session_created_at_not_null type=n validated=true definition=NOT NULL created_at
CONSTRAINT auth.session session_expires_at_not_null type=n validated=true definition=NOT NULL expires_at
CONSTRAINT auth.session session_id_not_null type=n validated=true definition=NOT NULL id
CONSTRAINT auth.session session_pkey type=p validated=true definition=PRIMARY KEY (id)
CONSTRAINT auth.session session_token_key type=u validated=true definition=UNIQUE (token)
CONSTRAINT auth.session session_token_not_null type=n validated=true definition=NOT NULL token
CONSTRAINT auth.session session_updated_at_not_null type=n validated=true definition=NOT NULL updated_at
CONSTRAINT auth.session session_user_id_fkey type=f validated=true definition=FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
CONSTRAINT auth.session session_user_id_not_null type=n validated=true definition=NOT NULL user_id
CONSTRAINT auth.users users_created_at_not_null type=n validated=true definition=NOT NULL created_at
CONSTRAINT auth.users users_email_not_null type=n validated=true definition=NOT NULL email
CONSTRAINT auth.users users_email_verified_not_null type=n validated=true definition=NOT NULL email_verified
CONSTRAINT auth.users users_id_not_null type=n validated=true definition=NOT NULL id
CONSTRAINT auth.users users_pkey type=p validated=true definition=PRIMARY KEY (id)
CONSTRAINT auth.users users_updated_at_not_null type=n validated=true definition=NOT NULL updated_at
CONSTRAINT auth.verification verification_created_at_not_null type=n validated=true definition=NOT NULL created_at
CONSTRAINT auth.verification verification_expires_at_not_null type=n validated=true definition=NOT NULL expires_at
CONSTRAINT auth.verification verification_id_not_null type=n validated=true definition=NOT NULL id
CONSTRAINT auth.verification verification_identifier_not_null type=n validated=true definition=NOT NULL identifier
CONSTRAINT auth.verification verification_pkey type=p validated=true definition=PRIMARY KEY (id)
CONSTRAINT auth.verification verification_updated_at_not_null type=n validated=true definition=NOT NULL updated_at
CONSTRAINT auth.verification verification_value_not_null type=n validated=true definition=NOT NULL value
CONSTRAINT public.__sql_migrations __sql_migrations_applied_at_not_null type=n validated=true definition=NOT NULL applied_at
CONSTRAINT public.__sql_migrations __sql_migrations_name_not_null type=n validated=true definition=NOT NULL name
CONSTRAINT public.__sql_migrations __sql_migrations_pkey type=p validated=true definition=PRIMARY KEY (name)
CONSTRAINT public.app_setting app_setting_key_not_null type=n validated=true definition=NOT NULL key
CONSTRAINT public.app_setting app_setting_owner_id_not_null type=n validated=true definition=NOT NULL owner_id
CONSTRAINT public.app_setting app_setting_pkey type=p validated=true definition=PRIMARY KEY (owner_id, key)
CONSTRAINT public.app_setting app_setting_updated_at_not_null type=n validated=true definition=NOT NULL updated_at
CONSTRAINT public.app_setting app_setting_value_not_null type=n validated=true definition=NOT NULL value
CONSTRAINT public.bank_reconciliation bank_reconciliation_books_balance_not_null type=n validated=true definition=NOT NULL books_balance
CONSTRAINT public.bank_reconciliation bank_reconciliation_cash_account_id_fkey type=f validated=true definition=FOREIGN KEY (cash_account_id) REFERENCES public.cash_account(id)
CONSTRAINT public.bank_reconciliation bank_reconciliation_cash_account_id_not_null type=n validated=true definition=NOT NULL cash_account_id
CONSTRAINT public.bank_reconciliation bank_reconciliation_created_at_not_null type=n validated=true definition=NOT NULL created_at
CONSTRAINT public.bank_reconciliation bank_reconciliation_id_not_null type=n validated=true definition=NOT NULL id
CONSTRAINT public.bank_reconciliation bank_reconciliation_owner_id_fkey type=f validated=true definition=FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE
CONSTRAINT public.bank_reconciliation bank_reconciliation_owner_id_not_null type=n validated=true definition=NOT NULL owner_id
CONSTRAINT public.bank_reconciliation bank_reconciliation_period_check type=c validated=true definition=CHECK ((period_end >= period_start))
CONSTRAINT public.bank_reconciliation bank_reconciliation_period_end_not_null type=n validated=true definition=NOT NULL period_end
CONSTRAINT public.bank_reconciliation bank_reconciliation_period_start_not_null type=n validated=true definition=NOT NULL period_start
CONSTRAINT public.bank_reconciliation bank_reconciliation_period_unique type=u validated=true definition=UNIQUE (cash_account_id, period_start, period_end)
CONSTRAINT public.bank_reconciliation bank_reconciliation_pkey type=p validated=true definition=PRIMARY KEY (id)
CONSTRAINT public.bank_reconciliation bank_reconciliation_statement_balance_not_null type=n validated=true definition=NOT NULL statement_balance
CONSTRAINT public.bank_reconciliation bank_reconciliation_updated_at_not_null type=n validated=true definition=NOT NULL updated_at
CONSTRAINT public.bank_reconciliation_item bank_reconciliation_item_amount_check type=c validated=true definition=CHECK ((amount > (0)::numeric))
CONSTRAINT public.bank_reconciliation_item bank_reconciliation_item_amount_not_null type=n validated=true definition=NOT NULL amount
CONSTRAINT public.bank_reconciliation_item bank_reconciliation_item_created_at_not_null type=n validated=true definition=NOT NULL created_at
CONSTRAINT public.bank_reconciliation_item bank_reconciliation_item_description_check type=c validated=true definition=CHECK ((char_length(btrim(description)) >= 1))
CONSTRAINT public.bank_reconciliation_item bank_reconciliation_item_description_not_null type=n validated=true definition=NOT NULL description
CONSTRAINT public.bank_reconciliation_item bank_reconciliation_item_id_not_null type=n validated=true definition=NOT NULL id
CONSTRAINT public.bank_reconciliation_item bank_reconciliation_item_kind_not_null type=n validated=true definition=NOT NULL kind
CONSTRAINT public.bank_reconciliation_item bank_reconciliation_item_pkey type=p validated=true definition=PRIMARY KEY (id)
CONSTRAINT public.bank_reconciliation_item bank_reconciliation_item_reconciliation_id_fkey type=f validated=true definition=FOREIGN KEY (reconciliation_id) REFERENCES public.bank_reconciliation(id) ON DELETE CASCADE
CONSTRAINT public.bank_reconciliation_item bank_reconciliation_item_reconciliation_id_not_null type=n validated=true definition=NOT NULL reconciliation_id
CONSTRAINT public.cash_account cash_account_bank_requires_name type=c validated=true definition=CHECK ((((type = 'BANK_ACCOUNT'::public.cash_account_type) AND (bank_name IS NOT NULL) AND (char_length(bank_name) >= 1)) OR ((type = 'CASH_BOX'::public.cash_account_type) AND (bank_name IS NULL) AND (account_number IS NULL) AND (cci IS NULL))))
CONSTRAINT public.cash_account cash_account_change_fund_check type=c validated=true definition=CHECK ((change_fund >= (0)::numeric))
CONSTRAINT public.cash_account cash_account_change_fund_not_null type=n validated=true definition=NOT NULL change_fund
CONSTRAINT public.cash_account cash_account_created_at_not_null type=n validated=true definition=NOT NULL created_at
CONSTRAINT public.cash_account cash_account_currency_not_null type=n validated=true definition=NOT NULL currency
CONSTRAINT public.cash_account cash_account_id_not_null type=n validated=true definition=NOT NULL id
CONSTRAINT public.cash_account cash_account_is_active_not_null type=n validated=true definition=NOT NULL is_active
CONSTRAINT public.cash_account cash_account_is_petty_cash_not_null type=n validated=true definition=NOT NULL is_petty_cash
CONSTRAINT public.cash_account cash_account_name_nonempty type=c validated=true definition=CHECK ((char_length(name) >= 1))
CONSTRAINT public.cash_account cash_account_name_not_null type=n validated=true definition=NOT NULL name
CONSTRAINT public.cash_account cash_account_opening_balance_date_not_null type=n validated=true definition=NOT NULL opening_balance_date
CONSTRAINT public.cash_account cash_account_opening_balance_nonnegative type=c validated=true definition=CHECK ((opening_balance >= (0)::numeric))
CONSTRAINT public.cash_account cash_account_opening_balance_not_null type=n validated=true definition=NOT NULL opening_balance
CONSTRAINT public.cash_account cash_account_owner_id_fkey type=f validated=true definition=FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE
CONSTRAINT public.cash_account cash_account_owner_id_not_null type=n validated=true definition=NOT NULL owner_id
CONSTRAINT public.cash_account cash_account_petty_cash_type_check type=c validated=true definition=CHECK (((NOT is_petty_cash) OR (type = 'CASH_BOX'::public.cash_account_type)))
CONSTRAINT public.cash_account cash_account_petty_expense_limit_check type=c validated=true definition=CHECK (((petty_expense_limit IS NULL) OR (petty_expense_limit > (0)::numeric)))
CONSTRAINT public.cash_account cash_account_pkey type=p validated=true definition=PRIMARY KEY (id)
CONSTRAINT public.cash_account cash_account_type_not_null type=n validated=true definition=NOT NULL type
CONSTRAINT public.cash_account cash_account_updated_at_not_null type=n validated=true definition=NOT NULL updated_at
CONSTRAINT public.cash_close cash_close_cash_account_id_fkey type=f validated=true definition=FOREIGN KEY (cash_account_id) REFERENCES public.cash_account(id)
CONSTRAINT public.cash_close cash_close_cash_account_id_not_null type=n validated=true definition=NOT NULL cash_account_id
CONSTRAINT public.cash_close cash_close_cash_account_id_period_end_key type=u validated=true definition=UNIQUE (cash_account_id, period_end)
CONSTRAINT public.cash_close cash_close_counted_check type=c validated=true definition=CHECK ((((counted_balance IS NULL) AND (difference IS NULL)) OR ((counted_balance IS NOT NULL) AND (difference IS NOT NULL))))
CONSTRAINT public.cash_close cash_close_created_at_not_null type=n validated=true definition=NOT NULL created_at
CONSTRAINT public.cash_close cash_close_expected_balance_not_null type=n validated=true definition=NOT NULL expected_balance
CONSTRAINT public.cash_close cash_close_expense_total_not_null type=n validated=true definition=NOT NULL expense_total
CONSTRAINT public.cash_close cash_close_id_not_null type=n validated=true definition=NOT NULL id
CONSTRAINT public.cash_close cash_close_income_total_not_null type=n validated=true definition=NOT NULL income_total
CONSTRAINT public.cash_close cash_close_opening_balance_not_null type=n validated=true definition=NOT NULL opening_balance
CONSTRAINT public.cash_close cash_close_owner_id_not_null type=n validated=true definition=NOT NULL owner_id
CONSTRAINT public.cash_close cash_close_period_check type=c validated=true definition=CHECK ((period_start <= period_end))
CONSTRAINT public.cash_close cash_close_period_end_not_null type=n validated=true definition=NOT NULL period_end
CONSTRAINT public.cash_close cash_close_period_start_not_null type=n validated=true definition=NOT NULL period_start
CONSTRAINT public.cash_close cash_close_periodicity_not_null type=n validated=true definition=NOT NULL periodicity
CONSTRAINT public.cash_close cash_close_pkey type=p validated=true definition=PRIMARY KEY (id)
CONSTRAINT public.cash_close cash_close_transfer_in_total_not_null type=n validated=true definition=NOT NULL transfer_in_total
CONSTRAINT public.cash_close cash_close_transfer_out_total_not_null type=n validated=true definition=NOT NULL transfer_out_total
CONSTRAINT public.cash_close_denomination cash_close_denomination_cash_close_id_fkey type=f validated=true definition=FOREIGN KEY (cash_close_id) REFERENCES public.cash_close(id) ON DELETE CASCADE
CONSTRAINT public.cash_close_denomination cash_close_denomination_cash_close_id_not_null type=n validated=true definition=NOT NULL cash_close_id
CONSTRAINT public.cash_close_denomination cash_close_denomination_denomination_not_null type=n validated=true definition=NOT NULL denomination
CONSTRAINT public.cash_close_denomination cash_close_denomination_id_not_null type=n validated=true definition=NOT NULL id
CONSTRAINT public.cash_close_denomination cash_close_denomination_pkey type=p validated=true definition=PRIMARY KEY (id)
CONSTRAINT public.cash_close_denomination cash_close_denomination_quantity_check type=c validated=true definition=CHECK ((quantity >= 0))
CONSTRAINT public.cash_close_denomination cash_close_denomination_quantity_not_null type=n validated=true definition=NOT NULL quantity
CONSTRAINT public.cash_close_denomination cash_close_denomination_unique type=u validated=true definition=UNIQUE (cash_close_id, denomination)
CONSTRAINT public.cash_close_denomination cash_close_denomination_value_check type=c validated=true definition=CHECK ((denomination = ANY (ARRAY[(200)::numeric, (100)::numeric, (50)::numeric, (20)::numeric, (10)::numeric, (5)::numeric, (2)::numeric, (1)::numeric, 0.50, 0.20, 0.10])))
CONSTRAINT public.cash_count cash_count_cash_account_id_fkey type=f validated=true definition=FOREIGN KEY (cash_account_id) REFERENCES public.cash_account(id)
CONSTRAINT public.cash_count cash_count_cash_account_id_not_null type=n validated=true definition=NOT NULL cash_account_id
CONSTRAINT public.cash_count cash_count_count_date_not_null type=n validated=true definition=NOT NULL count_date
CONSTRAINT public.cash_count cash_count_counted_balance_not_null type=n validated=true definition=NOT NULL counted_balance
CONSTRAINT public.cash_count cash_count_counted_check type=c validated=true definition=CHECK ((counted_balance >= (0)::numeric))
CONSTRAINT public.cash_count cash_count_created_at_not_null type=n validated=true definition=NOT NULL created_at
CONSTRAINT public.cash_count cash_count_difference_not_null type=n validated=true definition=NOT NULL difference
CONSTRAINT public.cash_count cash_count_expected_balance_not_null type=n validated=true definition=NOT NULL expected_balance
CONSTRAINT public.cash_count cash_count_id_not_null type=n validated=true definition=NOT NULL id
CONSTRAINT public.cash_count cash_count_is_surprise_not_null type=n validated=true definition=NOT NULL is_surprise
CONSTRAINT public.cash_count cash_count_owner_id_fkey type=f validated=true definition=FOREIGN KEY (owner_id) REFERENCES auth.users(id)
CONSTRAINT public.cash_count cash_count_owner_id_not_null type=n validated=true definition=NOT NULL owner_id
CONSTRAINT public.cash_count cash_count_pkey type=p validated=true definition=PRIMARY KEY (id)
CONSTRAINT public.cash_count_denomination cash_count_denomination_cash_count_id_fkey type=f validated=true definition=FOREIGN KEY (cash_count_id) REFERENCES public.cash_count(id) ON DELETE CASCADE
CONSTRAINT public.cash_count_denomination cash_count_denomination_cash_count_id_not_null type=n validated=true definition=NOT NULL cash_count_id
CONSTRAINT public.cash_count_denomination cash_count_denomination_denomination_not_null type=n validated=true definition=NOT NULL denomination
CONSTRAINT public.cash_count_denomination cash_count_denomination_id_not_null type=n validated=true definition=NOT NULL id
CONSTRAINT public.cash_count_denomination cash_count_denomination_pkey type=p validated=true definition=PRIMARY KEY (id)
CONSTRAINT public.cash_count_denomination cash_count_denomination_quantity_check type=c validated=true definition=CHECK ((quantity >= 0))
CONSTRAINT public.cash_count_denomination cash_count_denomination_quantity_not_null type=n validated=true definition=NOT NULL quantity
CONSTRAINT public.cash_count_denomination cash_count_denomination_unique type=u validated=true definition=UNIQUE (cash_count_id, denomination)
CONSTRAINT public.cash_count_denomination cash_count_denomination_value_check type=c validated=true definition=CHECK ((denomination = ANY (ARRAY[(200)::numeric, (100)::numeric, (50)::numeric, (20)::numeric, (10)::numeric, (5)::numeric, (2)::numeric, (1)::numeric, 0.50, 0.20, 0.10])))
CONSTRAINT public.cash_receipt_category cash_receipt_category_code_not_null type=n validated=true definition=NOT NULL code
CONSTRAINT public.cash_receipt_category cash_receipt_category_created_at_not_null type=n validated=true definition=NOT NULL created_at
CONSTRAINT public.cash_receipt_category cash_receipt_category_direction_not_null type=n validated=true definition=NOT NULL direction
CONSTRAINT public.cash_receipt_category cash_receipt_category_id_not_null type=n validated=true definition=NOT NULL id
CONSTRAINT public.cash_receipt_category cash_receipt_category_is_active_not_null type=n validated=true definition=NOT NULL is_active
CONSTRAINT public.cash_receipt_category cash_receipt_category_name_not_null type=n validated=true definition=NOT NULL name
CONSTRAINT public.cash_receipt_category cash_receipt_category_owner_id_direction_name_key type=u validated=true definition=UNIQUE (owner_id, direction, name)
CONSTRAINT public.cash_receipt_category cash_receipt_category_owner_id_not_null type=n validated=true definition=NOT NULL owner_id
CONSTRAINT public.cash_receipt_category cash_receipt_category_pkey type=p validated=true definition=PRIMARY KEY (id)
CONSTRAINT public.cash_transfer cash_transfer_amount_not_null type=n validated=true definition=NOT NULL amount
CONSTRAINT public.cash_transfer cash_transfer_amount_positive type=c validated=true definition=CHECK ((amount > (0)::numeric))
CONSTRAINT public.cash_transfer cash_transfer_created_at_not_null type=n validated=true definition=NOT NULL created_at
CONSTRAINT public.cash_transfer cash_transfer_distinct_accounts type=c validated=true definition=CHECK ((source_account_id <> target_account_id))
CONSTRAINT public.cash_transfer cash_transfer_id_not_null type=n validated=true definition=NOT NULL id
CONSTRAINT public.cash_transfer cash_transfer_owner_id_not_null type=n validated=true definition=NOT NULL owner_id
CONSTRAINT public.cash_transfer cash_transfer_pkey type=p validated=true definition=PRIMARY KEY (id)
CONSTRAINT public.cash_transfer cash_transfer_source_account_id_fkey type=f validated=true definition=FOREIGN KEY (source_account_id) REFERENCES public.cash_account(id)
CONSTRAINT public.cash_transfer cash_transfer_source_account_id_not_null type=n validated=true definition=NOT NULL source_account_id
CONSTRAINT public.cash_transfer cash_transfer_target_account_id_fkey type=f validated=true definition=FOREIGN KEY (target_account_id) REFERENCES public.cash_account(id)
CONSTRAINT public.cash_transfer cash_transfer_target_account_id_not_null type=n validated=true definition=NOT NULL target_account_id
CONSTRAINT public.cash_transfer cash_transfer_transfer_date_not_null type=n validated=true definition=NOT NULL transfer_date
CONSTRAINT public.comprobante comprobante_ajuste_check type=c validated=true definition=CHECK ( CASE WHEN (voucher_type = ANY (ARRAY['NOTA_CREDITO'::public.voucher_type, 'NOTA_DEBITO'::public.voucher_type])) THEN ((referenced_comprobante_id IS NOT NULL) AND (motive_code IS NOT NULL)) WHEN (voucher_type = 'COMPROBANTE_RETENCION'::public.voucher_type) THEN ((referenced_comprobante_id IS NOT NULL) AND (motive_code IS NULL)) ELSE ((referenced_comprobante_id IS NULL) AND (motive_code IS NULL)) END)
CONSTRAINT public.comprobante comprobante_created_at_not_null type=n validated=true definition=NOT NULL created_at
CONSTRAINT public.comprobante comprobante_credit_days type=c validated=true definition=CHECK ((((payment_type = 'CREDITO'::public.payment_type) AND (credit_days IS NOT NULL) AND (credit_days >= 1)) OR ((payment_type = 'CONTADO'::public.payment_type) AND (credit_days IS NULL))))
CONSTRAINT public.comprobante comprobante_entity_id_fkey type=f validated=true definition=FOREIGN KEY (entity_id) REFERENCES public.entidad(id)
CONSTRAINT public.comprobante comprobante_entity_id_not_null type=n validated=true definition=NOT NULL entity_id
CONSTRAINT public.comprobante comprobante_id_not_null type=n validated=true definition=NOT NULL id
CONSTRAINT public.comprobante comprobante_igv_not_null type=n validated=true definition=NOT NULL igv
CONSTRAINT public.comprobante comprobante_issue_date_not_null type=n validated=true definition=NOT NULL issue_date
CONSTRAINT public.comprobante comprobante_owner_id_fkey type=f validated=true definition=FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE
CONSTRAINT public.comprobante comprobante_owner_id_not_null type=n validated=true definition=NOT NULL owner_id
CONSTRAINT public.comprobante comprobante_payment_type_not_null type=n validated=true definition=NOT NULL payment_type
CONSTRAINT public.comprobante comprobante_pkey type=p validated=true definition=PRIMARY KEY (id)
CONSTRAINT public.comprobante comprobante_referenced_comprobante_id_fkey type=f validated=true definition=FOREIGN KEY (referenced_comprobante_id) REFERENCES public.comprobante(id)
CONSTRAINT public.comprobante comprobante_registration_date_not_null type=n validated=true definition=NOT NULL registration_date
CONSTRAINT public.comprobante comprobante_status_not_null type=n validated=true definition=NOT NULL status
CONSTRAINT public.comprobante comprobante_subtotal_not_null type=n validated=true definition=NOT NULL subtotal
CONSTRAINT public.comprobante comprobante_total_check type=c validated=true definition=CHECK ((total > (0)::numeric))
CONSTRAINT public.comprobante comprobante_total_not_null type=n validated=true definition=NOT NULL total
CONSTRAINT public.comprobante comprobante_updated_at_not_null type=n validated=true definition=NOT NULL updated_at
CONSTRAINT public.comprobante comprobante_voucher_kind_not_null type=n validated=true definition=NOT NULL voucher_kind
CONSTRAINT public.comprobante comprobante_voucher_number_not_null type=n validated=true definition=NOT NULL voucher_number
CONSTRAINT public.comprobante comprobante_voucher_type_not_null type=n validated=true definition=NOT NULL voucher_type
CONSTRAINT public.entidad entidad_address_not_null type=n validated=true definition=NOT NULL address
CONSTRAINT public.entidad entidad_billing_email_not_null type=n validated=true definition=NOT NULL billing_email
CONSTRAINT public.entidad entidad_contact_name_not_null type=n validated=true definition=NOT NULL contact_name
CONSTRAINT public.entidad entidad_created_at_not_null type=n validated=true definition=NOT NULL created_at
CONSTRAINT public.entidad entidad_document_number_not_null type=n validated=true definition=NOT NULL document_number
CONSTRAINT public.entidad entidad_document_type_not_null type=n validated=true definition=NOT NULL document_type
CONSTRAINT public.entidad entidad_document_type_required type=c validated=true definition=CHECK ((((document_type = 'SIN_DOCUMENTO'::public.document_type) AND (document_number = ''::text)) OR ((document_type <> 'SIN_DOCUMENTO'::public.document_type) AND (length(TRIM(BOTH FROM document_number)) > 0))))
CONSTRAINT public.entidad entidad_id_not_null type=n validated=true definition=NOT NULL id
CONSTRAINT public.entidad entidad_is_client_not_null type=n validated=true definition=NOT NULL is_client
CONSTRAINT public.entidad entidad_is_supplier_not_null type=n validated=true definition=NOT NULL is_supplier
CONSTRAINT public.entidad entidad_management_email_not_null type=n validated=true definition=NOT NULL management_email
CONSTRAINT public.entidad entidad_name_not_null type=n validated=true definition=NOT NULL name
CONSTRAINT public.entidad entidad_owner_id_fkey type=f validated=true definition=FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE
CONSTRAINT public.entidad entidad_owner_id_not_null type=n validated=true definition=NOT NULL owner_id
CONSTRAINT public.entidad entidad_phone_not_null type=n validated=true definition=NOT NULL phone
CONSTRAINT public.entidad entidad_pkey type=p validated=true definition=PRIMARY KEY (id)
CONSTRAINT public.entidad entidad_some_role type=c validated=true definition=CHECK ((is_client OR is_supplier))
CONSTRAINT public.entidad entidad_updated_at_not_null type=n validated=true definition=NOT NULL updated_at
CONSTRAINT public.payment payment_amount_check type=c validated=true definition=CHECK ((amount > (0)::numeric))
CONSTRAINT public.payment payment_amount_not_null type=n validated=true definition=NOT NULL amount
CONSTRAINT public.payment payment_cash_account_id_fkey type=f validated=true definition=FOREIGN KEY (cash_account_id) REFERENCES public.cash_account(id)
CONSTRAINT public.payment payment_cash_account_id_not_null type=n validated=true definition=NOT NULL cash_account_id
CONSTRAINT public.payment payment_category_id_fkey type=f validated=true definition=FOREIGN KEY (category_id) REFERENCES public.cash_receipt_category(id)
CONSTRAINT public.payment payment_category_id_not_null type=n validated=true definition=NOT NULL category_id
CONSTRAINT public.payment payment_created_at_not_null type=n validated=true definition=NOT NULL created_at
CONSTRAINT public.payment payment_direction_not_null type=n validated=true definition=NOT NULL direction
CONSTRAINT public.payment payment_entity_id_fkey type=f validated=true definition=FOREIGN KEY (entity_id) REFERENCES public.entidad(id)
CONSTRAINT public.payment payment_id_not_null type=n validated=true definition=NOT NULL id
CONSTRAINT public.payment payment_is_cash_movement_not_null type=n validated=true definition=NOT NULL is_cash_movement
CONSTRAINT public.payment payment_method_id_fkey type=f validated=true definition=FOREIGN KEY (method_id) REFERENCES public.payment_method(id)
CONSTRAINT public.payment payment_method_id_not_null1 type=n validated=true definition=NOT NULL method_id
CONSTRAINT public.payment payment_owner_id_fkey type=f validated=true definition=FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE
CONSTRAINT public.payment payment_owner_id_not_null type=n validated=true definition=NOT NULL owner_id
CONSTRAINT public.payment payment_payment_date_not_null type=n validated=true definition=NOT NULL payment_date
CONSTRAINT public.payment payment_pkey type=p validated=true definition=PRIMARY KEY (id)
CONSTRAINT public.payment payment_receipt_serial_not_null type=n validated=true definition=NOT NULL receipt_serial
CONSTRAINT public.payment payment_receipt_unique type=u validated=true definition=UNIQUE (direction, receipt_serial)
CONSTRAINT public.payment payment_status_not_null type=n validated=true definition=NOT NULL status
CONSTRAINT public.payment payment_updated_at_not_null type=n validated=true definition=NOT NULL updated_at
CONSTRAINT public.payment payment_void_check type=c validated=true definition=CHECK ((((status = 'ANULADO'::public.payment_status) AND (void_reason IS NOT NULL) AND (voided_at IS NOT NULL)) OR ((status = ANY (ARRAY['EN_REVISION'::public.payment_status, 'PROCESADO'::public.payment_status])) AND (void_reason IS NULL) AND (voided_at IS NULL))))
CONSTRAINT public.payment_allocation payment_allocation_amount_check type=c validated=true definition=CHECK ((amount > (0)::numeric))
CONSTRAINT public.payment_allocation payment_allocation_amount_not_null type=n validated=true definition=NOT NULL amount
CONSTRAINT public.payment_allocation payment_allocation_comprobante_id_fkey type=f validated=true definition=FOREIGN KEY (comprobante_id) REFERENCES public.comprobante(id)
CONSTRAINT public.payment_allocation payment_allocation_comprobante_id_not_null type=n validated=true definition=NOT NULL comprobante_id
CONSTRAINT public.payment_allocation payment_allocation_created_at_not_null type=n validated=true definition=NOT NULL created_at
CONSTRAINT public.payment_allocation payment_allocation_id_not_null type=n validated=true definition=NOT NULL id
CONSTRAINT public.payment_allocation payment_allocation_owner_id_fkey type=f validated=true definition=FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE
CONSTRAINT public.payment_allocation payment_allocation_owner_id_not_null type=n validated=true definition=NOT NULL owner_id
CONSTRAINT public.payment_allocation payment_allocation_payment_id_fkey type=f validated=true definition=FOREIGN KEY (payment_id) REFERENCES public.payment(id) ON DELETE RESTRICT
CONSTRAINT public.payment_allocation payment_allocation_payment_id_not_null type=n validated=true definition=NOT NULL payment_id
CONSTRAINT public.payment_allocation payment_allocation_pkey type=p validated=true definition=PRIMARY KEY (id)
CONSTRAINT public.payment_allocation payment_allocation_unique type=u validated=true definition=UNIQUE (payment_id, comprobante_id)
CONSTRAINT public.payment_method payment_method_code_not_null type=n validated=true definition=NOT NULL code
CONSTRAINT public.payment_method payment_method_created_at_not_null type=n validated=true definition=NOT NULL created_at
CONSTRAINT public.payment_method payment_method_id_not_null type=n validated=true definition=NOT NULL id
CONSTRAINT public.payment_method payment_method_is_active_not_null type=n validated=true definition=NOT NULL is_active
CONSTRAINT public.payment_method payment_method_name_not_null type=n validated=true definition=NOT NULL name
CONSTRAINT public.payment_method payment_method_owner_id_code_key type=u validated=true definition=UNIQUE (owner_id, code)
CONSTRAINT public.payment_method payment_method_owner_id_not_null type=n validated=true definition=NOT NULL owner_id
CONSTRAINT public.payment_method payment_method_pkey type=p validated=true definition=PRIMARY KEY (id)
CONSTRAINT public.petty_cash_vale petty_cash_vale_account_id_fkey type=f validated=true definition=FOREIGN KEY (account_id) REFERENCES public.cash_account(id)
CONSTRAINT public.petty_cash_vale petty_cash_vale_account_id_not_null type=n validated=true definition=NOT NULL account_id
CONSTRAINT public.petty_cash_vale petty_cash_vale_amount_check type=c validated=true definition=CHECK ((amount > (0)::numeric))
CONSTRAINT public.petty_cash_vale petty_cash_vale_amount_not_null type=n validated=true definition=NOT NULL amount
CONSTRAINT public.petty_cash_vale petty_cash_vale_concept_not_null type=n validated=true definition=NOT NULL concept
CONSTRAINT public.petty_cash_vale petty_cash_vale_created_at_not_null type=n validated=true definition=NOT NULL created_at
CONSTRAINT public.petty_cash_vale petty_cash_vale_has_receipt_not_null type=n validated=true definition=NOT NULL has_receipt
CONSTRAINT public.petty_cash_vale petty_cash_vale_id_not_null type=n validated=true definition=NOT NULL id
CONSTRAINT public.petty_cash_vale petty_cash_vale_owner_id_not_null type=n validated=true definition=NOT NULL owner_id
CONSTRAINT public.petty_cash_vale petty_cash_vale_paid_to_not_null type=n validated=true definition=NOT NULL paid_to
CONSTRAINT public.petty_cash_vale petty_cash_vale_payment_id_fkey type=f validated=true definition=FOREIGN KEY (payment_id) REFERENCES public.payment(id)
CONSTRAINT public.petty_cash_vale petty_cash_vale_pkey type=p validated=true definition=PRIMARY KEY (id)
CONSTRAINT public.petty_cash_vale petty_cash_vale_serial_check type=c validated=true definition=CHECK ((serial > 0))
CONSTRAINT public.petty_cash_vale petty_cash_vale_serial_not_null type=n validated=true definition=NOT NULL serial
CONSTRAINT public.petty_cash_vale petty_cash_vale_serial_unique type=u validated=true definition=UNIQUE (account_id, serial)
CONSTRAINT public.petty_cash_vale petty_cash_vale_status_not_null type=n validated=true definition=NOT NULL status
CONSTRAINT public.petty_cash_vale petty_cash_vale_vale_date_not_null type=n validated=true definition=NOT NULL vale_date
CONSTRAINT public.receipt_sequence receipt_sequence_direction_not_null type=n validated=true definition=NOT NULL direction
CONSTRAINT public.receipt_sequence receipt_sequence_last_serial_check type=c validated=true definition=CHECK ((last_serial >= 0))
CONSTRAINT public.receipt_sequence receipt_sequence_last_serial_not_null type=n validated=true definition=NOT NULL last_serial
CONSTRAINT public.receipt_sequence receipt_sequence_pkey type=p validated=true definition=PRIMARY KEY (direction)
CONSTRAINT public.voucher_series voucher_series_code_check type=c validated=true definition=CHECK ((code ~ '^[A-Za-z0-9]{1,4}$'::text))
CONSTRAINT public.voucher_series voucher_series_code_not_null type=n validated=true definition=NOT NULL code
CONSTRAINT public.voucher_series voucher_series_created_at_not_null type=n validated=true definition=NOT NULL created_at
CONSTRAINT public.voucher_series voucher_series_id_not_null type=n validated=true definition=NOT NULL id
CONSTRAINT public.voucher_series voucher_series_is_default_not_null type=n validated=true definition=NOT NULL is_default
CONSTRAINT public.voucher_series voucher_series_last_number_check type=c validated=true definition=CHECK ((last_number >= 0))
CONSTRAINT public.voucher_series voucher_series_last_number_not_null type=n validated=true definition=NOT NULL last_number
CONSTRAINT public.voucher_series voucher_series_owner_id_fkey type=f validated=true definition=FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE
CONSTRAINT public.voucher_series voucher_series_owner_id_not_null type=n validated=true definition=NOT NULL owner_id
CONSTRAINT public.voucher_series voucher_series_pkey type=p validated=true definition=PRIMARY KEY (id)
CONSTRAINT public.voucher_series voucher_series_updated_at_not_null type=n validated=true definition=NOT NULL updated_at
CONSTRAINT public.voucher_series voucher_series_voucher_type_not_null type=n validated=true definition=NOT NULL voucher_type

INDEXES
INDEX auth.account account_pkey unique=true valid=true definition=CREATE UNIQUE INDEX account_pkey ON auth.account USING btree (id)
INDEX auth.session session_pkey unique=true valid=true definition=CREATE UNIQUE INDEX session_pkey ON auth.session USING btree (id)
INDEX auth.session session_token_key unique=true valid=true definition=CREATE UNIQUE INDEX session_token_key ON auth.session USING btree (token)
INDEX auth.users auth_users_email_key unique=true valid=true definition=CREATE UNIQUE INDEX auth_users_email_key ON auth.users USING btree (lower(email))
INDEX auth.users users_pkey unique=true valid=true definition=CREATE UNIQUE INDEX users_pkey ON auth.users USING btree (id)
INDEX auth.verification verification_pkey unique=true valid=true definition=CREATE UNIQUE INDEX verification_pkey ON auth.verification USING btree (id)
INDEX public.__sql_migrations __sql_migrations_pkey unique=true valid=true definition=CREATE UNIQUE INDEX __sql_migrations_pkey ON public.__sql_migrations USING btree (name)
INDEX public.app_setting app_setting_pkey unique=true valid=true definition=CREATE UNIQUE INDEX app_setting_pkey ON public.app_setting USING btree (owner_id, key)
INDEX public.bank_reconciliation bank_reconciliation_owner_idx unique=false valid=true definition=CREATE INDEX bank_reconciliation_owner_idx ON public.bank_reconciliation USING btree (owner_id)
INDEX public.bank_reconciliation bank_reconciliation_period_unique unique=true valid=true definition=CREATE UNIQUE INDEX bank_reconciliation_period_unique ON public.bank_reconciliation USING btree (cash_account_id, period_start, period_end)
INDEX public.bank_reconciliation bank_reconciliation_pkey unique=true valid=true definition=CREATE UNIQUE INDEX bank_reconciliation_pkey ON public.bank_reconciliation USING btree (id)
INDEX public.bank_reconciliation_item bank_reconciliation_item_parent_idx unique=false valid=true definition=CREATE INDEX bank_reconciliation_item_parent_idx ON public.bank_reconciliation_item USING btree (reconciliation_id)
INDEX public.bank_reconciliation_item bank_reconciliation_item_pkey unique=true valid=true definition=CREATE UNIQUE INDEX bank_reconciliation_item_pkey ON public.bank_reconciliation_item USING btree (id)
INDEX public.cash_account cash_account_active_idx unique=false valid=true definition=CREATE INDEX cash_account_active_idx ON public.cash_account USING btree (is_active) WHERE (deleted_at IS NULL)
INDEX public.cash_account cash_account_deleted_at_idx unique=false valid=true definition=CREATE INDEX cash_account_deleted_at_idx ON public.cash_account USING btree (deleted_at)
INDEX public.cash_account cash_account_pkey unique=true valid=true definition=CREATE UNIQUE INDEX cash_account_pkey ON public.cash_account USING btree (id)
INDEX public.cash_account cash_account_type_idx unique=false valid=true definition=CREATE INDEX cash_account_type_idx ON public.cash_account USING btree (type)
INDEX public.cash_account idx_cash_account_owner_id unique=false valid=true definition=CREATE INDEX idx_cash_account_owner_id ON public.cash_account USING btree (owner_id)
INDEX public.cash_close cash_close_account_idx unique=false valid=true definition=CREATE INDEX cash_close_account_idx ON public.cash_close USING btree (cash_account_id, period_end DESC)
INDEX public.cash_close cash_close_cash_account_id_period_end_key unique=true valid=true definition=CREATE UNIQUE INDEX cash_close_cash_account_id_period_end_key ON public.cash_close USING btree (cash_account_id, period_end)
INDEX public.cash_close cash_close_pkey unique=true valid=true definition=CREATE UNIQUE INDEX cash_close_pkey ON public.cash_close USING btree (id)
INDEX public.cash_close_denomination cash_close_denomination_pkey unique=true valid=true definition=CREATE UNIQUE INDEX cash_close_denomination_pkey ON public.cash_close_denomination USING btree (id)
INDEX public.cash_close_denomination cash_close_denomination_unique unique=true valid=true definition=CREATE UNIQUE INDEX cash_close_denomination_unique ON public.cash_close_denomination USING btree (cash_close_id, denomination)
INDEX public.cash_count cash_count_account_date_idx unique=false valid=true definition=CREATE INDEX cash_count_account_date_idx ON public.cash_count USING btree (cash_account_id, count_date DESC)
INDEX public.cash_count cash_count_owner_id_idx unique=false valid=true definition=CREATE INDEX cash_count_owner_id_idx ON public.cash_count USING btree (owner_id)
INDEX public.cash_count cash_count_pkey unique=true valid=true definition=CREATE UNIQUE INDEX cash_count_pkey ON public.cash_count USING btree (id)
INDEX public.cash_count_denomination cash_count_denomination_pkey unique=true valid=true definition=CREATE UNIQUE INDEX cash_count_denomination_pkey ON public.cash_count_denomination USING btree (id)
INDEX public.cash_count_denomination cash_count_denomination_unique unique=true valid=true definition=CREATE UNIQUE INDEX cash_count_denomination_unique ON public.cash_count_denomination USING btree (cash_count_id, denomination)
INDEX public.cash_receipt_category cash_receipt_category_owner_id_code_key unique=true valid=true definition=CREATE UNIQUE INDEX cash_receipt_category_owner_id_code_key ON public.cash_receipt_category USING btree (owner_id, code)
INDEX public.cash_receipt_category cash_receipt_category_owner_id_direction_name_key unique=true valid=true definition=CREATE UNIQUE INDEX cash_receipt_category_owner_id_direction_name_key ON public.cash_receipt_category USING btree (owner_id, direction, name)
INDEX public.cash_receipt_category cash_receipt_category_pkey unique=true valid=true definition=CREATE UNIQUE INDEX cash_receipt_category_pkey ON public.cash_receipt_category USING btree (id)
INDEX public.cash_transfer cash_transfer_owner_date_idx unique=false valid=true definition=CREATE INDEX cash_transfer_owner_date_idx ON public.cash_transfer USING btree (owner_id, transfer_date DESC)
INDEX public.cash_transfer cash_transfer_pkey unique=true valid=true definition=CREATE UNIQUE INDEX cash_transfer_pkey ON public.cash_transfer USING btree (id)
INDEX public.cash_transfer cash_transfer_source_idx unique=false valid=true definition=CREATE INDEX cash_transfer_source_idx ON public.cash_transfer USING btree (source_account_id)
INDEX public.cash_transfer cash_transfer_target_idx unique=false valid=true definition=CREATE INDEX cash_transfer_target_idx ON public.cash_transfer USING btree (target_account_id)
INDEX public.comprobante comprobante_entity_idx unique=false valid=true definition=CREATE INDEX comprobante_entity_idx ON public.comprobante USING btree (entity_id) WHERE (deleted_at IS NULL)
INDEX public.comprobante comprobante_owner_kind_number_key unique=true valid=true definition=CREATE UNIQUE INDEX comprobante_owner_kind_number_key ON public.comprobante USING btree (owner_id, voucher_kind, voucher_number) WHERE (deleted_at IS NULL)
INDEX public.comprobante comprobante_pkey unique=true valid=true definition=CREATE UNIQUE INDEX comprobante_pkey ON public.comprobante USING btree (id)
INDEX public.comprobante comprobante_referenced_idx unique=false valid=true definition=CREATE INDEX comprobante_referenced_idx ON public.comprobante USING btree (referenced_comprobante_id) WHERE (referenced_comprobante_id IS NOT NULL)
INDEX public.comprobante comprobante_ventas_idx unique=false valid=true definition=CREATE INDEX comprobante_ventas_idx ON public.comprobante USING btree (issue_date DESC) WHERE ((voucher_kind = 'VENTA'::public.voucher_kind) AND (deleted_at IS NULL))
INDEX public.comprobante idx_comprobante_owner_id unique=false valid=true definition=CREATE INDEX idx_comprobante_owner_id ON public.comprobante USING btree (owner_id)
INDEX public.entidad entidad_clientes_idx unique=false valid=true definition=CREATE INDEX entidad_clientes_idx ON public.entidad USING btree (created_at DESC) WHERE (is_client AND (deleted_at IS NULL))
INDEX public.entidad entidad_document_unique unique=true valid=true definition=CREATE UNIQUE INDEX entidad_document_unique ON public.entidad USING btree (owner_id, document_type, document_number) WHERE ((deleted_at IS NULL) AND (document_number <> ''::text))
INDEX public.entidad entidad_pkey unique=true valid=true definition=CREATE UNIQUE INDEX entidad_pkey ON public.entidad USING btree (id)
INDEX public.entidad idx_entidad_owner_id unique=false valid=true definition=CREATE INDEX idx_entidad_owner_id ON public.entidad USING btree (owner_id)
INDEX public.payment idx_payment_owner_id unique=false valid=true definition=CREATE INDEX idx_payment_owner_id ON public.payment USING btree (owner_id)
INDEX public.payment payment_cash_account_date_idx unique=false valid=true definition=CREATE INDEX payment_cash_account_date_idx ON public.payment USING btree (cash_account_id, payment_date DESC)
INDEX public.payment payment_category_idx unique=false valid=true definition=CREATE INDEX payment_category_idx ON public.payment USING btree (category_id)
INDEX public.payment payment_direction_date_idx unique=false valid=true definition=CREATE INDEX payment_direction_date_idx ON public.payment USING btree (direction, payment_date DESC)
INDEX public.payment payment_entity_idx unique=false valid=true definition=CREATE INDEX payment_entity_idx ON public.payment USING btree (entity_id)
INDEX public.payment payment_method_idx unique=false valid=true definition=CREATE INDEX payment_method_idx ON public.payment USING btree (method_id)
INDEX public.payment payment_pkey unique=true valid=true definition=CREATE UNIQUE INDEX payment_pkey ON public.payment USING btree (id)
INDEX public.payment payment_receipt_unique unique=true valid=true definition=CREATE UNIQUE INDEX payment_receipt_unique ON public.payment USING btree (direction, receipt_serial)
INDEX public.payment_allocation idx_payment_allocation_owner_id unique=false valid=true definition=CREATE INDEX idx_payment_allocation_owner_id ON public.payment_allocation USING btree (owner_id)
INDEX public.payment_allocation payment_allocation_comprobante_idx unique=false valid=true definition=CREATE INDEX payment_allocation_comprobante_idx ON public.payment_allocation USING btree (comprobante_id)
INDEX public.payment_allocation payment_allocation_payment_idx unique=false valid=true definition=CREATE INDEX payment_allocation_payment_idx ON public.payment_allocation USING btree (payment_id)
INDEX public.payment_allocation payment_allocation_pkey unique=true valid=true definition=CREATE UNIQUE INDEX payment_allocation_pkey ON public.payment_allocation USING btree (id)
INDEX public.payment_allocation payment_allocation_unique unique=true valid=true definition=CREATE UNIQUE INDEX payment_allocation_unique ON public.payment_allocation USING btree (payment_id, comprobante_id)
INDEX public.payment_method payment_method_owner_id_code_key unique=true valid=true definition=CREATE UNIQUE INDEX payment_method_owner_id_code_key ON public.payment_method USING btree (owner_id, code)
INDEX public.payment_method payment_method_pkey unique=true valid=true definition=CREATE UNIQUE INDEX payment_method_pkey ON public.payment_method USING btree (id)
INDEX public.petty_cash_vale petty_cash_vale_payment_id_idx unique=false valid=true definition=CREATE INDEX petty_cash_vale_payment_id_idx ON public.petty_cash_vale USING btree (payment_id)
INDEX public.petty_cash_vale petty_cash_vale_pkey unique=true valid=true definition=CREATE UNIQUE INDEX petty_cash_vale_pkey ON public.petty_cash_vale USING btree (id)
INDEX public.petty_cash_vale petty_cash_vale_serial_unique unique=true valid=true definition=CREATE UNIQUE INDEX petty_cash_vale_serial_unique ON public.petty_cash_vale USING btree (account_id, serial)
INDEX public.receipt_sequence receipt_sequence_pkey unique=true valid=true definition=CREATE UNIQUE INDEX receipt_sequence_pkey ON public.receipt_sequence USING btree (direction)
INDEX public.voucher_series voucher_series_default_per_type_idx unique=true valid=true definition=CREATE UNIQUE INDEX voucher_series_default_per_type_idx ON public.voucher_series USING btree (owner_id, voucher_type) WHERE (is_default AND (deleted_at IS NULL))
INDEX public.voucher_series voucher_series_owner_idx unique=false valid=true definition=CREATE INDEX voucher_series_owner_idx ON public.voucher_series USING btree (owner_id) WHERE (deleted_at IS NULL)
INDEX public.voucher_series voucher_series_owner_type_code_idx unique=true valid=true definition=CREATE UNIQUE INDEX voucher_series_owner_type_code_idx ON public.voucher_series USING btree (owner_id, voucher_type, code) WHERE (deleted_at IS NULL)
INDEX public.voucher_series voucher_series_pkey unique=true valid=true definition=CREATE UNIQUE INDEX voucher_series_pkey ON public.voucher_series USING btree (id)

FUNCTIONS
FUNCTION auth.uid() kind=f security=invoker acl=default definition=CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $function$ select nullif(current_setting('app.user_id', true), '')::uuid $function$
FUNCTION private.allocation_refresh_status() kind=f security=definer acl=default definition=CREATE OR REPLACE FUNCTION private.allocation_refresh_status() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ begin if tg_op = 'DELETE' then perform private.refresh_comprobante_status(old.comprobante_id); return old; end if; perform private.refresh_comprobante_status(new.comprobante_id); if tg_op = 'UPDATE' and new.comprobante_id <> old.comprobante_id then perform private.refresh_comprobante_status(old.comprobante_id); end if; return new; end; $function$
FUNCTION private.assert_account_open_for(p_cash_account_id uuid, p_payment_date date) kind=f security=definer acl=default definition=CREATE OR REPLACE FUNCTION private.assert_account_open_for(p_cash_account_id uuid, p_payment_date date) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ declare v_opening_date date; v_last_end date; begin select a.opening_balance_date into v_opening_date from public.cash_account a where a.id = p_cash_account_id; if v_opening_date is null then raise exception 'La cuenta no existe'; end if; if p_payment_date < v_opening_date then raise exception 'La fecha del recibo (%) es anterior al saldo inicial de la cuenta (%).', p_payment_date, v_opening_date; end if; select c.period_end into v_last_end from public.cash_close c where c.cash_account_id = p_cash_account_id order by c.period_end desc limit 1; if v_last_end is not null and p_payment_date <= v_last_end then raise exception 'La cuenta ya fue cerrada hasta %. No se pueden registrar ni modificar recibos con fecha anterior o igual.', v_last_end; end if; end; $function$
FUNCTION private.assert_allocation_payment_open() kind=f security=definer acl=default definition=CREATE OR REPLACE FUNCTION private.assert_allocation_payment_open() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ declare v_account uuid; v_date date; begin select p.cash_account_id, p.payment_date into v_account, v_date from public.payment p where p.id = new.payment_id; perform private.assert_account_open_for(v_account, v_date); return new; end; $function$
FUNCTION private.assert_owner_consistency() kind=f security=definer acl=explicit definition=CREATE OR REPLACE FUNCTION private.assert_owner_consistency() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ declare v_owner uuid := new.owner_id; begin if v_owner is null then return new; end if; if tg_table_name = 'payment' then if not exists (select 1 from public.cash_account a where a.id = new.cash_account_id and a.owner_id = v_owner) or not exists (select 1 from public.payment_method m where m.id = new.method_id and m.owner_id = v_owner) or not exists (select 1 from public.cash_receipt_category c where c.id = new.category_id and c.owner_id = v_owner) or (new.entity_id is not null and not exists (select 1 from public.entidad e where e.id = new.entity_id and e.owner_id = v_owner)) then raise exception 'El pago referencia una cuenta, metodo, categoria o entidad de otro usuario' using errcode = '42501'; end if; elsif tg_table_name = 'payment_allocation' then if not exists (select 1 from public.payment p where p.id = new.payment_id and p.owner_id = v_owner) or not exists (select 1 from public.comprobante c where c.id = new.comprobante_id and c.owner_id = v_owner) then raise exception 'La asignacion referencia un pago o comprobante de otro usuario' using errcode = '42501'; end if; elsif tg_table_name = 'cash_close' then if not exists (select 1 from public.cash_account a where a.id = new.cash_account_id and a.owner_id = v_owner) then raise exception 'El cierre referencia una cuenta de otro usuario' using errcode = '42501'; end if; elsif tg_table_name = 'cash_transfer' then if not exists (select 1 from public.cash_account a where a.id = new.source_account_id and a.owner_id = v_owner) or not exists (select 1 from public.cash_account a where a.id = new.target_account_id and a.owner_id = v_owner) then raise exception 'La transferencia referencia una cuenta de otro usuario' using errcode = '42501'; end if; elsif tg_table_name = 'comprobante' then if not exists (select 1 from public.entidad e where e.id = new.entity_id and e.owner_id = v_owner) or (new.referenced_comprobante_id is not null and not exists (select 1 from public.comprobante c where c.id = new.referenced_comprobante_id and c.owner_id = v_owner)) then raise exception 'El comprobante referencia una entidad o comprobante de otro usuario' using errcode = '42501'; end if; end if; return new; end; $function$
FUNCTION private.assert_payment_account_open() kind=f security=definer acl=default definition=CREATE OR REPLACE FUNCTION private.assert_payment_account_open() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ begin if tg_op = 'UPDATE' and old.status = 'EN_REVISION' and new.status = 'PROCESADO' then return new; end if; perform private.assert_account_open_for(new.cash_account_id, new.payment_date); return new; end; $function$
FUNCTION private.assign_receipt_number() kind=f security=definer acl=default definition=CREATE OR REPLACE FUNCTION private.assign_receipt_number() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ BEGIN new.receipt_serial := private.next_receipt_serial(new.direction); RETURN new; END; $function$
FUNCTION private.cash_expected_balance(p_cash_account_id uuid, p_as_of date) kind=f security=invoker acl=default definition=CREATE OR REPLACE FUNCTION private.cash_expected_balance(p_cash_account_id uuid, p_as_of date) RETURNS numeric LANGUAGE sql STABLE SET search_path TO '' AS $function$ select ( a.opening_balance + coalesce( (select sum(p.amount) from public.payment p where p.cash_account_id = a.id and p.status <> 'ANULADO' and p.direction = 'INGRESO' and p.payment_date <= p_as_of), 0) - coalesce( (select sum(p.amount) from public.payment p where p.cash_account_id = a.id and p.status <> 'ANULADO' and p.direction = 'EGRESO' and p.payment_date <= p_as_of), 0) + coalesce( (select sum(t.amount) from public.cash_transfer t where t.target_account_id = a.id and t.transfer_date <= p_as_of), 0) - coalesce( (select sum(t.amount) from public.cash_transfer t where t.source_account_id = a.id and t.transfer_date <= p_as_of), 0) )::numeric(12,2) from public.cash_account a where a.id = p_cash_account_id; $function$
FUNCTION private.next_receipt_serial(p_direction public.payment_direction) kind=f security=definer acl=default definition=CREATE OR REPLACE FUNCTION private.next_receipt_serial(p_direction public.payment_direction) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ DECLARE v_serial integer; BEGIN INSERT INTO public.receipt_sequence AS s (direction, last_serial) VALUES (p_direction, 1) ON CONFLICT (direction) DO UPDATE SET last_serial = s.last_serial + 1 RETURNING s.last_serial INTO v_serial; RETURN v_serial; END; $function$
FUNCTION private.payment_freeze_amount() kind=f security=invoker acl=default definition=CREATE OR REPLACE FUNCTION private.payment_freeze_amount() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $function$ BEGIN IF NEW.amount IS DISTINCT FROM OLD.amount THEN RAISE EXCEPTION 'payment.amount is immutable after insert' USING ERRCODE = '23514'; END IF; RETURN NEW; END; $function$
FUNCTION private.payment_guard_history_mutation() kind=f security=invoker acl=default definition=CREATE OR REPLACE FUNCTION private.payment_guard_history_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $function$ BEGIN IF OLD.status = 'ANULADO' THEN RAISE EXCEPTION 'payment cannot be changed after voiding' USING ERRCODE = '23514'; END IF; IF (to_jsonb(NEW) - ARRAY['entity_id', 'status', 'void_reason', 'voided_at', 'updated_at', 'receipt_number']::text[]) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['entity_id', 'status', 'void_reason', 'voided_at', 'updated_at', 'receipt_number']::text[]) THEN RAISE EXCEPTION 'payment updates may only assign an entity, verify or void the payment' USING ERRCODE = '23514'; END IF; IF NEW.entity_id IS DISTINCT FROM OLD.entity_id THEN IF OLD.entity_id IS NOT NULL OR NEW.entity_id IS NULL THEN RAISE EXCEPTION 'payment entity can only be assigned once' USING ERRCODE = '23514'; END IF; IF NEW.status IS DISTINCT FROM OLD.status OR NEW.void_reason IS DISTINCT FROM OLD.void_reason OR NEW.voided_at IS DISTINCT FROM OLD.voided_at THEN RAISE EXCEPTION 'payment assignment cannot be combined with voiding' USING ERRCODE = '23514'; END IF; RETURN NEW; END IF; IF NEW.status IS DISTINCT FROM OLD.status THEN IF NEW.status = 'PROCESADO' THEN IF OLD.status <> 'EN_REVISION' OR NEW.void_reason IS DISTINCT FROM OLD.void_reason OR NEW.voided_at IS DISTINCT FROM OLD.voided_at THEN RAISE EXCEPTION 'payment status can only move from EN_REVISION to PROCESADO' USING ERRCODE = '23514'; END IF; RETURN NEW; END IF; IF NEW.status <> 'ANULADO' OR OLD.status NOT IN ('EN_REVISION', 'PROCESADO') THEN RAISE EXCEPTION 'payment status can only transition once to ANULADO' USING ERRCODE = '23514'; END IF; IF NEW.void_reason IS NULL OR NEW.voided_at IS NULL THEN RAISE EXCEPTION 'void_reason and voided_at are required when voiding a payment' USING ERRCODE = '23514'; END IF; RETURN NEW; END IF; IF NEW.void_reason IS DISTINCT FROM OLD.void_reason OR NEW.voided_at IS DISTINCT FROM OLD.voided_at THEN RAISE EXCEPTION 'payment void fields can only change during the void transition' USING ERRCODE = '23514'; END IF; RETURN NEW; END; $function$
FUNCTION private.payment_refresh_status() kind=f security=definer acl=default definition=CREATE OR REPLACE FUNCTION private.payment_refresh_status() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ begin if new.status is distinct from old.status then perform private.refresh_comprobante_status(a.comprobante_id) from public.payment_allocation a where a.payment_id = new.id; end if; return new; end; $function$
FUNCTION private.protect_paid_comprobante() kind=f security=definer acl=default definition=CREATE OR REPLACE FUNCTION private.protect_paid_comprobante() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ declare v_paid numeric(12,2); v_adjustments integer; begin select coalesce(sum(a.amount), 0) into v_paid from public.payment_allocation a join public.payment p on p.id = a.payment_id where a.comprobante_id = old.id and p.status <> 'ANULADO'; select count(*) into v_adjustments from public.comprobante n where n.referenced_comprobante_id = old.id and n.deleted_at is null; if (v_paid > 0 or v_adjustments > 0) and (new.total is distinct from old.total or new.voucher_number is distinct from old.voucher_number or new.entity_id is distinct from old.entity_id or new.issue_date is distinct from old.issue_date) then raise exception using message = case when v_paid > 0 and v_adjustments > 0 then 'No se puede modificar un comprobante con pagos y notas registradas: anula los pagos antes de cambiar importe, numero, cliente o fecha' when v_paid > 0 then 'No se puede modificar un comprobante con pagos registrados: anula los pagos antes de cambiar importe, numero, cliente o fecha' else 'No se puede modificar un comprobante con notas o retenciones registradas: el importe, numero, cliente y fecha quedan fijos' end; end if; return new; end; $function$
FUNCTION private.refresh_comprobante_status(p_comprobante_id uuid) kind=f security=definer acl=default definition=CREATE OR REPLACE FUNCTION private.refresh_comprobante_status(p_comprobante_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ declare v_total numeric(12,2); v_paid numeric(12,2); v_credit numeric(12,2); v_debit numeric(12,2); begin select c.total into v_total from public.comprobante c where c.id = p_comprobante_id; select coalesce(sum(a.amount), 0) into v_paid from public.payment_allocation a join public.payment p on p.id = a.payment_id where a.comprobante_id = p_comprobante_id and p.status <> 'ANULADO'; select coalesce(sum(c2.total) filter (where c2.voucher_type in ('NOTA_CREDITO', 'COMPROBANTE_RETENCION')), 0), coalesce(sum(c2.total) filter (where c2.voucher_type = 'NOTA_DEBITO'), 0) into v_credit, v_debit from public.comprobante c2 where c2.referenced_comprobante_id = p_comprobante_id and c2.deleted_at is null; update public.comprobante set status = case when v_paid + v_credit >= v_total + v_debit then 'PAGADO'::public.comprobante_status else 'PENDIENTE'::public.comprobante_status end where id = p_comprobante_id; end; $function$
FUNCTION private.refresh_referenced_status() kind=f security=definer acl=default definition=CREATE OR REPLACE FUNCTION private.refresh_referenced_status() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ begin if tg_op = 'DELETE' then if old.referenced_comprobante_id is not null then perform private.refresh_comprobante_status(old.referenced_comprobante_id); end if; return old; end if; if new.referenced_comprobante_id is not null then perform private.refresh_comprobante_status(new.referenced_comprobante_id); end if; if tg_op = 'UPDATE' and old.referenced_comprobante_id is distinct from new.referenced_comprobante_id and old.referenced_comprobante_id is not null then perform private.refresh_comprobante_status(old.referenced_comprobante_id); end if; return new; end; $function$
FUNCTION private.validate_allocation() kind=f security=definer acl=default definition=CREATE OR REPLACE FUNCTION private.validate_allocation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ declare v_total numeric(12,2); v_paid numeric(12,2); v_credit numeric(12,2); v_debit numeric(12,2); v_entity uuid; v_payment_entity uuid; v_kind public.voucher_kind; v_direction public.payment_direction; begin select c.total, c.entity_id, c.voucher_kind into v_total, v_entity, v_kind from public.comprobante c where c.id = new.comprobante_id for update; select p.entity_id, p.direction into v_payment_entity, v_direction from public.payment p where p.id = new.payment_id; if v_payment_entity is null then raise exception 'El pago no tiene entidad asignada todavía'; end if; if v_kind is null then raise exception 'El comprobante no existe'; end if; if (v_kind = 'VENTA' and v_direction <> 'INGRESO') or (v_kind = 'COMPRA' and v_direction <> 'EGRESO') then raise exception 'El tipo de comprobante no corresponde a la dirección del pago'; end if; if v_entity <> v_payment_entity then raise exception 'El comprobante no pertenece a la entidad del pago'; end if; select coalesce(sum(a.amount), 0) into v_paid from public.payment_allocation a join public.payment p on p.id = a.payment_id where a.comprobante_id = new.comprobante_id and p.status <> 'ANULADO' and a.id <> new.id; select coalesce(sum(c2.total) filter (where c2.voucher_type in ('NOTA_CREDITO', 'COMPROBANTE_RETENCION')), 0), coalesce(sum(c2.total) filter (where c2.voucher_type = 'NOTA_DEBITO'), 0) into v_credit, v_debit from public.comprobante c2 where c2.referenced_comprobante_id = new.comprobante_id and c2.deleted_at is null; if v_paid + new.amount > v_total + v_debit - v_credit then raise exception 'El importe asignado supera el saldo del comprobante'; end if; return new; end; $function$
FUNCTION private.validate_comprobante_adjustment() kind=f security=definer acl=default definition=CREATE OR REPLACE FUNCTION private.validate_comprobante_adjustment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ declare v_ref public.comprobante%rowtype; begin if tg_op = 'UPDATE' and (old.voucher_type in ('NOTA_CREDITO', 'NOTA_DEBITO', 'COMPROBANTE_RETENCION') or new.voucher_type in ('NOTA_CREDITO', 'NOTA_DEBITO', 'COMPROBANTE_RETENCION')) and (new.referenced_comprobante_id is distinct from old.referenced_comprobante_id or new.voucher_type is distinct from old.voucher_type or new.voucher_kind is distinct from old.voucher_kind) then raise exception 'La referencia y el tipo de una nota o retencion no se pueden cambiar'; end if; if new.voucher_type not in ('NOTA_CREDITO', 'NOTA_DEBITO', 'COMPROBANTE_RETENCION') then return new; end if; select * into v_ref from public.comprobante c where c.id = new.referenced_comprobante_id; if not found then raise exception 'El comprobante referenciado no existe'; end if; if v_ref.owner_id <> new.owner_id then raise exception 'El comprobante referenciado es de otro usuario'; end if; if v_ref.voucher_kind <> new.voucher_kind then raise exception 'El comprobante referenciado no es del mismo tipo (venta o compra)'; end if; if v_ref.voucher_type not in ('FACTURA', 'BOLETA', 'NOTA_VENTA') then raise exception 'Una nota o retencion solo puede referenciar factura, boleta o nota de venta'; end if; return new; end; $function$
FUNCTION public.close_cash_account(p_cash_account_id uuid, p_period_end date, p_counted_balance numeric, p_notes text, p_denominations jsonb, p_difference_reason text, p_counted_by text, p_verified_by text) kind=f security=definer acl=explicit definition=CREATE OR REPLACE FUNCTION public.close_cash_account(p_cash_account_id uuid, p_period_end date, p_counted_balance numeric, p_notes text, p_denominations jsonb DEFAULT NULL::jsonb, p_difference_reason text DEFAULT NULL::text, p_counted_by text DEFAULT NULL::text, p_verified_by text DEFAULT NULL::text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ declare v_owner uuid; v_currency text; v_type public.cash_account_type; v_opening_date date; v_periodicity public.closing_periodicity; v_default public.closing_periodicity; v_last_end date; v_period_start date; v_opening numeric(12,2); v_income numeric(12,2); v_expense numeric(12,2); v_transfer_in numeric(12,2); v_transfer_out numeric(12,2); v_expected numeric(12,2); v_counted numeric(12,2); v_difference numeric(12,2); v_tolerance numeric(12,2); v_reason text; v_change_fund numeric(12,2); v_rate numeric(10,4); v_id uuid; begin select a.owner_id, a.currency, a.type, a.opening_balance_date, a.closing_periodicity, a.change_fund into v_owner, v_currency, v_type, v_opening_date, v_periodicity, v_change_fund from public.cash_account a where a.id = p_cash_account_id for update; if v_owner is null or v_owner is distinct from auth.uid() then raise exception 'La cuenta no existe'; end if; if p_period_end < v_opening_date then raise exception 'La fecha de cierre es anterior al saldo inicial de la cuenta (%)', v_opening_date; end if; -- SPEC 49: no se puede cerrar el futuro. if p_period_end > current_date then raise exception 'La fecha de cierre no puede ser futura (%). Usa hoy o una fecha anterior', p_period_end; end if; select c.period_end into v_last_end from public.cash_close c where c.cash_account_id = p_cash_account_id order by c.period_end desc limit 1; if v_last_end is not null and p_period_end <= v_last_end then raise exception 'El periodo ya esta cerrado hasta %', v_last_end; end if; v_period_start := coalesce(v_last_end + 1, v_opening_date); select value::public.closing_periodicity into v_default from public.app_setting where owner_id = v_owner and key = 'default_closing_periodicity'; v_periodicity := coalesce(v_periodicity, v_default, 'DAILY'); v_opening := private.cash_expected_balance( p_cash_account_id, v_period_start - 1 ); v_expected := private.cash_expected_balance(p_cash_account_id, p_period_end); select coalesce(sum(amount) filter (where direction = 'INGRESO'), 0), coalesce(sum(amount) filter (where direction = 'EGRESO'), 0) into v_income, v_expense from public.payment where cash_account_id = p_cash_account_id and status <> 'ANULADO' and payment_date between v_period_start and p_period_end; v_transfer_in := coalesce((select sum(t.amount) from public.cash_transfer t where t.target_account_id = p_cash_account_id and t.transfer_date between v_period_start and p_period_end), 0); v_transfer_out := coalesce((select sum(t.amount) from public.cash_transfer t where t.source_account_id = p_cash_account_id and t.transfer_date between v_period_start and p_period_end), 0); select coalesce( (select s.value::numeric(12,2) from public.app_setting s where s.owner_id = v_owner and s.key = 'cash_difference_tolerance'), 0.50) into v_tolerance; if p_denominations is not null and v_type = 'CASH_BOX' then if jsonb_typeof(p_denominations) <> 'array' then raise exception 'El conteo por denominaciones debe ser un arreglo'; end if; begin select coalesce(sum((e ->> 'denomination')::numeric * (e ->> 'quantity')::integer), 0) into v_counted from jsonb_array_elements(p_denominations) e; exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'El conteo por denominaciones tiene montos o cantidades invalidas'; end; if exists ( select 1 from jsonb_array_elements(p_denominations) e where (e ->> 'denomination')::numeric not in (200, 100, 50, 20, 10, 5, 2, 1, 0.50, 0.20, 0.10) or (e ->> 'quantity')::integer < 0 ) then raise exception 'Denominacion o cantidad invalida en el arqueo'; end if; if (select count(*) from jsonb_array_elements(p_denominations)) <> (select count(distinct (e ->> 'denomination')::numeric) from jsonb_array_elements(p_denominations) e) then raise exception 'No se puede repetir una denominacion en el arqueo'; end if; else v_counted := p_counted_balance; end if; v_difference := case when v_counted is null then null else v_counted - v_expected end; v_reason := nullif(trim(coalesce(p_difference_reason, '')), ''); if v_difference is not null and abs(v_difference) > v_tolerance and v_reason is null then raise exception 'La diferencia (%) supera la tolerancia (%). Registra el motivo de la diferencia', v_difference, v_tolerance; end if; if v_currency <> 'PEN' then select value::numeric(10,4) into v_rate from public.app_setting where owner_id = v_owner and key = 'pen_usd_rate'; end if; insert into public.cash_close ( cash_account_id, periodicity, period_start, period_end, opening_balance, income_total, expense_total, expected_balance, transfer_in_total, transfer_out_total, counted_balance, difference, difference_reason, difference_tolerance, pen_usd_rate, notes, change_fund, counted_by, verified_by ) values ( p_cash_account_id, v_periodicity, v_period_start, p_period_end, v_opening, v_income, v_expense, v_expected, v_transfer_in, v_transfer_out, v_counted, v_difference, v_reason, v_tolerance, v_rate, nullif(p_notes, ''), v_change_fund, nullif(trim(coalesce(p_counted_by, '')), ''), nullif(trim(coalesce(p_verified_by, '')), '') ) returning id into v_id; if p_denominations is not null and v_type = 'CASH_BOX' then insert into public.cash_close_denomination (cash_close_id, denomination, quantity) select v_id, (e ->> 'denomination')::numeric, (e ->> 'quantity')::integer from jsonb_array_elements(p_denominations) e where (e ->> 'quantity')::integer > 0; end if; return v_id; end; $function$
FUNCTION public.crear_serie(p_voucher_type public.voucher_type, p_code text, p_is_default boolean) kind=f security=definer acl=explicit definition=CREATE OR REPLACE FUNCTION public.crear_serie(p_voucher_type public.voucher_type, p_code text, p_is_default boolean) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ declare v_owner uuid := auth.uid(); v_code text := btrim(coalesce(p_code, '')); v_is_default boolean := coalesce(p_is_default, false); v_id uuid; begin if v_owner is null then raise exception 'Sesion no valida' using errcode = '42501'; end if; -- El NOT NULL de la tabla lo rechazaria igual (23502); se adelanta para que el mensaje sea el de -- S6 y no el generico. if p_voucher_type is null then raise exception 'Los datos de la serie no son válidos.' using errcode = '23514'; end if; begin if v_is_default then update public.voucher_series s set is_default = false where s.owner_id = v_owner and s.voucher_type = p_voucher_type and s.is_default and s.deleted_at is null; end if; insert into public.voucher_series (owner_id, voucher_type, code, is_default) values (v_owner, p_voucher_type, v_code, v_is_default) returning id into v_id; exception when unique_violation then -- `voucher_series_owner_type_code_idx`: ya hay una serie viva con ese codigo y tipo. raise exception 'Ya existe una serie con ese código para ese tipo.' using errcode = '23505'; when check_violation or not_null_violation then raise exception 'Los datos de la serie no son válidos.' using errcode = '23514'; when others then if sqlstate = 'P0001' or sqlstate = '42501' then raise; end if; raise exception 'No se pudo completar la operación con la base de datos. Intenta nuevamente.' using errcode = 'XX000'; end; return v_id; end; $function$
FUNCTION public.crear_venta(p_entity_id uuid, p_voucher_type public.voucher_type, p_issue_date date, p_subtotal numeric, p_igv numeric, p_total numeric, p_payment_type public.payment_type, p_credit_days integer) kind=f security=definer acl=explicit definition=CREATE OR REPLACE FUNCTION public.crear_venta(p_entity_id uuid, p_voucher_type public.voucher_type, p_issue_date date, p_subtotal numeric, p_igv numeric, p_total numeric, p_payment_type public.payment_type, p_credit_days integer DEFAULT NULL::integer) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ declare v_owner uuid := auth.uid(); v_serie_id uuid; v_code text; v_correlativo integer; v_number text; v_id uuid; begin if v_owner is null then raise exception 'Sesion no valida' using errcode = '42501'; end if; -- El slice 1 solo da de alta comprobantes base de VENTA. Notas y retencion llegan en un slice -- posterior y exigen `referenced_comprobante_id` + `motive_code`, que -- `comprobante_validate_adjustment` ya gobierna. if p_voucher_type is null or p_voucher_type not in ('FACTURA', 'BOLETA', 'NOTA_VENTA') then raise exception 'Los datos del comprobante no son válidos.'; end if; if p_payment_type is null or p_issue_date is null or p_subtotal is null or p_igv is null or p_total is null then raise exception 'Los datos del comprobante no son válidos.'; end if; -- Mismo texto para "no existe" y "es de otro", igual que `close_cash_account` y las RPC de -- cajas: no se filtra la existencia de clientes ajenos. if p_entity_id is null or not exists ( select 1 from public.entidad e where e.id = p_entity_id and e.owner_id = v_owner ) then raise exception 'El cliente seleccionado no existe.'; end if; -- EL CORAZON DE S2. `for update` bloquea la fila de la serie hasta el commit: dos altas -- simultaneas del mismo dueno y tipo se serializan y la segunda lee el `last_number` que dejo la -- primera. Sin fila (no hay serie por defecto viva del tipo) las variables quedan nulas y el alta -- no se registra: no hay fallback silencioso (L4c). select s.id, s.code, s.last_number + 1 into v_serie_id, v_code, v_correlativo from public.voucher_series s where s.owner_id = v_owner and s.voucher_type = p_voucher_type and s.is_default and s.deleted_at is null for update; if v_serie_id is null then raise exception 'No hay una serie por defecto para este tipo de comprobante. Configura una en Configuración → Series.'; end if; v_number := v_code || '-' || lpad(v_correlativo::text, 6, '0'); begin insert into public.comprobante ( owner_id, entity_id, voucher_kind, voucher_type, voucher_number, issue_date, subtotal, igv, total, payment_type, credit_days ) values ( v_owner, p_entity_id, 'VENTA', p_voucher_type, v_number, p_issue_date, p_subtotal, p_igv, p_total, p_payment_type, p_credit_days ) returning id into v_id; -- Misma transaccion que el INSERT: si esto falla, la fila del comprobante no queda, y si el -- INSERT falla la serie no avanza. La fila ya esta bloqueada por el `for update` de arriba, asi -- que el UPDATE no espera a nadie. update public.voucher_series set last_number = v_correlativo where id = v_serie_id; exception when unique_violation then -- Con el numero asignado por la base, este choque solo aparece si una fila quedo escrita por -- fuera de la RPC con un correlativo adelantado. El mensaje se conserva: el usuario tiene que -- poder resolverlo, y el juez sigue siendo el indice. raise exception 'Ya registraste una venta con ese número de comprobante.' using errcode = '23505'; when check_violation then raise exception 'Los datos del comprobante no son válidos.' using errcode = '23514'; when foreign_key_violation then -- La entidad desaparecio entre la validacion de arriba y el INSERT (carrera con una baja). raise exception 'El cliente seleccionado no existe.' using errcode = '23503'; when others then -- Los mensajes de dominio de los triggers son P0001 y los de permisos 42501: se re-lanzan tal -- cual, la RPC no los tapa. if sqlstate = 'P0001' or sqlstate = '42501' then raise; end if; raise exception 'No se pudo completar la operación con la base de datos. Intenta nuevamente.' using errcode = 'XX000'; end; return v_id; end; $function$
FUNCTION public.create_cash_transfer(p_source_account_id uuid, p_target_account_id uuid, p_amount numeric, p_transfer_date date, p_notes text) kind=f security=definer acl=explicit definition=CREATE OR REPLACE FUNCTION public.create_cash_transfer(p_source_account_id uuid, p_target_account_id uuid, p_amount numeric, p_transfer_date date, p_notes text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ declare v_owner uuid; v_source_currency text; v_target_owner uuid; v_target_currency text; v_id uuid; begin select a.owner_id, a.currency into v_owner, v_source_currency from public.cash_account a where a.id = p_source_account_id and a.is_active = true and a.deleted_at is null for update; if v_owner is null or v_owner is distinct from auth.uid() then raise exception 'La cuenta de origen no existe'; end if; select a.owner_id, a.currency into v_target_owner, v_target_currency from public.cash_account a where a.id = p_target_account_id and a.is_active = true and a.deleted_at is null; if v_target_owner is null or v_target_owner is distinct from v_owner then raise exception 'La cuenta de destino no existe'; end if; if p_source_account_id = p_target_account_id then raise exception 'Origen y destino deben ser cuentas distintas'; end if; if v_source_currency <> 'PEN' or v_target_currency <> 'PEN' then raise exception 'Solo se permiten transferencias entre cuentas en PEN'; end if; if p_amount is null or p_amount <= 0 then raise exception 'El monto debe ser mayor a cero'; end if; perform private.assert_account_open_for(p_source_account_id, p_transfer_date); perform private.assert_account_open_for(p_target_account_id, p_transfer_date); insert into public.cash_transfer ( owner_id, source_account_id, target_account_id, amount, transfer_date, notes ) values ( v_owner, p_source_account_id, p_target_account_id, p_amount, p_transfer_date, nullif(p_notes, '') ) returning id into v_id; return v_id; end; $function$
FUNCTION public.create_payment_with_allocations(p_entity_id uuid, p_direction public.payment_direction, p_payment_date date, p_amount numeric, p_method_id uuid, p_cash_account_id uuid, p_category_id uuid, p_reference text, p_notes text, p_allocations jsonb, p_is_cash_movement boolean) kind=f security=definer acl=explicit definition=CREATE OR REPLACE FUNCTION public.create_payment_with_allocations(p_entity_id uuid, p_direction public.payment_direction, p_payment_date date, p_amount numeric, p_method_id uuid, p_cash_account_id uuid, p_category_id uuid, p_reference text, p_notes text, p_allocations jsonb, p_is_cash_movement boolean DEFAULT false) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ declare v_owner uuid := auth.uid(); v_payment_id uuid; v_item jsonb; v_comprobante_id uuid; v_alloc_amount numeric(12,2); v_total numeric(12,2); v_paid numeric(12,2); v_comp_owner uuid; begin if v_owner is null then raise exception 'Sesion no valida' using errcode = '42501'; end if; if not exists (select 1 from public.cash_account a where a.id = p_cash_account_id and a.owner_id = v_owner) then raise exception 'La cuenta de caja no existe' using errcode = '42501'; end if; if not exists (select 1 from public.payment_method m where m.id = p_method_id and m.owner_id = v_owner) then raise exception 'El metodo de pago no existe' using errcode = '42501'; end if; if not exists (select 1 from public.cash_receipt_category c where c.id = p_category_id and c.owner_id = v_owner) then raise exception 'La categoria no existe' using errcode = '42501'; end if; if p_entity_id is not null and not exists (select 1 from public.entidad e where e.id = p_entity_id and e.owner_id = v_owner) then raise exception 'La entidad no existe' using errcode = '42501'; end if; insert into public.payment ( owner_id, entity_id, direction, payment_date, amount, method_id, cash_account_id, category_id, reference, notes, is_cash_movement ) values ( v_owner, p_entity_id, p_direction, p_payment_date, p_amount, p_method_id, p_cash_account_id, p_category_id, nullif(p_reference, ''), nullif(p_notes, ''), coalesce(p_is_cash_movement, false) ) returning id into v_payment_id; if p_allocations is not null and jsonb_array_length(p_allocations) > 0 then for v_item in select * from jsonb_array_elements(p_allocations) loop v_comprobante_id := (v_item->>'comprobante_id')::uuid; v_alloc_amount := (v_item->>'amount')::numeric(12,2); if v_alloc_amount <= 0 then raise exception 'El importe asignado debe ser mayor a 0'; end if; select c.total, c.owner_id into v_total, v_comp_owner from public.comprobante c where c.id = v_comprobante_id for update; if v_total is null then raise exception 'El comprobante % no existe', v_comprobante_id; end if; if v_comp_owner is distinct from v_owner then raise exception 'El comprobante no pertenece al usuario' using errcode = '42501'; end if; select coalesce(sum(a.amount), 0) into v_paid from public.payment_allocation a join public.payment p on p.id = a.payment_id where a.comprobante_id = v_comprobante_id and p.status <> 'ANULADO'; if v_paid + v_alloc_amount > v_total then raise exception 'La asignacion supera el saldo del comprobante (%)', v_comprobante_id; end if; insert into public.payment_allocation (owner_id, payment_id, comprobante_id, amount) values (v_owner, v_payment_id, v_comprobante_id, v_alloc_amount); end loop; end if; return v_payment_id; end; $function$
FUNCTION public.create_petty_cash_vale(p_account_id uuid, p_vale_date date, p_paid_to character varying, p_concept character varying, p_amount numeric, p_has_receipt boolean, p_category_id uuid) kind=f security=definer acl=explicit definition=CREATE OR REPLACE FUNCTION public.create_petty_cash_vale(p_account_id uuid, p_vale_date date, p_paid_to character varying, p_concept character varying, p_amount numeric, p_has_receipt boolean, p_category_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ declare v_owner uuid; v_is_petty boolean; v_limit numeric(12,2); v_date date; v_serial integer; v_method uuid; v_payment uuid; v_id uuid; begin select a.owner_id, a.is_petty_cash, a.petty_expense_limit into v_owner, v_is_petty, v_limit from public.cash_account a where a.id = p_account_id and a.is_active = true and a.deleted_at is null for update; if v_owner is null or v_owner is distinct from auth.uid() then raise exception 'La cuenta de caja chica no existe'; end if; if v_is_petty is not true then raise exception 'La cuenta no está marcada como caja chica'; end if; if p_amount is null or p_amount <= 0 then raise exception 'El monto del vale debe ser mayor a cero'; end if; if v_limit is not null and p_amount > v_limit then raise exception 'El monto del vale (%) supera el límite por gasto de la caja chica (%)', p_amount, v_limit; end if; if coalesce(p_paid_to, '') = '' then raise exception 'Indica a quién se pagó el vale'; end if; if coalesce(p_concept, '') = '' then raise exception 'Indica el concepto del vale'; end if; if p_category_id is null then raise exception 'Selecciona la categoría del gasto del vale'; end if; if not exists ( select 1 from public.cash_receipt_category c where c.id = p_category_id and c.owner_id = v_owner and c.direction = 'EGRESO' and c.is_active ) then raise exception 'La categoría del vale no es válida'; end if; select m.id into v_method from public.payment_method m where m.owner_id = v_owner and m.code = 'EFECTIVO' and m.is_active limit 1; if v_method is null then raise exception 'No existe el método de pago Efectivo para esta cuenta'; end if; v_date := coalesce(p_vale_date, current_date); perform private.assert_account_open_for(p_account_id, v_date); select coalesce(max(v.serial), 0) + 1 into v_serial from public.petty_cash_vale v where v.account_id = p_account_id; insert into public.petty_cash_vale ( owner_id, account_id, serial, vale_date, paid_to, concept, amount, has_receipt ) values ( v_owner, p_account_id, v_serial, v_date, p_paid_to, p_concept, p_amount, coalesce(p_has_receipt, false) ) returning id into v_id; insert into public.payment ( owner_id, entity_id, direction, payment_date, amount, method_id, cash_account_id, category_id, notes, is_cash_movement ) values ( v_owner, null, 'EGRESO', v_date, p_amount, v_method, p_account_id, p_category_id, format('Vale de caja chica N.º %s: %s', v_serial, p_concept), true ) returning id into v_payment; update public.petty_cash_vale set payment_id = v_payment where id = v_id; return v_id; end; $function$
FUNCTION public.editar_serie(p_serie_id uuid, p_code text, p_is_default boolean) kind=f security=definer acl=explicit definition=CREATE OR REPLACE FUNCTION public.editar_serie(p_serie_id uuid, p_code text, p_is_default boolean) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ declare v_owner uuid := auth.uid(); v_code text := btrim(coalesce(p_code, '')); v_is_default boolean := coalesce(p_is_default, false); v_row_owner uuid; v_row_type public.voucher_type; v_row_deleted timestamptz; begin if v_owner is null then raise exception 'Sesion no valida' using errcode = '42501'; end if; select s.owner_id, s.voucher_type, s.deleted_at into v_row_owner, v_row_type, v_row_deleted from public.voucher_series s where s.id = p_serie_id for update; if v_row_owner is null or v_row_owner is distinct from v_owner or v_row_deleted is not null then raise exception 'La serie no existe.'; end if; begin if v_is_default then -- Mismo orden que en el alta: primero se limpia el default del tipo, despues se marca este. update public.voucher_series s set is_default = false where s.owner_id = v_owner and s.voucher_type = v_row_type and s.is_default and s.deleted_at is null and s.id <> p_serie_id; end if; update public.voucher_series set code = v_code, is_default = v_is_default where id = p_serie_id; exception when unique_violation then raise exception 'Ya existe una serie con ese código para ese tipo.' using errcode = '23505'; when check_violation or not_null_violation then raise exception 'Los datos de la serie no son válidos.' using errcode = '23514'; when others then if sqlstate = 'P0001' or sqlstate = '42501' then raise; end if; raise exception 'No se pudo completar la operación con la base de datos. Intenta nuevamente.' using errcode = 'XX000'; end; return p_serie_id; end; $function$
FUNCTION public.editar_venta(p_comprobante_id uuid, p_entity_id uuid, p_voucher_type public.voucher_type, p_issue_date date, p_subtotal numeric, p_igv numeric, p_total numeric, p_payment_type public.payment_type, p_credit_days integer) kind=f security=definer acl=explicit definition=CREATE OR REPLACE FUNCTION public.editar_venta(p_comprobante_id uuid, p_entity_id uuid, p_voucher_type public.voucher_type, p_issue_date date, p_subtotal numeric, p_igv numeric, p_total numeric, p_payment_type public.payment_type, p_credit_days integer DEFAULT NULL::integer) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ declare v_owner uuid; v_kind public.voucher_kind; begin if auth.uid() is null then raise exception 'Sesion no valida' using errcode = '42501'; end if; select c.owner_id, c.voucher_kind into v_owner, v_kind from public.comprobante c where c.id = p_comprobante_id for update; -- Mismo texto para las tres ramas (no existe / es de otro / es una compra): la RPC es del -- vertical de ventas y no revela la existencia de comprobantes que este vertical no edita. if v_owner is null or v_owner is distinct from auth.uid() or v_kind is distinct from 'VENTA' then raise exception 'El comprobante no existe.'; end if; if p_voucher_type is null or p_voucher_type not in ('FACTURA', 'BOLETA', 'NOTA_VENTA') then raise exception 'Los datos del comprobante no son válidos.'; end if; if p_payment_type is null or p_issue_date is null or p_subtotal is null or p_igv is null or p_total is null then raise exception 'Los datos del comprobante no son válidos.'; end if; if p_entity_id is null or not exists ( select 1 from public.entidad e where e.id = p_entity_id and e.owner_id = v_owner ) then raise exception 'El cliente seleccionado no existe.'; end if; begin -- `voucher_number` no aparece: es inmutable y la firma no lo recibe. update public.comprobante set entity_id = p_entity_id, voucher_type = p_voucher_type, issue_date = p_issue_date, subtotal = p_subtotal, igv = p_igv, total = p_total, payment_type = p_payment_type, credit_days = p_credit_days where id = p_comprobante_id; exception when unique_violation then raise exception 'Ya registraste una venta con ese número de comprobante.' using errcode = '23505'; when check_violation then raise exception 'Los datos del comprobante no son válidos.' using errcode = '23514'; when foreign_key_violation then -- La entidad desaparecio entre la validacion de arriba y el UPDATE (carrera con una baja). raise exception 'El cliente seleccionado no existe.' using errcode = '23503'; when others then -- `comprobante_protect_paid` levanta P0001 con el mensaje de pagos y no se puede saltar: si -- se reemplazara por el generico, el usuario perdería la unica explicacion util de por que su -- edicion no pasa. Lo mismo para el 42501 de permisos. if sqlstate = 'P0001' or sqlstate = '42501' then raise; end if; raise exception 'No se pudo completar la operación con la base de datos. Intenta nuevamente.' using errcode = 'XX000'; end; return p_comprobante_id; end; $function$
FUNCTION public.eliminar_serie(p_serie_id uuid) kind=f security=definer acl=explicit definition=CREATE OR REPLACE FUNCTION public.eliminar_serie(p_serie_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ declare v_owner uuid := auth.uid(); v_row_owner uuid; v_row_deleted timestamptz; begin if v_owner is null then raise exception 'Sesion no valida' using errcode = '42501'; end if; select s.owner_id, s.deleted_at into v_row_owner, v_row_deleted from public.voucher_series s where s.id = p_serie_id for update; -- Una serie ya dada de baja es "no existe" para esta RPC: el universo visible del usuario es el -- de las vivas (la lista de Configuración → Series). if v_row_owner is null or v_row_owner is distinct from v_owner or v_row_deleted is not null then raise exception 'La serie no existe.'; end if; begin update public.voucher_series set deleted_at = now() where id = p_serie_id; exception when others then if sqlstate = 'P0001' or sqlstate = '42501' then raise; end if; raise exception 'No se pudo completar la operación con la base de datos. Intenta nuevamente.' using errcode = 'XX000'; end; return p_serie_id; end; $function$
FUNCTION public.get_cash_position(p_cash_account_id uuid, p_as_of date) kind=f security=invoker acl=explicit definition=CREATE OR REPLACE FUNCTION public.get_cash_position(p_cash_account_id uuid, p_as_of date DEFAULT CURRENT_DATE) RETURNS numeric LANGUAGE sql STABLE SET search_path TO '' AS $function$ select a.opening_balance + coalesce(sum(p.amount) filter (where p.direction = 'INGRESO'), 0) - coalesce(sum(p.amount) filter (where p.direction = 'EGRESO'), 0) + coalesce((select sum(t.amount) from public.cash_transfer t where t.target_account_id = p_cash_account_id and t.transfer_date <= p_as_of), 0) - coalesce((select sum(t.amount) from public.cash_transfer t where t.source_account_id = p_cash_account_id and t.transfer_date <= p_as_of), 0) from public.cash_account a left join public.payment p on p.cash_account_id = a.id and p.status <> 'ANULADO' and p.payment_date <= p_as_of where a.id = p_cash_account_id group by a.opening_balance; $function$
FUNCTION public.get_cash_positions(p_as_of date) kind=f security=invoker acl=default definition=CREATE OR REPLACE FUNCTION public.get_cash_positions(p_as_of date DEFAULT NULL::date) RETURNS TABLE(account_id uuid, name text, type public.cash_account_type, currency text, balance numeric) LANGUAGE sql STABLE SET search_path TO '' AS $function$ with params as ( select coalesce(p_as_of, current_date) as as_of ) select a.id as account_id, a.name, a.type, a.currency, ( a.opening_balance + coalesce(pay.income, 0) - coalesce(pay.expense, 0) + coalesce(tr_in.amount, 0) - coalesce(tr_out.amount, 0) )::numeric as balance from public.cash_account a cross join params left join lateral ( select sum(p.amount) filter (where p.direction = 'INGRESO') as income, sum(p.amount) filter (where p.direction = 'EGRESO') as expense from public.payment p where p.cash_account_id = a.id and p.status <> 'ANULADO' and p.payment_date <= params.as_of ) pay on true left join lateral ( select sum(t.amount) as amount from public.cash_transfer t where t.target_account_id = a.id and t.transfer_date <= params.as_of ) tr_in on true left join lateral ( select sum(t.amount) as amount from public.cash_transfer t where t.source_account_id = a.id and t.transfer_date <= params.as_of ) tr_out on true where a.deleted_at is null and a.is_active order by a.name; $function$
FUNCTION public.list_last_movement_dates() kind=f security=invoker acl=explicit definition=CREATE OR REPLACE FUNCTION public.list_last_movement_dates() RETURNS TABLE(cash_account_id uuid, last_date date) LANGUAGE sql STABLE SET search_path TO '' AS $function$ select p.cash_account_id, max(p.payment_date) as last_date from public.payment p where p.status <> 'ANULADO' group by p.cash_account_id; $function$
FUNCTION public.mark_payments_processed(p_payment_ids uuid[]) kind=f security=definer acl=explicit definition=CREATE OR REPLACE FUNCTION public.mark_payments_processed(p_payment_ids uuid[]) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ declare v_owner uuid := auth.uid(); v_requested integer; v_valid integer; v_updated integer; begin if p_payment_ids is null or array_length(p_payment_ids, 1) is null then raise exception 'Selecciona al menos un recibo para marcar'; end if; select count(*) into v_requested from (select distinct unnest(p_payment_ids)) s; -- Bloquea los recibos seleccionados para que no cambien de estado en paralelo. perform p.id from public.payment p where p.id = any (p_payment_ids) and p.owner_id = v_owner and p.status = 'EN_REVISION' for update; select count(*) into v_valid from public.payment p where p.id = any (p_payment_ids) and p.owner_id = v_owner and p.status = 'EN_REVISION'; if v_valid <> v_requested then raise exception 'Solo se pueden marcar recibos en revisión de tus cuentas'; end if; update public.payment set status = 'PROCESADO' where id = any (p_payment_ids) and owner_id = v_owner and status = 'EN_REVISION'; get diagnostics v_updated = row_count; return v_updated; end; $function$
FUNCTION public.register_cash_count(p_cash_account_id uuid, p_count_date date, p_counted_balance numeric, p_denominations jsonb, p_counted_by text, p_notes text) kind=f security=definer acl=explicit definition=CREATE OR REPLACE FUNCTION public.register_cash_count(p_cash_account_id uuid, p_count_date date, p_counted_balance numeric, p_denominations jsonb DEFAULT NULL::jsonb, p_counted_by text DEFAULT NULL::text, p_notes text DEFAULT NULL::text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ declare v_owner uuid; v_type public.cash_account_type; v_opening_date date; v_change_fund numeric(12,2); v_last_end date; v_date date; v_counted numeric(12,2); v_expected numeric(12,2); v_id uuid; begin select a.owner_id, a.type, a.opening_balance_date, a.change_fund into v_owner, v_type, v_opening_date, v_change_fund from public.cash_account a where a.id = p_cash_account_id and a.is_active = true and a.deleted_at is null for update; if v_owner is null or v_owner is distinct from auth.uid() then raise exception 'La cuenta no existe'; end if; v_date := coalesce(p_count_date, current_date); if v_date < v_opening_date then raise exception 'La fecha del arqueo es anterior al saldo inicial de la cuenta (%)', v_opening_date; end if; if v_date > current_date then raise exception 'La fecha del arqueo no puede ser futura (%)', v_date; end if; select max(c.period_end) into v_last_end from public.cash_close c where c.cash_account_id = p_cash_account_id; if v_last_end is not null and v_date <= v_last_end then raise exception 'La fecha del arqueo cae en un periodo ya cerrado (hasta %)', v_last_end; end if; if p_denominations is not null and jsonb_typeof(p_denominations) = 'array' then begin select coalesce(sum((e ->> 'denomination')::numeric * (e ->> 'quantity')::integer), 0) into v_counted from jsonb_array_elements(p_denominations) e; exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'El conteo por denominaciones tiene montos o cantidades invalidas'; end; if exists ( select 1 from jsonb_array_elements(p_denominations) e where (e ->> 'denomination')::numeric not in (200, 100, 50, 20, 10, 5, 2, 1, 0.50, 0.20, 0.10) or (e ->> 'quantity')::integer < 0 ) then raise exception 'Denominacion o cantidad invalida en el arqueo'; end if; if (select count(*) from jsonb_array_elements(p_denominations)) <> (select count(distinct (e ->> 'denomination')::numeric) from jsonb_array_elements(p_denominations) e) then raise exception 'No se puede repetir una denominacion en el arqueo'; end if; else v_counted := p_counted_balance; end if; if v_counted is null or v_counted < 0 then raise exception 'Indica el efectivo contado (mayor o igual a cero)'; end if; v_expected := private.cash_expected_balance(p_cash_account_id, v_date); insert into public.cash_count ( owner_id, cash_account_id, count_date, counted_balance, expected_balance, difference, change_fund, counted_by, is_surprise, notes ) values ( v_owner, p_cash_account_id, v_date, v_counted, v_expected, v_counted - v_expected, v_change_fund, nullif(trim(p_counted_by), ''), true, nullif(trim(p_notes), '') ) returning id into v_id; if p_denominations is not null and jsonb_typeof(p_denominations) = 'array' then insert into public.cash_count_denomination (cash_count_id, denomination, quantity) select v_id, (e ->> 'denomination')::numeric, (e ->> 'quantity')::integer from jsonb_array_elements(p_denominations) e where (e ->> 'quantity')::integer > 0; end if; return v_id; end; $function$
FUNCTION public.replenish_petty_cash(p_account_id uuid, p_source_account_id uuid, p_vale_ids uuid[]) kind=f security=definer acl=explicit definition=CREATE OR REPLACE FUNCTION public.replenish_petty_cash(p_account_id uuid, p_source_account_id uuid, p_vale_ids uuid[]) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ declare v_owner uuid; v_is_petty boolean; v_selected integer; v_requested integer; v_total numeric(12,2); v_serials text; v_transfer_id uuid; begin if p_vale_ids is null or array_length(p_vale_ids, 1) is null then raise exception 'Selecciona al menos un vale para reponer'; end if; select a.owner_id, a.is_petty_cash into v_owner, v_is_petty from public.cash_account a where a.id = p_account_id and a.is_active = true and a.deleted_at is null for update; if v_owner is null or v_owner is distinct from auth.uid() then raise exception 'La cuenta de caja chica no existe'; end if; if v_is_petty is not true then raise exception 'La cuenta no está marcada como caja chica'; end if; perform v.id from public.petty_cash_vale v where v.id = any (p_vale_ids) and v.account_id = p_account_id for update; select count(*), coalesce(sum(v.amount), 0), string_agg(v.serial::text, ', ' order by v.serial) into v_selected, v_total, v_serials from public.petty_cash_vale v where v.id = any (p_vale_ids) and v.account_id = p_account_id and v.status = 'PENDIENTE'; select count(*) into v_requested from (select distinct unnest(p_vale_ids)) s; if v_selected <> v_requested then raise exception 'Algún vale no existe, no pertenece a la caja chica o no está pendiente'; end if; if v_total <= 0 then raise exception 'El total de los vales debe ser mayor a cero'; end if; v_transfer_id := public.create_cash_transfer( p_source_account_id, p_account_id, v_total, current_date, format('Reposición de caja chica (vales %s)', v_serials) ); update public.petty_cash_vale set status = 'REPUESTO' where id = any (p_vale_ids) and account_id = p_account_id and status = 'PENDIENTE'; return v_transfer_id; end; $function$
FUNCTION public.rls_auto_enable() kind=f security=invoker acl=explicit definition=CREATE OR REPLACE FUNCTION public.rls_auto_enable() RETURNS event_trigger LANGUAGE plpgsql AS $function$ begin raise notice 'rls_auto_enable: no-op fuera de Supabase'; end $function$
FUNCTION public.save_bank_reconciliation(p_reconciliation jsonb, p_items jsonb) kind=f security=definer acl=explicit definition=CREATE OR REPLACE FUNCTION public.save_bank_reconciliation(p_reconciliation jsonb, p_items jsonb DEFAULT '[]'::jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ declare v_owner uuid; v_type public.cash_account_type; v_account uuid; v_start date; v_end date; v_statement numeric(12,2); v_books numeric(12,2); v_id uuid; v_item jsonb; v_kind public.reconciliation_item_kind; v_description text; v_amount numeric(12,2); begin v_account := (p_reconciliation ->> 'cash_account_id')::uuid; v_start := (p_reconciliation ->> 'period_start')::date; v_end := (p_reconciliation ->> 'period_end')::date; v_statement := (p_reconciliation ->> 'statement_balance')::numeric(12,2); v_books := (p_reconciliation ->> 'books_balance')::numeric(12,2); if v_account is null then raise exception 'Indica la cuenta bancaria a conciliar'; end if; select a.owner_id, a.type into v_owner, v_type from public.cash_account a where a.id = v_account and a.deleted_at is null for update; if v_owner is null or v_owner is distinct from auth.uid() then raise exception 'La cuenta no existe'; end if; if v_type <> 'BANK_ACCOUNT' then raise exception 'Solo se concilian cuentas bancarias'; end if; if v_start is null or v_end is null or v_end < v_start then raise exception 'El período de la conciliación no es válido'; end if; if v_statement is null or v_books is null then raise exception 'Indica el saldo según extracto y el saldo según registros'; end if; if p_items is null or jsonb_typeof(p_items) <> 'array' then p_items := '[]'::jsonb; end if; for v_item in select * from jsonb_array_elements(p_items) loop begin v_kind := (v_item ->> 'kind')::public.reconciliation_item_kind; v_amount := (v_item ->> 'amount')::numeric(12,2); exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'Hay una partida con una clase o un monto inválido'; end; v_description := nullif(btrim(v_item ->> 'description'), ''); if v_description is null then raise exception 'Cada partida necesita una descripción'; end if; if v_amount is null or v_amount <= 0 then raise exception 'El monto de cada partida debe ser mayor a cero'; end if; end loop; insert into public.bank_reconciliation ( owner_id, cash_account_id, period_start, period_end, statement_balance, books_balance, prepared_by, reviewed_by, notes ) values ( v_owner, v_account, v_start, v_end, v_statement, v_books, nullif(btrim(p_reconciliation ->> 'prepared_by'), ''), nullif(btrim(p_reconciliation ->> 'reviewed_by'), ''), nullif(btrim(p_reconciliation ->> 'notes'), '') ) on conflict (cash_account_id, period_start, period_end) do update set statement_balance = excluded.statement_balance, books_balance = excluded.books_balance, prepared_by = excluded.prepared_by, reviewed_by = excluded.reviewed_by, notes = excluded.notes, updated_at = now() returning id into v_id; delete from public.bank_reconciliation_item where reconciliation_id = v_id; insert into public.bank_reconciliation_item ( reconciliation_id, kind, description, amount ) select v_id, (e ->> 'kind')::public.reconciliation_item_kind, btrim(e ->> 'description'), (e ->> 'amount')::numeric(12,2) from jsonb_array_elements(p_items) e; return v_id; end; $function$
FUNCTION public.set_owner_id_on_insert() kind=f security=invoker acl=default definition=CREATE OR REPLACE FUNCTION public.set_owner_id_on_insert() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $function$ begin if new.owner_id is null and auth.uid() is not null then new.owner_id := auth.uid(); end if; return new; end; $function$
FUNCTION public.set_updated_at() kind=f security=invoker acl=default definition=CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $function$ begin new.updated_at = now(); return new; end; $function$
FUNCTION public.void_petty_cash_vale(p_vale_id uuid) kind=f security=definer acl=explicit definition=CREATE OR REPLACE FUNCTION public.void_petty_cash_vale(p_vale_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$ declare v_status public.vale_status; v_payment uuid; v_serial integer; begin select v.status, v.payment_id, v.serial into v_status, v_payment, v_serial from public.petty_cash_vale v where v.id = p_vale_id and v.owner_id = auth.uid() for update; if v_status is null then raise exception 'El vale no existe'; end if; if v_status <> 'PENDIENTE' then raise exception 'Solo se pueden anular vales pendientes'; end if; update public.petty_cash_vale set status = 'ANULADO' where id = p_vale_id; if v_payment is not null then update public.payment set status = 'ANULADO', void_reason = 'Anulación de vale de caja chica N.º ' || v_serial, voided_at = now() where id = v_payment and status in ('EN_REVISION', 'PROCESADO'); end if; end; $function$

TRIGGERS
TRIGGER public.bank_reconciliation bank_reconciliation_set_updated_at enabled=O definition=CREATE TRIGGER bank_reconciliation_set_updated_at BEFORE UPDATE ON public.bank_reconciliation FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
TRIGGER public.bank_reconciliation trg_bank_reconciliation_owner_id enabled=O definition=CREATE TRIGGER trg_bank_reconciliation_owner_id BEFORE INSERT ON public.bank_reconciliation FOR EACH ROW EXECUTE FUNCTION public.set_owner_id_on_insert()
TRIGGER public.cash_account cash_account_set_updated_at enabled=O definition=CREATE TRIGGER cash_account_set_updated_at BEFORE UPDATE ON public.cash_account FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
TRIGGER public.cash_account trg_cash_account_owner_id enabled=O definition=CREATE TRIGGER trg_cash_account_owner_id BEFORE INSERT ON public.cash_account FOR EACH ROW EXECUTE FUNCTION public.set_owner_id_on_insert()
TRIGGER public.cash_close cash_close_owner_consistency enabled=O definition=CREATE TRIGGER cash_close_owner_consistency BEFORE INSERT OR UPDATE ON public.cash_close FOR EACH ROW EXECUTE FUNCTION private.assert_owner_consistency()
TRIGGER public.cash_count trg_cash_count_owner_id enabled=O definition=CREATE TRIGGER trg_cash_count_owner_id BEFORE INSERT ON public.cash_count FOR EACH ROW EXECUTE FUNCTION public.set_owner_id_on_insert()
TRIGGER public.cash_transfer cash_transfer_owner_consistency enabled=O definition=CREATE TRIGGER cash_transfer_owner_consistency BEFORE INSERT OR UPDATE ON public.cash_transfer FOR EACH ROW EXECUTE FUNCTION private.assert_owner_consistency()
TRIGGER public.comprobante comprobante_adjustment_status enabled=O definition=CREATE TRIGGER comprobante_adjustment_status AFTER INSERT OR DELETE OR UPDATE ON public.comprobante FOR EACH ROW EXECUTE FUNCTION private.refresh_referenced_status()
TRIGGER public.comprobante comprobante_owner_consistency enabled=O definition=CREATE TRIGGER comprobante_owner_consistency BEFORE INSERT OR UPDATE ON public.comprobante FOR EACH ROW EXECUTE FUNCTION private.assert_owner_consistency()
TRIGGER public.comprobante comprobante_protect_paid enabled=O definition=CREATE TRIGGER comprobante_protect_paid BEFORE UPDATE ON public.comprobante FOR EACH ROW EXECUTE FUNCTION private.protect_paid_comprobante()
TRIGGER public.comprobante comprobante_set_updated_at enabled=O definition=CREATE TRIGGER comprobante_set_updated_at BEFORE UPDATE ON public.comprobante FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
TRIGGER public.comprobante comprobante_validate_adjustment enabled=O definition=CREATE TRIGGER comprobante_validate_adjustment BEFORE INSERT OR UPDATE ON public.comprobante FOR EACH ROW EXECUTE FUNCTION private.validate_comprobante_adjustment()
TRIGGER public.comprobante trg_comprobante_owner_id enabled=O definition=CREATE TRIGGER trg_comprobante_owner_id BEFORE INSERT ON public.comprobante FOR EACH ROW EXECUTE FUNCTION public.set_owner_id_on_insert()
TRIGGER public.entidad entidad_set_updated_at enabled=O definition=CREATE TRIGGER entidad_set_updated_at BEFORE UPDATE ON public.entidad FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
TRIGGER public.entidad trg_entidad_owner_id enabled=O definition=CREATE TRIGGER trg_entidad_owner_id BEFORE INSERT ON public.entidad FOR EACH ROW EXECUTE FUNCTION public.set_owner_id_on_insert()
TRIGGER public.payment payment_account_open_guard enabled=O definition=CREATE TRIGGER payment_account_open_guard BEFORE INSERT OR UPDATE ON public.payment FOR EACH ROW EXECUTE FUNCTION private.assert_payment_account_open()
TRIGGER public.payment payment_assign_receipt enabled=O definition=CREATE TRIGGER payment_assign_receipt BEFORE INSERT ON public.payment FOR EACH ROW EXECUTE FUNCTION private.assign_receipt_number()
TRIGGER public.payment payment_freeze_amount enabled=O definition=CREATE TRIGGER payment_freeze_amount BEFORE UPDATE OF amount ON public.payment FOR EACH ROW EXECUTE FUNCTION private.payment_freeze_amount()
TRIGGER public.payment payment_guard_history_mutation enabled=O definition=CREATE TRIGGER payment_guard_history_mutation BEFORE UPDATE ON public.payment FOR EACH ROW EXECUTE FUNCTION private.payment_guard_history_mutation()
TRIGGER public.payment payment_owner_consistency enabled=O definition=CREATE TRIGGER payment_owner_consistency BEFORE INSERT OR UPDATE ON public.payment FOR EACH ROW EXECUTE FUNCTION private.assert_owner_consistency()
TRIGGER public.payment payment_set_updated_at enabled=O definition=CREATE TRIGGER payment_set_updated_at BEFORE UPDATE ON public.payment FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()
TRIGGER public.payment payment_status_refresh enabled=O definition=CREATE TRIGGER payment_status_refresh AFTER UPDATE ON public.payment FOR EACH ROW EXECUTE FUNCTION private.payment_refresh_status()
TRIGGER public.payment trg_payment_owner_id enabled=O definition=CREATE TRIGGER trg_payment_owner_id BEFORE INSERT ON public.payment FOR EACH ROW EXECUTE FUNCTION public.set_owner_id_on_insert()
TRIGGER public.payment_allocation payment_allocation_account_open_guard enabled=O definition=CREATE TRIGGER payment_allocation_account_open_guard BEFORE INSERT OR UPDATE ON public.payment_allocation FOR EACH ROW EXECUTE FUNCTION private.assert_allocation_payment_open()
TRIGGER public.payment_allocation payment_allocation_owner_consistency enabled=O definition=CREATE TRIGGER payment_allocation_owner_consistency BEFORE INSERT OR UPDATE ON public.payment_allocation FOR EACH ROW EXECUTE FUNCTION private.assert_owner_consistency()
TRIGGER public.payment_allocation payment_allocation_status enabled=O definition=CREATE TRIGGER payment_allocation_status AFTER INSERT OR DELETE OR UPDATE ON public.payment_allocation FOR EACH ROW EXECUTE FUNCTION private.allocation_refresh_status()
TRIGGER public.payment_allocation payment_allocation_validate enabled=O definition=CREATE TRIGGER payment_allocation_validate BEFORE INSERT OR UPDATE ON public.payment_allocation FOR EACH ROW EXECUTE FUNCTION private.validate_allocation()
TRIGGER public.payment_allocation trg_payment_allocation_owner_id enabled=O definition=CREATE TRIGGER trg_payment_allocation_owner_id BEFORE INSERT ON public.payment_allocation FOR EACH ROW EXECUTE FUNCTION public.set_owner_id_on_insert()
TRIGGER public.petty_cash_vale trg_petty_cash_vale_owner_id enabled=O definition=CREATE TRIGGER trg_petty_cash_vale_owner_id BEFORE INSERT ON public.petty_cash_vale FOR EACH ROW EXECUTE FUNCTION public.set_owner_id_on_insert()
TRIGGER public.voucher_series trg_voucher_series_owner_id enabled=O definition=CREATE TRIGGER trg_voucher_series_owner_id BEFORE INSERT ON public.voucher_series FOR EACH ROW EXECUTE FUNCTION public.set_owner_id_on_insert()
TRIGGER public.voucher_series voucher_series_set_updated_at enabled=O definition=CREATE TRIGGER voucher_series_set_updated_at BEFORE UPDATE ON public.voucher_series FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()

POLICIES
POLICY public.app_setting app_setting_delete command=delete permissive=true roles=authenticated using=(owner_id = auth.uid()) check=-
POLICY public.app_setting app_setting_insert command=insert permissive=true roles=authenticated using=- check=(owner_id = auth.uid())
POLICY public.app_setting app_setting_select command=select permissive=true roles=authenticated using=(owner_id = auth.uid()) check=-
POLICY public.app_setting app_setting_update command=update permissive=true roles=authenticated using=(owner_id = auth.uid()) check=(owner_id = auth.uid())
POLICY public.bank_reconciliation bank_reconciliation_select command=select permissive=true roles=authenticated using=(owner_id = ( SELECT auth.uid() AS uid)) check=-
POLICY public.bank_reconciliation_item bank_reconciliation_item_select command=select permissive=true roles=authenticated using=(EXISTS ( SELECT 1 FROM public.bank_reconciliation r WHERE ((r.id = bank_reconciliation_item.reconciliation_id) AND (r.owner_id = ( SELECT auth.uid() AS uid))))) check=-
POLICY public.cash_account cash_account_delete command=delete permissive=true roles=authenticated using=(owner_id = auth.uid()) check=-
POLICY public.cash_account cash_account_insert command=insert permissive=true roles=authenticated using=- check=(owner_id = auth.uid())
POLICY public.cash_account cash_account_select command=select permissive=true roles=authenticated using=(owner_id = auth.uid()) check=-
POLICY public.cash_account cash_account_update command=update permissive=true roles=authenticated using=(owner_id = auth.uid()) check=(owner_id = auth.uid())
POLICY public.cash_close cash_close_select command=select permissive=true roles=authenticated using=(owner_id = auth.uid()) check=-
POLICY public.cash_close_denomination cash_close_denomination_select command=select permissive=true roles=authenticated using=(EXISTS ( SELECT 1 FROM public.cash_close c WHERE ((c.id = cash_close_denomination.cash_close_id) AND (c.owner_id = auth.uid())))) check=-
POLICY public.cash_count cash_count_select command=select permissive=true roles=authenticated using=(owner_id = ( SELECT auth.uid() AS uid)) check=-
POLICY public.cash_count_denomination cash_count_denomination_select command=select permissive=true roles=authenticated using=(EXISTS ( SELECT 1 FROM public.cash_count c WHERE ((c.id = cash_count_denomination.cash_count_id) AND (c.owner_id = ( SELECT auth.uid() AS uid))))) check=-
POLICY public.cash_receipt_category cash_receipt_category_delete command=delete permissive=true roles=authenticated using=(owner_id = auth.uid()) check=-
POLICY public.cash_receipt_category cash_receipt_category_insert command=insert permissive=true roles=authenticated using=- check=(owner_id = auth.uid())
POLICY public.cash_receipt_category cash_receipt_category_select command=select permissive=true roles=authenticated using=(owner_id = auth.uid()) check=-
POLICY public.cash_receipt_category cash_receipt_category_update command=update permissive=true roles=authenticated using=(owner_id = auth.uid()) check=(owner_id = auth.uid())
POLICY public.cash_transfer cash_transfer_select command=select permissive=true roles=authenticated using=(owner_id = auth.uid()) check=-
POLICY public.comprobante comprobante_insert command=insert permissive=true roles=authenticated using=- check=(owner_id = auth.uid())
POLICY public.comprobante comprobante_select command=select permissive=true roles=authenticated using=(owner_id = auth.uid()) check=-
POLICY public.comprobante comprobante_update command=update permissive=true roles=authenticated using=(owner_id = auth.uid()) check=(owner_id = auth.uid())
POLICY public.entidad entidad_delete command=delete permissive=true roles=authenticated using=(owner_id = auth.uid()) check=-
POLICY public.entidad entidad_insert command=insert permissive=true roles=authenticated using=- check=(owner_id = auth.uid())
POLICY public.entidad entidad_select command=select permissive=true roles=authenticated using=(owner_id = auth.uid()) check=-
POLICY public.entidad entidad_update command=update permissive=true roles=authenticated using=(owner_id = auth.uid()) check=(owner_id = auth.uid())
POLICY public.payment payment_select command=select permissive=true roles=authenticated using=(owner_id = auth.uid()) check=-
POLICY public.payment payment_update command=update permissive=true roles=authenticated using=(owner_id = auth.uid()) check=(owner_id = auth.uid())
POLICY public.payment_allocation payment_allocation_insert command=insert permissive=true roles=authenticated using=- check=(owner_id = auth.uid())
POLICY public.payment_allocation payment_allocation_select command=select permissive=true roles=authenticated using=(owner_id = auth.uid()) check=-
POLICY public.payment_method payment_method_delete command=delete permissive=true roles=authenticated using=(owner_id = auth.uid()) check=-
POLICY public.payment_method payment_method_insert command=insert permissive=true roles=authenticated using=- check=(owner_id = auth.uid())
POLICY public.payment_method payment_method_select command=select permissive=true roles=authenticated using=(owner_id = auth.uid()) check=-
POLICY public.payment_method payment_method_update command=update permissive=true roles=authenticated using=(owner_id = auth.uid()) check=(owner_id = auth.uid())
POLICY public.petty_cash_vale petty_cash_vale_select command=select permissive=true roles=authenticated using=(owner_id = auth.uid()) check=-
POLICY public.voucher_series voucher_series_delete command=delete permissive=true roles=authenticated using=(owner_id = ( SELECT auth.uid() AS uid)) check=-
POLICY public.voucher_series voucher_series_insert command=insert permissive=true roles=authenticated using=- check=(owner_id = ( SELECT auth.uid() AS uid))
POLICY public.voucher_series voucher_series_select command=select permissive=true roles=authenticated using=(owner_id = ( SELECT auth.uid() AS uid)) check=-
POLICY public.voucher_series voucher_series_update command=update permissive=true roles=authenticated using=(owner_id = ( SELECT auth.uid() AS uid)) check=(owner_id = ( SELECT auth.uid() AS uid))

PRIVILEGES
DEFAULT ACL IN SCHEMA public FOR TABLES GRANT DELETE TO authenticated
DEFAULT ACL IN SCHEMA public FOR TABLES GRANT DELETE TO service_role
DEFAULT ACL IN SCHEMA public FOR TABLES GRANT INSERT TO authenticated
DEFAULT ACL IN SCHEMA public FOR TABLES GRANT INSERT TO service_role
DEFAULT ACL IN SCHEMA public FOR TABLES GRANT SELECT TO authenticated
DEFAULT ACL IN SCHEMA public FOR TABLES GRANT SELECT TO service_role
DEFAULT ACL IN SCHEMA public FOR TABLES GRANT UPDATE TO authenticated
DEFAULT ACL IN SCHEMA public FOR TABLES GRANT UPDATE TO service_role
GRANT CREATE ON SCHEMA auth TO OWNER
GRANT CREATE ON SCHEMA public TO OWNER
GRANT DELETE ON TABLE public.__sql_migrations TO OWNER
GRANT DELETE ON TABLE public.__sql_migrations TO service_role
GRANT DELETE ON TABLE public.app_setting TO OWNER
GRANT DELETE ON TABLE public.app_setting TO authenticated
GRANT DELETE ON TABLE public.app_setting TO service_role
GRANT DELETE ON TABLE public.bank_reconciliation TO OWNER
GRANT DELETE ON TABLE public.bank_reconciliation TO service_role
GRANT DELETE ON TABLE public.bank_reconciliation_item TO OWNER
GRANT DELETE ON TABLE public.bank_reconciliation_item TO service_role
GRANT DELETE ON TABLE public.cash_account TO OWNER
GRANT DELETE ON TABLE public.cash_account TO authenticated
GRANT DELETE ON TABLE public.cash_account TO service_role
GRANT DELETE ON TABLE public.cash_close TO OWNER
GRANT DELETE ON TABLE public.cash_close TO service_role
GRANT DELETE ON TABLE public.cash_close_denomination TO OWNER
GRANT DELETE ON TABLE public.cash_close_denomination TO service_role
GRANT DELETE ON TABLE public.cash_count TO OWNER
GRANT DELETE ON TABLE public.cash_count TO service_role
GRANT DELETE ON TABLE public.cash_count_denomination TO OWNER
GRANT DELETE ON TABLE public.cash_count_denomination TO service_role
GRANT DELETE ON TABLE public.cash_receipt_category TO OWNER
GRANT DELETE ON TABLE public.cash_receipt_category TO authenticated
GRANT DELETE ON TABLE public.cash_receipt_category TO service_role
GRANT DELETE ON TABLE public.cash_transfer TO OWNER
GRANT DELETE ON TABLE public.cash_transfer TO service_role
GRANT DELETE ON TABLE public.comprobante TO OWNER
GRANT DELETE ON TABLE public.comprobante TO service_role
GRANT DELETE ON TABLE public.entidad TO OWNER
GRANT DELETE ON TABLE public.entidad TO authenticated
GRANT DELETE ON TABLE public.entidad TO service_role
GRANT DELETE ON TABLE public.payment TO OWNER
GRANT DELETE ON TABLE public.payment TO service_role
GRANT DELETE ON TABLE public.payment_allocation TO OWNER
GRANT DELETE ON TABLE public.payment_allocation TO service_role
GRANT DELETE ON TABLE public.payment_balance TO OWNER
GRANT DELETE ON TABLE public.payment_balance TO authenticated
GRANT DELETE ON TABLE public.payment_balance TO service_role
GRANT DELETE ON TABLE public.payment_method TO OWNER
GRANT DELETE ON TABLE public.payment_method TO authenticated
GRANT DELETE ON TABLE public.payment_method TO service_role
GRANT DELETE ON TABLE public.petty_cash_vale TO OWNER
GRANT DELETE ON TABLE public.petty_cash_vale TO service_role
GRANT DELETE ON TABLE public.receipt_sequence TO OWNER
GRANT DELETE ON TABLE public.receipt_sequence TO service_role
GRANT DELETE ON TABLE public.voucher_balance TO OWNER
GRANT DELETE ON TABLE public.voucher_balance TO authenticated
GRANT DELETE ON TABLE public.voucher_balance TO service_role
GRANT DELETE ON TABLE public.voucher_series TO OWNER
GRANT DELETE ON TABLE public.voucher_series TO service_role
GRANT EXECUTE ON FUNCTION private.assert_owner_consistency() TO OWNER
GRANT EXECUTE ON FUNCTION public.close_cash_account(p_cash_account_id uuid, p_period_end date, p_counted_balance numeric, p_notes text, p_denominations jsonb, p_difference_reason text, p_counted_by text, p_verified_by text) TO OWNER
GRANT EXECUTE ON FUNCTION public.close_cash_account(p_cash_account_id uuid, p_period_end date, p_counted_balance numeric, p_notes text, p_denominations jsonb, p_difference_reason text, p_counted_by text, p_verified_by text) TO authenticated
GRANT EXECUTE ON FUNCTION public.close_cash_account(p_cash_account_id uuid, p_period_end date, p_counted_balance numeric, p_notes text, p_denominations jsonb, p_difference_reason text, p_counted_by text, p_verified_by text) TO service_role
GRANT EXECUTE ON FUNCTION public.crear_serie(p_voucher_type public.voucher_type, p_code text, p_is_default boolean) TO OWNER
GRANT EXECUTE ON FUNCTION public.crear_serie(p_voucher_type public.voucher_type, p_code text, p_is_default boolean) TO authenticated
GRANT EXECUTE ON FUNCTION public.crear_serie(p_voucher_type public.voucher_type, p_code text, p_is_default boolean) TO service_role
GRANT EXECUTE ON FUNCTION public.crear_venta(p_entity_id uuid, p_voucher_type public.voucher_type, p_issue_date date, p_subtotal numeric, p_igv numeric, p_total numeric, p_payment_type public.payment_type, p_credit_days integer) TO OWNER
GRANT EXECUTE ON FUNCTION public.crear_venta(p_entity_id uuid, p_voucher_type public.voucher_type, p_issue_date date, p_subtotal numeric, p_igv numeric, p_total numeric, p_payment_type public.payment_type, p_credit_days integer) TO authenticated
GRANT EXECUTE ON FUNCTION public.crear_venta(p_entity_id uuid, p_voucher_type public.voucher_type, p_issue_date date, p_subtotal numeric, p_igv numeric, p_total numeric, p_payment_type public.payment_type, p_credit_days integer) TO service_role
GRANT EXECUTE ON FUNCTION public.create_cash_transfer(p_source_account_id uuid, p_target_account_id uuid, p_amount numeric, p_transfer_date date, p_notes text) TO OWNER
GRANT EXECUTE ON FUNCTION public.create_cash_transfer(p_source_account_id uuid, p_target_account_id uuid, p_amount numeric, p_transfer_date date, p_notes text) TO authenticated
GRANT EXECUTE ON FUNCTION public.create_cash_transfer(p_source_account_id uuid, p_target_account_id uuid, p_amount numeric, p_transfer_date date, p_notes text) TO service_role
GRANT EXECUTE ON FUNCTION public.create_payment_with_allocations(p_entity_id uuid, p_direction public.payment_direction, p_payment_date date, p_amount numeric, p_method_id uuid, p_cash_account_id uuid, p_category_id uuid, p_reference text, p_notes text, p_allocations jsonb, p_is_cash_movement boolean) TO OWNER
GRANT EXECUTE ON FUNCTION public.create_payment_with_allocations(p_entity_id uuid, p_direction public.payment_direction, p_payment_date date, p_amount numeric, p_method_id uuid, p_cash_account_id uuid, p_category_id uuid, p_reference text, p_notes text, p_allocations jsonb, p_is_cash_movement boolean) TO authenticated
GRANT EXECUTE ON FUNCTION public.create_payment_with_allocations(p_entity_id uuid, p_direction public.payment_direction, p_payment_date date, p_amount numeric, p_method_id uuid, p_cash_account_id uuid, p_category_id uuid, p_reference text, p_notes text, p_allocations jsonb, p_is_cash_movement boolean) TO service_role
GRANT EXECUTE ON FUNCTION public.create_petty_cash_vale(p_account_id uuid, p_vale_date date, p_paid_to character varying, p_concept character varying, p_amount numeric, p_has_receipt boolean, p_category_id uuid) TO OWNER
GRANT EXECUTE ON FUNCTION public.create_petty_cash_vale(p_account_id uuid, p_vale_date date, p_paid_to character varying, p_concept character varying, p_amount numeric, p_has_receipt boolean, p_category_id uuid) TO authenticated
GRANT EXECUTE ON FUNCTION public.create_petty_cash_vale(p_account_id uuid, p_vale_date date, p_paid_to character varying, p_concept character varying, p_amount numeric, p_has_receipt boolean, p_category_id uuid) TO service_role
GRANT EXECUTE ON FUNCTION public.editar_serie(p_serie_id uuid, p_code text, p_is_default boolean) TO OWNER
GRANT EXECUTE ON FUNCTION public.editar_serie(p_serie_id uuid, p_code text, p_is_default boolean) TO authenticated
GRANT EXECUTE ON FUNCTION public.editar_serie(p_serie_id uuid, p_code text, p_is_default boolean) TO service_role
GRANT EXECUTE ON FUNCTION public.editar_venta(p_comprobante_id uuid, p_entity_id uuid, p_voucher_type public.voucher_type, p_issue_date date, p_subtotal numeric, p_igv numeric, p_total numeric, p_payment_type public.payment_type, p_credit_days integer) TO OWNER
GRANT EXECUTE ON FUNCTION public.editar_venta(p_comprobante_id uuid, p_entity_id uuid, p_voucher_type public.voucher_type, p_issue_date date, p_subtotal numeric, p_igv numeric, p_total numeric, p_payment_type public.payment_type, p_credit_days integer) TO authenticated
GRANT EXECUTE ON FUNCTION public.editar_venta(p_comprobante_id uuid, p_entity_id uuid, p_voucher_type public.voucher_type, p_issue_date date, p_subtotal numeric, p_igv numeric, p_total numeric, p_payment_type public.payment_type, p_credit_days integer) TO service_role
GRANT EXECUTE ON FUNCTION public.eliminar_serie(p_serie_id uuid) TO OWNER
GRANT EXECUTE ON FUNCTION public.eliminar_serie(p_serie_id uuid) TO authenticated
GRANT EXECUTE ON FUNCTION public.eliminar_serie(p_serie_id uuid) TO service_role
GRANT EXECUTE ON FUNCTION public.get_cash_position(p_cash_account_id uuid, p_as_of date) TO OWNER
GRANT EXECUTE ON FUNCTION public.get_cash_position(p_cash_account_id uuid, p_as_of date) TO authenticated
GRANT EXECUTE ON FUNCTION public.get_cash_position(p_cash_account_id uuid, p_as_of date) TO service_role
GRANT EXECUTE ON FUNCTION public.list_last_movement_dates() TO OWNER
GRANT EXECUTE ON FUNCTION public.list_last_movement_dates() TO authenticated
GRANT EXECUTE ON FUNCTION public.mark_payments_processed(p_payment_ids uuid[]) TO OWNER
GRANT EXECUTE ON FUNCTION public.mark_payments_processed(p_payment_ids uuid[]) TO authenticated
GRANT EXECUTE ON FUNCTION public.mark_payments_processed(p_payment_ids uuid[]) TO service_role
GRANT EXECUTE ON FUNCTION public.register_cash_count(p_cash_account_id uuid, p_count_date date, p_counted_balance numeric, p_denominations jsonb, p_counted_by text, p_notes text) TO OWNER
GRANT EXECUTE ON FUNCTION public.register_cash_count(p_cash_account_id uuid, p_count_date date, p_counted_balance numeric, p_denominations jsonb, p_counted_by text, p_notes text) TO authenticated
GRANT EXECUTE ON FUNCTION public.register_cash_count(p_cash_account_id uuid, p_count_date date, p_counted_balance numeric, p_denominations jsonb, p_counted_by text, p_notes text) TO service_role
GRANT EXECUTE ON FUNCTION public.replenish_petty_cash(p_account_id uuid, p_source_account_id uuid, p_vale_ids uuid[]) TO OWNER
GRANT EXECUTE ON FUNCTION public.replenish_petty_cash(p_account_id uuid, p_source_account_id uuid, p_vale_ids uuid[]) TO authenticated
GRANT EXECUTE ON FUNCTION public.replenish_petty_cash(p_account_id uuid, p_source_account_id uuid, p_vale_ids uuid[]) TO service_role
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO OWNER
GRANT EXECUTE ON FUNCTION public.save_bank_reconciliation(p_reconciliation jsonb, p_items jsonb) TO OWNER
GRANT EXECUTE ON FUNCTION public.save_bank_reconciliation(p_reconciliation jsonb, p_items jsonb) TO authenticated
GRANT EXECUTE ON FUNCTION public.save_bank_reconciliation(p_reconciliation jsonb, p_items jsonb) TO service_role
GRANT EXECUTE ON FUNCTION public.void_petty_cash_vale(p_vale_id uuid) TO OWNER
GRANT EXECUTE ON FUNCTION public.void_petty_cash_vale(p_vale_id uuid) TO authenticated
GRANT EXECUTE ON FUNCTION public.void_petty_cash_vale(p_vale_id uuid) TO service_role
GRANT INSERT ON TABLE public.__sql_migrations TO OWNER
GRANT INSERT ON TABLE public.__sql_migrations TO service_role
GRANT INSERT ON TABLE public.app_setting TO OWNER
GRANT INSERT ON TABLE public.app_setting TO authenticated
GRANT INSERT ON TABLE public.app_setting TO service_role
GRANT INSERT ON TABLE public.bank_reconciliation TO OWNER
GRANT INSERT ON TABLE public.bank_reconciliation TO authenticated
GRANT INSERT ON TABLE public.bank_reconciliation TO service_role
GRANT INSERT ON TABLE public.bank_reconciliation_item TO OWNER
GRANT INSERT ON TABLE public.bank_reconciliation_item TO authenticated
GRANT INSERT ON TABLE public.bank_reconciliation_item TO service_role
GRANT INSERT ON TABLE public.cash_account TO OWNER
GRANT INSERT ON TABLE public.cash_account TO authenticated
GRANT INSERT ON TABLE public.cash_account TO service_role
GRANT INSERT ON TABLE public.cash_close TO OWNER
GRANT INSERT ON TABLE public.cash_close TO authenticated
GRANT INSERT ON TABLE public.cash_close TO service_role
GRANT INSERT ON TABLE public.cash_close_denomination TO OWNER
GRANT INSERT ON TABLE public.cash_close_denomination TO authenticated
GRANT INSERT ON TABLE public.cash_close_denomination TO service_role
GRANT INSERT ON TABLE public.cash_count TO OWNER
GRANT INSERT ON TABLE public.cash_count TO authenticated
GRANT INSERT ON TABLE public.cash_count TO service_role
GRANT INSERT ON TABLE public.cash_count_denomination TO OWNER
GRANT INSERT ON TABLE public.cash_count_denomination TO authenticated
GRANT INSERT ON TABLE public.cash_count_denomination TO service_role
GRANT INSERT ON TABLE public.cash_receipt_category TO OWNER
GRANT INSERT ON TABLE public.cash_receipt_category TO authenticated
GRANT INSERT ON TABLE public.cash_receipt_category TO service_role
GRANT INSERT ON TABLE public.cash_transfer TO OWNER
GRANT INSERT ON TABLE public.cash_transfer TO authenticated
GRANT INSERT ON TABLE public.cash_transfer TO service_role
GRANT INSERT ON TABLE public.comprobante TO OWNER
GRANT INSERT ON TABLE public.comprobante TO authenticated
GRANT INSERT ON TABLE public.comprobante TO service_role
GRANT INSERT ON TABLE public.entidad TO OWNER
GRANT INSERT ON TABLE public.entidad TO authenticated
GRANT INSERT ON TABLE public.entidad TO service_role
GRANT INSERT ON TABLE public.payment TO OWNER
GRANT INSERT ON TABLE public.payment TO authenticated
GRANT INSERT ON TABLE public.payment TO service_role
GRANT INSERT ON TABLE public.payment_allocation TO OWNER
GRANT INSERT ON TABLE public.payment_allocation TO authenticated
GRANT INSERT ON TABLE public.payment_allocation TO service_role
GRANT INSERT ON TABLE public.payment_balance TO OWNER
GRANT INSERT ON TABLE public.payment_balance TO authenticated
GRANT INSERT ON TABLE public.payment_balance TO service_role
GRANT INSERT ON TABLE public.payment_method TO OWNER
GRANT INSERT ON TABLE public.payment_method TO authenticated
GRANT INSERT ON TABLE public.payment_method TO service_role
GRANT INSERT ON TABLE public.petty_cash_vale TO OWNER
GRANT INSERT ON TABLE public.petty_cash_vale TO authenticated
GRANT INSERT ON TABLE public.petty_cash_vale TO service_role
GRANT INSERT ON TABLE public.receipt_sequence TO OWNER
GRANT INSERT ON TABLE public.receipt_sequence TO authenticated
GRANT INSERT ON TABLE public.receipt_sequence TO service_role
GRANT INSERT ON TABLE public.voucher_balance TO OWNER
GRANT INSERT ON TABLE public.voucher_balance TO authenticated
GRANT INSERT ON TABLE public.voucher_balance TO service_role
GRANT INSERT ON TABLE public.voucher_series TO OWNER
GRANT INSERT ON TABLE public.voucher_series TO authenticated
GRANT INSERT ON TABLE public.voucher_series TO service_role
GRANT MAINTAIN ON TABLE public.__sql_migrations TO OWNER
GRANT MAINTAIN ON TABLE public.app_setting TO OWNER
GRANT MAINTAIN ON TABLE public.bank_reconciliation TO OWNER
GRANT MAINTAIN ON TABLE public.bank_reconciliation_item TO OWNER
GRANT MAINTAIN ON TABLE public.cash_account TO OWNER
GRANT MAINTAIN ON TABLE public.cash_close TO OWNER
GRANT MAINTAIN ON TABLE public.cash_close_denomination TO OWNER
GRANT MAINTAIN ON TABLE public.cash_count TO OWNER
GRANT MAINTAIN ON TABLE public.cash_count_denomination TO OWNER
GRANT MAINTAIN ON TABLE public.cash_receipt_category TO OWNER
GRANT MAINTAIN ON TABLE public.cash_transfer TO OWNER
GRANT MAINTAIN ON TABLE public.comprobante TO OWNER
GRANT MAINTAIN ON TABLE public.entidad TO OWNER
GRANT MAINTAIN ON TABLE public.payment TO OWNER
GRANT MAINTAIN ON TABLE public.payment_allocation TO OWNER
GRANT MAINTAIN ON TABLE public.payment_balance TO OWNER
GRANT MAINTAIN ON TABLE public.payment_method TO OWNER
GRANT MAINTAIN ON TABLE public.petty_cash_vale TO OWNER
GRANT MAINTAIN ON TABLE public.receipt_sequence TO OWNER
GRANT MAINTAIN ON TABLE public.voucher_balance TO OWNER
GRANT MAINTAIN ON TABLE public.voucher_series TO OWNER
GRANT REFERENCES ON TABLE public.__sql_migrations TO OWNER
GRANT REFERENCES ON TABLE public.app_setting TO OWNER
GRANT REFERENCES ON TABLE public.bank_reconciliation TO OWNER
GRANT REFERENCES ON TABLE public.bank_reconciliation_item TO OWNER
GRANT REFERENCES ON TABLE public.cash_account TO OWNER
GRANT REFERENCES ON TABLE public.cash_close TO OWNER
GRANT REFERENCES ON TABLE public.cash_close_denomination TO OWNER
GRANT REFERENCES ON TABLE public.cash_count TO OWNER
GRANT REFERENCES ON TABLE public.cash_count_denomination TO OWNER
GRANT REFERENCES ON TABLE public.cash_receipt_category TO OWNER
GRANT REFERENCES ON TABLE public.cash_transfer TO OWNER
GRANT REFERENCES ON TABLE public.comprobante TO OWNER
GRANT REFERENCES ON TABLE public.entidad TO OWNER
GRANT REFERENCES ON TABLE public.payment TO OWNER
GRANT REFERENCES ON TABLE public.payment_allocation TO OWNER
GRANT REFERENCES ON TABLE public.payment_balance TO OWNER
GRANT REFERENCES ON TABLE public.payment_method TO OWNER
GRANT REFERENCES ON TABLE public.petty_cash_vale TO OWNER
GRANT REFERENCES ON TABLE public.receipt_sequence TO OWNER
GRANT REFERENCES ON TABLE public.voucher_balance TO OWNER
GRANT REFERENCES ON TABLE public.voucher_series TO OWNER
GRANT SELECT ON TABLE public.__sql_migrations TO OWNER
GRANT SELECT ON TABLE public.__sql_migrations TO service_role
GRANT SELECT ON TABLE public.app_setting TO OWNER
GRANT SELECT ON TABLE public.app_setting TO authenticated
GRANT SELECT ON TABLE public.app_setting TO service_role
GRANT SELECT ON TABLE public.bank_reconciliation TO OWNER
GRANT SELECT ON TABLE public.bank_reconciliation TO authenticated
GRANT SELECT ON TABLE public.bank_reconciliation TO service_role
GRANT SELECT ON TABLE public.bank_reconciliation_item TO OWNER
GRANT SELECT ON TABLE public.bank_reconciliation_item TO authenticated
GRANT SELECT ON TABLE public.bank_reconciliation_item TO service_role
GRANT SELECT ON TABLE public.cash_account TO OWNER
GRANT SELECT ON TABLE public.cash_account TO authenticated
GRANT SELECT ON TABLE public.cash_account TO service_role
GRANT SELECT ON TABLE public.cash_close TO OWNER
GRANT SELECT ON TABLE public.cash_close TO authenticated
GRANT SELECT ON TABLE public.cash_close TO service_role
GRANT SELECT ON TABLE public.cash_close_denomination TO OWNER
GRANT SELECT ON TABLE public.cash_close_denomination TO authenticated
GRANT SELECT ON TABLE public.cash_close_denomination TO service_role
GRANT SELECT ON TABLE public.cash_count TO OWNER
GRANT SELECT ON TABLE public.cash_count TO authenticated
GRANT SELECT ON TABLE public.cash_count TO service_role
GRANT SELECT ON TABLE public.cash_count_denomination TO OWNER
GRANT SELECT ON TABLE public.cash_count_denomination TO authenticated
GRANT SELECT ON TABLE public.cash_count_denomination TO service_role
GRANT SELECT ON TABLE public.cash_receipt_category TO OWNER
GRANT SELECT ON TABLE public.cash_receipt_category TO authenticated
GRANT SELECT ON TABLE public.cash_receipt_category TO service_role
GRANT SELECT ON TABLE public.cash_transfer TO OWNER
GRANT SELECT ON TABLE public.cash_transfer TO authenticated
GRANT SELECT ON TABLE public.cash_transfer TO service_role
GRANT SELECT ON TABLE public.comprobante TO OWNER
GRANT SELECT ON TABLE public.comprobante TO authenticated
GRANT SELECT ON TABLE public.comprobante TO service_role
GRANT SELECT ON TABLE public.entidad TO OWNER
GRANT SELECT ON TABLE public.entidad TO authenticated
GRANT SELECT ON TABLE public.entidad TO service_role
GRANT SELECT ON TABLE public.payment TO OWNER
GRANT SELECT ON TABLE public.payment TO authenticated
GRANT SELECT ON TABLE public.payment TO service_role
GRANT SELECT ON TABLE public.payment_allocation TO OWNER
GRANT SELECT ON TABLE public.payment_allocation TO authenticated
GRANT SELECT ON TABLE public.payment_allocation TO service_role
GRANT SELECT ON TABLE public.payment_balance TO OWNER
GRANT SELECT ON TABLE public.payment_balance TO anon
GRANT SELECT ON TABLE public.payment_balance TO authenticated
GRANT SELECT ON TABLE public.payment_balance TO service_role
GRANT SELECT ON TABLE public.payment_method TO OWNER
GRANT SELECT ON TABLE public.payment_method TO authenticated
GRANT SELECT ON TABLE public.payment_method TO service_role
GRANT SELECT ON TABLE public.petty_cash_vale TO OWNER
GRANT SELECT ON TABLE public.petty_cash_vale TO authenticated
GRANT SELECT ON TABLE public.petty_cash_vale TO service_role
GRANT SELECT ON TABLE public.receipt_sequence TO OWNER
GRANT SELECT ON TABLE public.receipt_sequence TO authenticated
GRANT SELECT ON TABLE public.receipt_sequence TO service_role
GRANT SELECT ON TABLE public.voucher_balance TO OWNER
GRANT SELECT ON TABLE public.voucher_balance TO anon
GRANT SELECT ON TABLE public.voucher_balance TO authenticated
GRANT SELECT ON TABLE public.voucher_balance TO service_role
GRANT SELECT ON TABLE public.voucher_series TO OWNER
GRANT SELECT ON TABLE public.voucher_series TO authenticated
GRANT SELECT ON TABLE public.voucher_series TO service_role
GRANT TRIGGER ON TABLE public.__sql_migrations TO OWNER
GRANT TRIGGER ON TABLE public.app_setting TO OWNER
GRANT TRIGGER ON TABLE public.bank_reconciliation TO OWNER
GRANT TRIGGER ON TABLE public.bank_reconciliation_item TO OWNER
GRANT TRIGGER ON TABLE public.cash_account TO OWNER
GRANT TRIGGER ON TABLE public.cash_close TO OWNER
GRANT TRIGGER ON TABLE public.cash_close_denomination TO OWNER
GRANT TRIGGER ON TABLE public.cash_count TO OWNER
GRANT TRIGGER ON TABLE public.cash_count_denomination TO OWNER
GRANT TRIGGER ON TABLE public.cash_receipt_category TO OWNER
GRANT TRIGGER ON TABLE public.cash_transfer TO OWNER
GRANT TRIGGER ON TABLE public.comprobante TO OWNER
GRANT TRIGGER ON TABLE public.entidad TO OWNER
GRANT TRIGGER ON TABLE public.payment TO OWNER
GRANT TRIGGER ON TABLE public.payment_allocation TO OWNER
GRANT TRIGGER ON TABLE public.payment_balance TO OWNER
GRANT TRIGGER ON TABLE public.payment_method TO OWNER
GRANT TRIGGER ON TABLE public.petty_cash_vale TO OWNER
GRANT TRIGGER ON TABLE public.receipt_sequence TO OWNER
GRANT TRIGGER ON TABLE public.voucher_balance TO OWNER
GRANT TRIGGER ON TABLE public.voucher_series TO OWNER
GRANT TRUNCATE ON TABLE public.__sql_migrations TO OWNER
GRANT TRUNCATE ON TABLE public.app_setting TO OWNER
GRANT TRUNCATE ON TABLE public.bank_reconciliation TO OWNER
GRANT TRUNCATE ON TABLE public.bank_reconciliation_item TO OWNER
GRANT TRUNCATE ON TABLE public.cash_account TO OWNER
GRANT TRUNCATE ON TABLE public.cash_close TO OWNER
GRANT TRUNCATE ON TABLE public.cash_close_denomination TO OWNER
GRANT TRUNCATE ON TABLE public.cash_count TO OWNER
GRANT TRUNCATE ON TABLE public.cash_count_denomination TO OWNER
GRANT TRUNCATE ON TABLE public.cash_receipt_category TO OWNER
GRANT TRUNCATE ON TABLE public.cash_transfer TO OWNER
GRANT TRUNCATE ON TABLE public.comprobante TO OWNER
GRANT TRUNCATE ON TABLE public.entidad TO OWNER
GRANT TRUNCATE ON TABLE public.payment TO OWNER
GRANT TRUNCATE ON TABLE public.payment_allocation TO OWNER
GRANT TRUNCATE ON TABLE public.payment_balance TO OWNER
GRANT TRUNCATE ON TABLE public.payment_method TO OWNER
GRANT TRUNCATE ON TABLE public.petty_cash_vale TO OWNER
GRANT TRUNCATE ON TABLE public.receipt_sequence TO OWNER
GRANT TRUNCATE ON TABLE public.voucher_balance TO OWNER
GRANT TRUNCATE ON TABLE public.voucher_series TO OWNER
GRANT UPDATE ON TABLE public.__sql_migrations TO OWNER
GRANT UPDATE ON TABLE public.__sql_migrations TO service_role
GRANT UPDATE ON TABLE public.app_setting TO OWNER
GRANT UPDATE ON TABLE public.app_setting TO authenticated
GRANT UPDATE ON TABLE public.app_setting TO service_role
GRANT UPDATE ON TABLE public.bank_reconciliation TO OWNER
GRANT UPDATE ON TABLE public.bank_reconciliation TO service_role
GRANT UPDATE ON TABLE public.bank_reconciliation_item TO OWNER
GRANT UPDATE ON TABLE public.bank_reconciliation_item TO service_role
GRANT UPDATE ON TABLE public.cash_account TO OWNER
GRANT UPDATE ON TABLE public.cash_account TO authenticated
GRANT UPDATE ON TABLE public.cash_account TO service_role
GRANT UPDATE ON TABLE public.cash_close TO OWNER
GRANT UPDATE ON TABLE public.cash_close TO service_role
GRANT UPDATE ON TABLE public.cash_close_denomination TO OWNER
GRANT UPDATE ON TABLE public.cash_close_denomination TO service_role
GRANT UPDATE ON TABLE public.cash_count TO OWNER
GRANT UPDATE ON TABLE public.cash_count TO service_role
GRANT UPDATE ON TABLE public.cash_count_denomination TO OWNER
GRANT UPDATE ON TABLE public.cash_count_denomination TO service_role
GRANT UPDATE ON TABLE public.cash_receipt_category TO OWNER
GRANT UPDATE ON TABLE public.cash_receipt_category TO authenticated
GRANT UPDATE ON TABLE public.cash_receipt_category TO service_role
GRANT UPDATE ON TABLE public.cash_transfer TO OWNER
GRANT UPDATE ON TABLE public.cash_transfer TO service_role
GRANT UPDATE ON TABLE public.comprobante TO OWNER
GRANT UPDATE ON TABLE public.comprobante TO service_role
GRANT UPDATE ON TABLE public.entidad TO OWNER
GRANT UPDATE ON TABLE public.entidad TO authenticated
GRANT UPDATE ON TABLE public.entidad TO service_role
GRANT UPDATE ON TABLE public.payment TO OWNER
GRANT UPDATE ON TABLE public.payment TO service_role
GRANT UPDATE ON TABLE public.payment_allocation TO OWNER
GRANT UPDATE ON TABLE public.payment_allocation TO service_role
GRANT UPDATE ON TABLE public.payment_balance TO OWNER
GRANT UPDATE ON TABLE public.payment_balance TO authenticated
GRANT UPDATE ON TABLE public.payment_balance TO service_role
GRANT UPDATE ON TABLE public.payment_method TO OWNER
GRANT UPDATE ON TABLE public.payment_method TO authenticated
GRANT UPDATE ON TABLE public.payment_method TO service_role
GRANT UPDATE ON TABLE public.petty_cash_vale TO OWNER
GRANT UPDATE ON TABLE public.petty_cash_vale TO service_role
GRANT UPDATE ON TABLE public.receipt_sequence TO OWNER
GRANT UPDATE ON TABLE public.receipt_sequence TO service_role
GRANT UPDATE ON TABLE public.voucher_balance TO OWNER
GRANT UPDATE ON TABLE public.voucher_balance TO authenticated
GRANT UPDATE ON TABLE public.voucher_balance TO service_role
GRANT UPDATE ON TABLE public.voucher_series TO OWNER
GRANT UPDATE ON TABLE public.voucher_series TO service_role
GRANT UPDATE(public.payment.entity_id) ON TABLE public.payment TO authenticated
GRANT UPDATE(public.payment.status) ON TABLE public.payment TO authenticated
GRANT UPDATE(public.payment.void_reason) ON TABLE public.payment TO authenticated
GRANT UPDATE(public.payment.voided_at) ON TABLE public.payment TO authenticated
GRANT USAGE ON SCHEMA auth TO OWNER
GRANT USAGE ON SCHEMA auth TO PUBLIC
GRANT USAGE ON SCHEMA public TO OWNER
GRANT USAGE ON SCHEMA public TO anon
GRANT USAGE ON SCHEMA public TO authenticated
GRANT USAGE ON SCHEMA public TO service_role
