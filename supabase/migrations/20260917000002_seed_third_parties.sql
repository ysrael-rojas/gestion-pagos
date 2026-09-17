-- =============================================================================
-- Semilla de Terceros de prueba
-- 10 filas: mayoría clientes, un proveedor, uno con ambos roles, uno inactivo
-- y uno sin documento. UUIDs fijos para que la migración sea idempotente.
-- =============================================================================

insert into public.third_parties
  (id, document_type, document_number, name, fiscal_address, phone, email, roles, active, created_at, updated_at)
values
  (
    'a0000000-0000-4000-8000-000000000001',
    'ruc', '20123456789', 'Distribuidora Andina S.A.C.',
    'Av. Los Próceres 1450, Lima', '+51 1 445 8890', 'contacto@distribuidoraandina.pe',
    array['customer']::public.third_party_role[], true,
    '2026-01-12T09:15:00Z', '2026-01-12T09:15:00Z'
  ),
  (
    'a0000000-0000-4000-8000-000000000002',
    'ruc', '20556677889', 'Servicios Integrales del Pacífico S.R.L.',
    'Calle Los Olivos 238, Miraflores, Lima', '+51 1 610 4477', 'ventas@serviciosdelpacifico.pe',
    array['supplier']::public.third_party_role[], true,
    '2026-02-03T11:40:00Z', '2026-02-03T11:40:00Z'
  ),
  (
    'a0000000-0000-4000-8000-000000000003',
    'dni', '45678912', 'María Fernanda Quispe Huamán',
    'Jr. Ayacucho 812, Arequipa', '+51 954 221 780', 'mf.quispe@gmail.com',
    array['customer']::public.third_party_role[], true,
    '2026-03-18T15:05:00Z', '2026-03-18T15:05:00Z'
  ),
  (
    'a0000000-0000-4000-8000-000000000004',
    'dni', '12345678', 'Carlos Alberto Ríos Salazar',
    'Av. Grau 1160, Trujillo', '+51 943 118 902', 'crios@outlook.com',
    array['customer', 'supplier']::public.third_party_role[], true,
    '2026-04-27T08:30:00Z', '2026-04-27T08:30:00Z'
  ),
  (
    'a0000000-0000-4000-8000-000000000005',
    'foreigner_card', 'XA1234567', 'John Alexander Smith',
    'Calle Cantuarias 175, Miraflores, Lima', '+51 987 664 210', 'john.smith@consulting.com',
    array['supplier']::public.third_party_role[], true,
    '2026-05-09T13:20:00Z', '2026-05-09T13:20:00Z'
  ),
  (
    'a0000000-0000-4000-8000-000000000006',
    'no_document', null, 'Taller Los Andes',
    'Pasaje Santa Rosa 45, Cusco', '+51 984 550 331', null,
    array['supplier']::public.third_party_role[], false,
    '2026-06-14T10:00:00Z', '2026-07-02T16:45:00Z'
  ),
  (
    'a0000000-0000-4000-8000-000000000007',
    'ruc', '20987654321', 'Comercial San Martín E.I.R.L.',
    'Av. Larco 345, Trujillo', '+51 44 232 118', 'ventas@comercialsanmartin.pe',
    array['customer']::public.third_party_role[], true,
    '2026-06-30T09:05:00Z', '2026-06-30T09:05:00Z'
  ),
  (
    'a0000000-0000-4000-8000-000000000008',
    'dni', '70123456', 'Lucía Torres Vargas',
    'Calle Bolognesi 210, Piura', '+51 969 447 015', 'lucia.torres@gmail.com',
    array['customer']::public.third_party_role[], true,
    '2026-07-21T17:50:00Z', '2026-07-21T17:50:00Z'
  ),
  (
    'a0000000-0000-4000-8000-000000000009',
    'ruc', '20445566778', 'Inversiones del Norte S.A.C.',
    'Av. Balta 560, Chiclayo', '+51 74 208 660', 'contacto@inversionesdelnorte.pe',
    array['customer']::public.third_party_role[], true,
    '2026-08-08T12:10:00Z', '2026-08-08T12:10:00Z'
  ),
  (
    'a0000000-0000-4000-8000-000000000010',
    'dni', '08765432', 'Jorge Luis Mendoza Paredes',
    'Av. La Marina 2340, San Miguel, Lima', '+51 998 302 144', 'jmendoza@hotmail.com',
    array['customer']::public.third_party_role[], true,
    '2026-09-02T14:25:00Z', '2026-09-02T14:25:00Z'
  )
on conflict (id) do nothing;
