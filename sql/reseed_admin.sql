-- Re-creates the default admin login if it was deleted.
-- Email: admin@example.com   Password: Admin@123
-- Change the password after logging in.
insert into users (name, email, password_hash, role)
values (
  'Administrator',
  'admin@example.com',
  '$2b$10$vGe35NAs7ebunZ7UrXc4G.SooQeFvV4O3AIdEKfM.iHU9YayVxjB6',
  'admin'
)
on conflict (email) do update
set password_hash = excluded.password_hash,
    role = excluded.role,
    is_active = true;
